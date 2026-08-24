#!/usr/bin/env python3
"""
compare-mcp-v1-v2.py — live MCP matrix comparing Pages v1 vs Worker v2.

Calls the same logical cases against both endpoints (streamable HTTP JSON-RPC),
normalizes content fingerprints, and writes a markdown + JSON report.

Endpoints (defaults; override with env or flags):
  v1  https://tc-helps.mcp.servant.bible/api/mcp   (Pages 7.x; also /mcp)
  v2  https://tc-helps.mcp.servant.bible/v2/mcp    (Worker 2.x)

Tool name mapping (v1 ≠ v2 surface):
  list_languages          → list_languages / list_languages
  list_resources          → list_resources_for_language / list_resources
  get_passage             → fetch_scripture / get_passage
  get_passage_context     → fetch_translation_notes (intros) / get_passage_context
  get_note                → fetch_translation_notes / get_note
  get_questions           → fetch_translation_questions / get_questions
  get_word_article        → fetch_translation_word / get_word_article
  search_articles         → (v2-only) / search_articles
  get_obs_story           → fetch_obs / get_obs_story
  get_obs_notes           → fetch_obs_translation_notes / get_obs_notes
  get_obs_questions       → fetch_obs_translation_questions / get_obs_questions

Usage:
  py -3.11 scripts/compare-mcp-v1-v2.py
  py -3.11 scripts/compare-mcp-v1-v2.py --out .scratch-mcp-compare
  py -3.11 scripts/compare-mcp-v1-v2.py --fail-on-diverge
  npm run compare:mcp

Exit codes:
  0  completed (divergences listed in report unless --fail-on-diverge)
  1  transport / initialize / tools/list failure on either side
  2  --fail-on-diverge and at least one diverge / both-error
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_V1 = "https://tc-helps.mcp.servant.bible/api/mcp"
DEFAULT_V2 = "https://tc-helps.mcp.servant.bible/v2/mcp"

# Cloudflare Error 1010 blocks urllib's default User-Agent.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36 TranslationHelpsCompare/1.0"
)

WS_RE = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# MCP client
# ---------------------------------------------------------------------------


def parse_mcp_body(raw: bytes) -> dict[str, Any]:
    text = raw.decode("utf-8", errors="replace")
    stripped = text.lstrip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    last: dict[str, Any] | None = None
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "{}":
            continue
        try:
            last = json.loads(payload)
        except json.JSONDecodeError:
            continue
    if last is None:
        raise ValueError(f"No JSON/SSE payload in response: {text[:400]!r}")
    return last


class McpClient:
    def __init__(self, endpoint: str, label: str, timeout: float = 120.0):
        self.endpoint = endpoint
        self.label = label
        self.timeout = timeout
        self.session_id: str | None = None
        self._id = 0
        self.server_info: dict[str, Any] = {}
        self.tool_names: set[str] = set()

    def _next_id(self) -> int:
        self._id += 1
        return self._id

    def request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        notification: bool = False,
    ) -> tuple[dict[str, Any], float, int]:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if not notification:
            payload["id"] = self._next_id()
        if params is not None:
            payload["params"] = params

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": USER_AGENT,
        }
        if self.session_id:
            headers["mcp-session-id"] = self.session_id

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint, data=data, headers=headers, method="POST"
        )
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = int(resp.status)
                sid = resp.headers.get("mcp-session-id")
                if sid:
                    self.session_id = sid
                body = resp.read()
        except urllib.error.HTTPError as e:
            elapsed = (time.perf_counter() - t0) * 1000
            body = e.read() or b""
            try:
                parsed = parse_mcp_body(body) if body else {"error": {"message": str(e)}}
            except Exception:
                parsed = {
                    "error": {
                        "message": f"HTTP {e.code}: {body[:300]!r}",
                        "code": e.code,
                    }
                }
            return parsed, elapsed, int(e.code)
        except Exception as e:
            elapsed = (time.perf_counter() - t0) * 1000
            return {"error": {"message": f"{type(e).__name__}: {e}"}}, elapsed, 0

        elapsed = (time.perf_counter() - t0) * 1000
        try:
            parsed = parse_mcp_body(body)
        except Exception as e:
            return {"error": {"message": f"parse: {e}"}}, elapsed, status
        return parsed, elapsed, status

    def initialize(self) -> None:
        parsed, elapsed, status = self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "compare-mcp-v1-v2", "version": "1.0"},
            },
        )
        if status != 200 or "error" in parsed:
            raise RuntimeError(
                f"{self.label} initialize failed status={status} "
                f"body={json.dumps(parsed)[:400]}"
            )
        self.server_info = (parsed.get("result") or {}).get("serverInfo") or {}
        try:
            self.request("notifications/initialized", {}, notification=True)
        except Exception:
            pass
        print(
            f"[{self.label}] initialized "
            f"{self.server_info.get('name')}@{self.server_info.get('version')} "
            f"session={self.session_id or '-'} {elapsed:.0f}ms"
        )

    def list_tools(self) -> list[str]:
        parsed, elapsed, status = self.request("tools/list", {})
        if status != 200 or "error" in parsed:
            raise RuntimeError(
                f"{self.label} tools/list failed status={status} "
                f"body={json.dumps(parsed)[:400]}"
            )
        tools = (parsed.get("result") or {}).get("tools") or []
        names = [t.get("name") for t in tools if isinstance(t, dict) and t.get("name")]
        self.tool_names = set(names)
        print(f"[{self.label}] tools/list -> {len(names)} tools ({elapsed:.0f}ms)")
        return names

    def call_tool(
        self, name: str, arguments: dict[str, Any]
    ) -> tuple[dict[str, Any], float, int]:
        return self.request(
            "tools/call", {"name": name, "arguments": arguments}
        )


# ---------------------------------------------------------------------------
# Payload helpers / fingerprints
# ---------------------------------------------------------------------------


def tool_payload(parsed: dict[str, Any]) -> Any:
    if "error" in parsed and "result" not in parsed:
        return None
    result = parsed.get("result")
    if not isinstance(result, dict):
        return None
    if result.get("isError"):
        return None
    sc = result.get("structuredContent")
    if sc is not None:
        return sc
    content = result.get("content") or []
    texts: list[str] = []
    for c in content:
        if isinstance(c, dict) and c.get("type") == "text":
            texts.append(str(c.get("text") or ""))
    if not texts:
        return result
    joined = "\n".join(texts)
    try:
        return json.loads(joined)
    except json.JSONDecodeError:
        return {"text": joined}


def extract_error(parsed: dict[str, Any]) -> str | None:
    if "error" in parsed:
        err = parsed["error"]
        if isinstance(err, dict):
            return str(err.get("message") or err)[:400]
        return str(err)[:400]
    result = parsed.get("result")
    if isinstance(result, dict) and result.get("isError"):
        content = result.get("content") or []
        texts = [
            str(c.get("text") or "")
            for c in content
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        return (" | ".join(texts) or "isError")[:400]
    data = tool_payload(parsed)
    if isinstance(data, dict):
        if data.get("available") is False:
            code = data.get("code") or "UNAVAILABLE"
            msg = data.get("message") or ""
            return f"{code}: {msg}"[:400]
        err = data.get("error")
        if isinstance(err, dict):
            return str(err.get("message") or err.get("code") or err)[:400]
    return None


def norm_ws(s: str) -> str:
    return WS_RE.sub(" ", s).strip()


def text_start(s: str, n: int = 80) -> str:
    t = norm_ws(s)
    # Drop leading verse number markers ("1 ", "1-3 ") common in some formats.
    t = re.sub(r"^\d+(?:-\d+)?\s+", "", t)
    return t[:n]


def short_hash(s: str) -> str:
    return hashlib.sha256(norm_ws(s).encode("utf-8")).hexdigest()[:12]


def as_list(val: Any) -> list[Any]:
    if isinstance(val, list):
        return val
    return []


SUBJECT_TO_ABBREV = {
    "bible": "bible",
    "aligned bible": "bible",
    "translation words": "tw",
    "translation academy": "ta",
    "tsv translation notes": "tn",
    "tsv translation questions": "tq",
    "tsv translation words links": "twl",
    "translation questions": "tq",
    "translation notes": "tn",
    "open bible stories": "obs",
    "obs translation notes": "obs-tn",
    "obs translation questions": "obs-tq",
    "greek new testament": "ugnt",
    "hebrew bible": "uhb",
}


def normalize_resource_token(raw: str) -> str | None:
    """Map v1 subjects / en_ult names and v2 abbreviations to a shared token."""
    s = raw.strip().lower()
    if not s:
        return None
    if s in SUBJECT_TO_ABBREV:
        return SUBJECT_TO_ABBREV[s]
    # en_ult / es-419_tn / hi_tw → ult / tn / tw
    m = re.match(r"^[a-z]{2,3}(?:-[a-z0-9]+)?_(.+)$", s)
    if m:
        return m.group(1).lower()
    # already an abbreviation-like token
    if re.fullmatch(r"[a-z0-9-]{2,12}", s):
        return s
    return s


def resource_type_set(data: dict[str, Any]) -> list[str]:
    """Normalize resource abbreviations across v1/v2 shapes."""
    types: set[str] = set()

    def add(val: Any) -> None:
        if not isinstance(val, str):
            return
        tok = normalize_resource_token(val)
        if tok:
            types.add(tok)

    resources = data.get("resources")
    if isinstance(resources, list):
        for r in resources:
            if not isinstance(r, dict):
                continue
            for key in ("abbreviation", "resourceType", "type", "subject", "name"):
                if r.get(key):
                    add(str(r.get(key)))
                    break

    avail = data.get("available")
    if isinstance(avail, list):
        for r in avail:
            if isinstance(r, dict):
                for key in ("abbreviation", "resourceType", "type", "subject"):
                    if r.get(key):
                        add(str(r.get(key)))
                        break
            elif isinstance(r, str):
                add(r)

    by_subj = data.get("resourcesBySubject")
    if isinstance(by_subj, dict):
        for subj, items in by_subj.items():
            add(str(subj))
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict):
                        add(str(it.get("abbreviation") or it.get("name") or ""))

    subjects = data.get("subjects")
    if isinstance(subjects, list):
        for s in subjects:
            if isinstance(s, str):
                add(s)
            elif isinstance(s, dict):
                add(str(s.get("name") or s.get("subject") or s.get("abbreviation") or ""))

    return sorted(types)


def passage_sample(data: dict[str, Any]) -> tuple[int, list[str], str]:
    versions = as_list(data.get("versions"))
    if versions:
        roles = []
        sample = ""
        for v in versions:
            if not isinstance(v, dict):
                continue
            roles.append(
                str(v.get("role") or v.get("resourceType") or v.get("abbreviation") or "?")
            )
            if not sample:
                sample = text_start(str(v.get("text") or v.get("content") or ""))
        return len(versions), roles, sample

    scripture = as_list(data.get("scripture"))
    if scripture:
        roles = []
        sample = ""
        for item in scripture:
            if not isinstance(item, dict):
                continue
            cit = item.get("citation") if isinstance(item.get("citation"), dict) else {}
            roles.append(
                str(
                    cit.get("resource")
                    or item.get("translation")
                    or item.get("resource")
                    or "?"
                )
            )
            if not sample:
                sample = text_start(str(item.get("text") or item.get("content") or ""))
        return len(scripture), roles, sample

    # Markdown / text fallback
    text = data.get("text") or data.get("content")
    if isinstance(text, str) and text.strip():
        return 1, ["text"], text_start(text)
    return 0, [], ""


def note_count(data: dict[str, Any]) -> int:
    for key in ("notes", "items", "translationNotes"):
        val = data.get(key)
        if isinstance(val, list):
            # Prefer verse-level when tagged
            filtered = [
                n
                for n in val
                if not (
                    isinstance(n, dict)
                    and str(n.get("verse") or "").lower() in {"intro", "front"}
                )
            ]
            return len(filtered)
    counts = data.get("counts")
    if isinstance(counts, dict):
        for k in ("notes", "items", "total"):
            if isinstance(counts.get(k), int):
                return int(counts[k])
    return 0


def question_count(data: dict[str, Any]) -> int:
    for key in ("questions", "items"):
        val = data.get(key)
        if isinstance(val, list):
            return len(val)
    counts = data.get("counts")
    if isinstance(counts, dict) and isinstance(counts.get("items"), int):
        return int(counts["items"])
    return 0


def article_fingerprint(data: dict[str, Any]) -> dict[str, Any]:
    path = str(data.get("path") or "").replace(".md", "").strip("/")
    body = (
        data.get("article")
        or data.get("content")
        or data.get("definition")
        or data.get("text")
        or ""
    )
    body_s = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
    title = str(data.get("title") or "")
    return {
        "path": path.lower(),
        "title_start": text_start(title, 40),
        "body_start": text_start(body_s, 60),
        "body_hash": short_hash(body_s) if body_s else None,
        "body_len": len(norm_ws(body_s)),
    }


def obs_fingerprint(data: dict[str, Any]) -> dict[str, Any]:
    frames = as_list(data.get("frames"))
    story = data.get("story")
    title = str(data.get("title") or "")
    if isinstance(story, dict) and not title:
        title = str(story.get("title") or "")
    return {
        "title_start": text_start(title, 40),
        "frame_count": len(frames) if frames else (1 if data.get("text") else 0),
        "sample": text_start(
            str(
                (frames[0].get("text") if frames and isinstance(frames[0], dict) else "")
                or data.get("text")
                or ""
            ),
            60,
        ),
    }


def fingerprint(logical: str, data: Any, err: str | None) -> dict[str, Any]:
    fp: dict[str, Any] = {"ok": err is None, "error_code": None}
    if err:
        # Prefer machine code when present
        code_m = re.search(r"^([A-Z][A-Z0-9_]+):", err)
        fp["error_code"] = code_m.group(1) if code_m else "ERROR"
        fp["error"] = err[:200]
        return fp

    if not isinstance(data, dict):
        fp["kind"] = type(data).__name__
        fp["preview"] = str(data)[:120]
        return fp

    if logical == "list_languages":
        langs = as_list(data.get("languages"))
        codes = sorted(
            {
                str(x.get("code") or x.get("lc") or "").lower()
                for x in langs
                if isinstance(x, dict)
            }
            - {""}
        )
        fp.update(
            {
                "total": data.get("total_count") or data.get("total") or len(langs),
                "page": len(langs),
                "has_en": "en" in codes,
                "has_es": any(c == "es" or c.startswith("es-") for c in codes),
                "has_hi": "hi" in codes,
                "code_sample": codes[:8],
            }
        )
    elif logical == "list_resources":
        types = resource_type_set(data)
        fp.update(
            {
                "type_count": len(types),
                "types": types,
                "has_tw": any("tw" in t or "translation words" in t for t in types),
                "has_tn": any("tn" in t or "translation notes" in t for t in types),
            }
        )
    elif logical == "get_passage":
        n, roles, sample = passage_sample(data)
        fp.update(
            {
                "version_count": n,
                "roles": roles,
                "text_start": sample,
                "text_hash": short_hash(sample) if sample else None,
            }
        )
    elif logical in ("get_passage_context", "get_note"):
        n = note_count(data)
        # context may also expose availability
        types = resource_type_set(data) if logical == "get_passage_context" else []
        fp.update({"note_count": n, "types": types})
        if logical == "get_passage_context":
            intros = [
                x
                for x in as_list(data.get("notes") or data.get("introNotes") or data.get("items"))
                if isinstance(x, dict)
                and str(x.get("verse") or x.get("scope") or "").lower()
                in {"intro", "front", "book", "chapter"}
            ]
            fp["intro_count"] = len(intros) if intros else n
    elif logical == "get_questions":
        fp["question_count"] = question_count(data)
    elif logical == "get_word_article":
        fp.update(article_fingerprint(data))
    elif logical == "search_articles":
        results = as_list(data.get("results") or data.get("articles") or data.get("items"))
        paths = []
        for r in results[:8]:
            if isinstance(r, dict):
                paths.append(str(r.get("path") or r.get("id") or "").replace(".md", ""))
        fp.update({"result_count": len(results), "paths": paths})
    elif logical.startswith("get_obs"):
        if logical == "get_obs_questions":
            fp["question_count"] = question_count(data)
            if not fp["question_count"]:
                items = as_list(data.get("items") or data.get("questions"))
                fp["question_count"] = len(items)
        elif logical == "get_obs_notes":
            fp["note_count"] = note_count(data)
        else:
            fp.update(obs_fingerprint(data))
    else:
        fp["keys"] = list(data.keys())[:12]
    return fp


def summarize_fp(fp: dict[str, Any]) -> str:
    if not fp.get("ok"):
        return f"ERR {fp.get('error_code')}: {fp.get('error', '')[:120]}"
    bits: list[str] = []
    for k in (
        "total",
        "page",
        "type_count",
        "version_count",
        "note_count",
        "intro_count",
        "question_count",
        "result_count",
        "frame_count",
        "body_len",
        "path",
        "text_start",
        "types",
        "roles",
    ):
        if k in fp and fp[k] not in (None, [], ""):
            bits.append(f"{k}={fp[k]}")
    return "; ".join(bits)[:220] or json.dumps(fp, ensure_ascii=False)[:220]


def compare_fps(a: dict[str, Any] | None, b: dict[str, Any] | None) -> str:
    if a is None and b is None:
        return "both-error"
    if a is None:
        return "v2-only"
    if b is None:
        return "v1-only"
    a_ok, b_ok = bool(a.get("ok")), bool(b.get("ok"))
    if not a_ok and not b_ok:
        # Same failure class counts as match for availability gaps
        if a.get("error_code") and a.get("error_code") == b.get("error_code"):
            return "match"
        return "both-error"
    if a_ok ^ b_ok:
        # Empty successful payload ≈ not-available on the other side.
        empty = a if a_ok else b
        err_side = b if a_ok else a
        empty_counts = [
            empty.get(k)
            for k in ("note_count", "question_count", "intro_count", "result_count", "frame_count", "version_count", "body_len")
            if k in empty
        ]
        if empty_counts and all(v == 0 or v is None for v in empty_counts):
            if err_side.get("error_code") in {
                "RESOURCE_NOT_AVAILABLE",
                "NOT_FOUND",
                "ERROR",
                "UNAVAILABLE",
            }:
                return "match"
        return "diverge"

    # list_languages: totals often differ (pagination / filters) — match on has_* flags
    if "has_en" in a and "has_en" in b:
        flags_a = {k: a[k] for k in ("has_en", "has_es", "has_hi") if k in a}
        flags_b = {k: b[k] for k in ("has_en", "has_es", "has_hi") if k in b}
        return "match" if flags_a == flags_b else "diverge"

    # Passage: primary signal is shared verse text hash (roles/version packaging differ).
    if a.get("text_hash") or b.get("text_hash") or a.get("text_start") or b.get("text_start"):
        sa = text_start(str(a.get("text_start") or ""))
        sb = text_start(str(b.get("text_start") or ""))
        if sa and sb and (sa == sb or sa.startswith(sb[:50]) or sb.startswith(sa[:50])):
            return "match"
        ha, hb = a.get("text_hash"), b.get("text_hash")
        if ha and hb and ha == hb:
            return "match"
        if sa or sb:
            return "diverge"

    # Articles: body equality beats path category drift (kt vs names).
    if a.get("body_hash") and b.get("body_hash"):
        if a["body_hash"] == b["body_hash"]:
            return "match"
        if a.get("body_len") and b.get("body_len") and a["body_len"] == b["body_len"]:
            return "match"
        return "diverge"

    # Resources: compare shared core helps abbreviations, ignore extras (OBS/original).
    if "types" in a and "types" in b:
        core = {
            "ult",
            "ust",
            "glt",
            "gst",
            "hglt",
            "hgst",
            "tpl",
            "tn",
            "tw",
            "ta",
            "tq",
            "twl",
        }

        def canon(types: list[str]) -> set[str]:
            out: set[str] = set()
            for t in types:
                if t not in core:
                    continue
                if t in {"glt", "hglt", "tpl"}:
                    out.add("ult")
                elif t in {"gst", "hgst"}:
                    out.add("ust")
                else:
                    out.add(t)
            return out

        ca, cb = canon(list(a["types"])), canon(list(b["types"]))
        # Match when the intersection covers the smaller core set (extras OK).
        if not ca and not cb:
            return "match"
        smaller, larger = (ca, cb) if len(ca) <= len(cb) else (cb, ca)
        return "match" if smaller and smaller.issubset(larger) else "diverge"

    # Content compare — ignore volatile fields
    def core(fp: dict[str, Any]) -> dict[str, Any]:
        skip = {
            "error",
            "error_code",
            "ok",
            "code_sample",
            "text_start",
            "body_start",
            "title_start",
            "roles",
            "version_count",
            "path",
            "types",
            "type_count",
            "has_tw",
            "has_tn",
            "frame_count",
            "sample",
        }
        out = {k: v for k, v in fp.items() if k not in skip}
        return out

    ca, cb = core(a), core(b)
    if ca == cb:
        return "match"

    # Soft match: note/question counts within ±2 (intro filtering differs)
    soft_keys = {
        "note_count",
        "question_count",
        "intro_count",
        "result_count",
        "body_len",
    }
    differing = []
    keys = set(ca) | set(cb)
    for k in keys:
        va, vb = ca.get(k), cb.get(k)
        if va == vb:
            continue
        if k in soft_keys and isinstance(va, int) and isinstance(vb, int):
            if abs(va - vb) <= 2:
                continue
            if k == "body_len" and min(va, vb) > 0 and abs(va - vb) / max(va, vb) <= 0.15:
                continue
        differing.append(k)
    return "match" if not differing else "diverge"


# ---------------------------------------------------------------------------
# Case matrix
# ---------------------------------------------------------------------------


@dataclass
class SideCall:
    tool: str | None
    args: dict[str, Any] = field(default_factory=dict)


@dataclass
class Case:
    id: str
    logical: str
    params: dict[str, Any]
    v1: SideCall
    v2: SideCall


def build_cases() -> list[Case]:
    langs = ("en", "es", "hi")
    refs = ("TIT 1:1", "TIT 1", "JON 1:1-3")
    cases: list[Case] = []

    cases.append(
        Case(
            id="list_languages",
            logical="list_languages",
            params={},
            v1=SideCall("list_languages", {}),
            v2=SideCall("list_languages", {"limit": 500}),
        )
    )

    for lang in langs:
        cases.append(
            Case(
                id=f"list_resources:{lang}",
                logical="list_resources",
                params={"language": lang},
                v1=SideCall("list_resources_for_language", {"language": lang}),
                v2=SideCall("list_resources", {"language": lang}),
            )
        )

    for lang in langs:
        for ref in refs:
            cases.append(
                Case(
                    id=f"get_passage:{lang}:{ref}",
                    logical="get_passage",
                    params={"language": lang, "reference": ref},
                    v1=SideCall(
                        "fetch_scripture",
                        {"language": lang, "reference": ref, "format": "json"},
                    ),
                    v2=SideCall("get_passage", {"language": lang, "reference": ref}),
                )
            )

    for lang in langs:
        for ref in ("TIT 1", "JON 1:1-3"):
            cases.append(
                Case(
                    id=f"get_passage_context:{lang}:{ref}",
                    logical="get_passage_context",
                    params={"language": lang, "reference": ref},
                    v1=SideCall(
                        "fetch_translation_notes",
                        {
                            "language": lang,
                            "reference": ref,
                            "format": "json",
                            "includeIntro": True,
                        },
                    ),
                    v2=SideCall(
                        "get_passage_context", {"language": lang, "reference": ref}
                    ),
                )
            )
            cases.append(
                Case(
                    id=f"get_note:{lang}:{ref}",
                    logical="get_note",
                    params={"language": lang, "reference": ref},
                    v1=SideCall(
                        "fetch_translation_notes",
                        {
                            "language": lang,
                            "reference": ref,
                            "format": "json",
                            "includeIntro": False,
                        },
                    ),
                    v2=SideCall("get_note", {"language": lang, "reference": ref}),
                )
            )
            cases.append(
                Case(
                    id=f"get_questions:{lang}:{ref}",
                    logical="get_questions",
                    params={"language": lang, "reference": ref},
                    v1=SideCall(
                        "fetch_translation_questions",
                        {"language": lang, "reference": ref, "format": "json"},
                    ),
                    v2=SideCall("get_questions", {"language": lang, "reference": ref}),
                )
            )

    for lang in langs:
        cases.append(
            Case(
                id=f"get_word_article:{lang}:paul",
                logical="get_word_article",
                params={"language": lang, "path": "bible/names/paul"},
                v1=SideCall(
                    "fetch_translation_word",
                    {"language": lang, "path": "bible/names/paul"},
                ),
                v2=SideCall(
                    "get_word_article",
                    {"language": lang, "path": "bible/names/paul"},
                ),
            )
        )
        cases.append(
            Case(
                id=f"search_articles:{lang}:grace",
                logical="search_articles",
                params={"language": lang, "query": "grace", "limit": 5},
                v1=SideCall(None, {}),  # v2-only
                v2=SideCall(
                    "search_articles",
                    {"language": lang, "query": "grace", "limit": 5},
                ),
            )
        )

    # OBS — both sides when available (en often missing OBS in Door43 catalog)
    for lang in langs:
        cases.append(
            Case(
                id=f"get_obs_story:{lang}:1:1",
                logical="get_obs_story",
                params={"language": lang, "reference": "1:1"},
                v1=SideCall("fetch_obs", {"language": lang, "reference": "1:1"}),
                v2=SideCall("get_obs_story", {"language": lang, "reference": "1:1"}),
            )
        )
        cases.append(
            Case(
                id=f"get_obs_notes:{lang}:1:1",
                logical="get_obs_notes",
                params={"language": lang, "reference": "1:1"},
                v1=SideCall(
                    "fetch_obs_translation_notes",
                    {"language": lang, "reference": "1:1"},
                ),
                v2=SideCall("get_obs_notes", {"language": lang, "reference": "1:1"}),
            )
        )
        cases.append(
            Case(
                id=f"get_obs_questions:{lang}:1",
                logical="get_obs_questions",
                params={"language": lang, "reference": "1"},
                v1=SideCall(
                    "fetch_obs_translation_questions",
                    {"language": lang, "reference": "1"},
                ),
                v2=SideCall("get_obs_questions", {"language": lang, "reference": "1"}),
            )
        )

    return cases


# ---------------------------------------------------------------------------
# Run + report
# ---------------------------------------------------------------------------


@dataclass
class SideResult:
    tool: str | None
    args: dict[str, Any]
    http_status: int | None = None
    latency_ms: float | None = None
    transport_ok: bool = False
    error: str | None = None
    summary: str = ""
    fingerprint: dict[str, Any] | None = None
    skipped: bool = False
    skip_reason: str | None = None


@dataclass
class CaseResult:
    id: str
    logical: str
    params: dict[str, Any]
    v1: SideResult
    v2: SideResult
    verdict: str


def run_side(
    client: McpClient | None,
    call: SideCall,
    logical: str,
) -> SideResult:
    if call.tool is None:
        return SideResult(
            tool=None,
            args=call.args,
            skipped=True,
            skip_reason="no mapped tool on this side",
            summary="(no tool)",
        )
    if client is None:
        return SideResult(
            tool=call.tool,
            args=call.args,
            skipped=True,
            skip_reason="client unavailable",
            summary="(no client)",
        )
    if call.tool not in client.tool_names:
        return SideResult(
            tool=call.tool,
            args=call.args,
            skipped=True,
            skip_reason=f"tool not listed on {client.label}",
            summary=f"(missing {call.tool})",
        )

    parsed, elapsed, status = client.call_tool(call.tool, call.args)
    # HTTP 200 = transport OK even when the tool returns an application error.
    transport_ok = status == 200
    err = extract_error(parsed)
    data = tool_payload(parsed)
    fp = fingerprint(logical, data if data is not None else {}, err)
    summary = summarize_fp(fp)
    return SideResult(
        tool=call.tool,
        args=call.args,
        http_status=status,
        latency_ms=round(elapsed, 1),
        transport_ok=transport_ok,
        error=err,
        summary=summary,
        fingerprint=fp,
    )


def side_to_dict(s: SideResult) -> dict[str, Any]:
    return asdict(s)


def write_reports(
    out_dir: Path,
    meta: dict[str, Any],
    results: list[CaseResult],
) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "compare-report.json"
    md_path = out_dir / "compare-report.md"

    counts: dict[str, int] = {}
    for r in results:
        counts[r.verdict] = counts.get(r.verdict, 0) + 1

    payload = {
        "meta": meta,
        "counts": counts,
        "cases": [
            {
                "id": r.id,
                "logical": r.logical,
                "params": r.params,
                "verdict": r.verdict,
                "v1": side_to_dict(r.v1),
                "v2": side_to_dict(r.v2),
            }
            for r in results
        ],
    }
    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    lines: list[str] = []
    lines.append("# MCP v1 vs v2 comparison")
    lines.append("")
    lines.append(f"- Generated: `{meta['generated_at']}`")
    lines.append(f"- v1: `{meta['v1_url']}` ({meta.get('v1_server')})")
    lines.append(f"- v2: `{meta['v2_url']}` ({meta.get('v2_server')})")
    lines.append(f"- Cases: **{len(results)}**")
    lines.append(
        "- Verdicts: "
        + ", ".join(f"**{k}**={v}" for k, v in sorted(counts.items()))
    )
    lines.append("")
    lines.append("## Summary table")
    lines.append("")
    lines.append("| Case | Logical | Verdict | v1 | v2 |")
    lines.append("|------|---------|---------|----|----|")
    for r in results:
        v1s = r.v1.summary.replace("|", "\\|")
        v2s = r.v2.summary.replace("|", "\\|")
        lines.append(
            f"| `{r.id}` | `{r.logical}` | **{r.verdict}** | {v1s} | {v2s} |"
        )

    divergences = [r for r in results if r.verdict in {"diverge", "both-error"}]
    lines.append("")
    lines.append("## Divergences & both-error")
    lines.append("")
    if not divergences:
        lines.append("_None._")
    else:
        for r in divergences:
            lines.append(f"### `{r.id}` → {r.verdict}")
            lines.append("")
            lines.append(f"- Params: `{json.dumps(r.params, ensure_ascii=False)}`")
            lines.append(
                f"- v1 `{r.v1.tool}` ({r.v1.latency_ms}ms): {r.v1.summary}"
            )
            lines.append(
                f"- v2 `{r.v2.tool}` ({r.v2.latency_ms}ms): {r.v2.summary}"
            )
            lines.append("")

    only = [r for r in results if r.verdict in {"v1-only", "v2-only"}]
    if only:
        lines.append("## Side-only tools")
        lines.append("")
        for r in only:
            lines.append(
                f"- `{r.id}` ({r.verdict}): v1={r.v1.tool} v2={r.v2.tool} — "
                f"{r.v1.skip_reason or r.v2.skip_reason or ''}"
            )
        lines.append("")

    lines.append("## How fingerprints work")
    lines.append("")
    lines.append(
        "Latency and volatile ids (`requestId`, session) are ignored. "
        "Comparisons use content fingerprints: language presence flags, "
        "resource-type sets, verse text start/hash, note/question counts, "
        "article path + body hash, OBS frame counts, and error codes."
    )
    lines.append("")

    md = "\n".join(lines) + "\n"
    md_path.write_text(md, encoding="utf-8")
    return md_path, json_path


def recompare_json(src: Path, out_dir: Path, fail_on_diverge: bool) -> int:
    """Re-apply compare_fps to an existing report (no network)."""
    raw = json.loads(src.read_text(encoding="utf-8"))
    meta = raw.get("meta") or {}
    results: list[CaseResult] = []
    for c in raw.get("cases") or []:
        v1 = SideResult(**c["v1"])
        v2 = SideResult(**c["v2"])
        if v1.skipped and not v2.skipped:
            verdict = "v2-only"
        elif v2.skipped and not v1.skipped:
            verdict = "v1-only"
        elif v1.skipped and v2.skipped:
            verdict = "both-error"
        else:
            verdict = compare_fps(v1.fingerprint, v2.fingerprint)
        results.append(
            CaseResult(
                id=c["id"],
                logical=c["logical"],
                params=c.get("params") or {},
                v1=v1,
                v2=v2,
                verdict=verdict,
            )
        )
    meta["recompared_at"] = datetime.now(timezone.utc).isoformat()
    md_path, json_path = write_reports(out_dir, meta, results)
    print(md_path.read_text(encoding="utf-8"))
    print(f"Wrote {md_path}")
    print(f"Wrote {json_path}")
    if fail_on_diverge and any(r.verdict in {"diverge", "both-error"} for r in results):
        return 2
    return 0


def main(argv: list[str] | None = None) -> int:
    # Windows consoles are often cp1252; keep stdout printable.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument("--v1", default=None, help=f"v1 MCP URL (default: {DEFAULT_V1})")
    parser.add_argument("--v2", default=None, help=f"v2 MCP URL (default: {DEFAULT_V2})")
    parser.add_argument(
        "--out",
        default=".scratch-mcp-compare",
        help="Output directory for compare-report.md/json",
    )
    parser.add_argument(
        "--fail-on-diverge",
        action="store_true",
        help="Exit 2 when any case verdict is diverge or both-error",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional max cases (0 = all)",
    )
    parser.add_argument(
        "--recompare",
        metavar="JSON",
        help="Re-score an existing compare-report.json without live calls",
    )
    args = parser.parse_args(argv)

    if args.recompare:
        return recompare_json(Path(args.recompare), Path(args.out), args.fail_on_diverge)

    v1_url = args.v1 or __import__("os").environ.get("MCP_V1_URL", DEFAULT_V1)
    v2_url = args.v2 or __import__("os").environ.get("MCP_V2_URL", DEFAULT_V2)
    out_dir = Path(args.out)

    print(f"v1 -> {v1_url}")
    print(f"v2 -> {v2_url}")
    print(f"out -> {out_dir.resolve()}")

    transport_failed = False
    v1 = McpClient(v1_url, "v1")
    v2 = McpClient(v2_url, "v2")

    try:
        v1.initialize()
        v1.list_tools()
    except Exception as e:
        print(f"[v1] TRANSPORT FAIL: {e}", file=sys.stderr)
        transport_failed = True

    try:
        v2.initialize()
        v2.list_tools()
    except Exception as e:
        print(f"[v2] TRANSPORT FAIL: {e}", file=sys.stderr)
        transport_failed = True

    if transport_failed:
        return 1

    cases = build_cases()
    if args.limit and args.limit > 0:
        cases = cases[: args.limit]

    results: list[CaseResult] = []
    for i, case in enumerate(cases, 1):
        print(f"\n[{i}/{len(cases)}] {case.id}")
        s1 = run_side(v1, case.v1, case.logical)
        s2 = run_side(v2, case.v2, case.logical)

        if not s1.transport_ok and not s1.skipped:
            print(f"  v1 TRANSPORT FAIL status={s1.http_status} {s1.error}")
            transport_failed = True
        if not s2.transport_ok and not s2.skipped:
            print(f"  v2 TRANSPORT FAIL status={s2.http_status} {s2.error}")
            transport_failed = True

        if s1.skipped and not s2.skipped:
            verdict = "v2-only"
            fp1, fp2 = None, s2.fingerprint
        elif s2.skipped and not s1.skipped:
            verdict = "v1-only"
            fp1, fp2 = s1.fingerprint, None
        elif s1.skipped and s2.skipped:
            verdict = "both-error"
            fp1 = fp2 = None
        else:
            fp1, fp2 = s1.fingerprint, s2.fingerprint
            verdict = compare_fps(fp1, fp2)

        print(f"  v1: {s1.summary}")
        print(f"  v2: {s2.summary}")
        print(f"  -> {verdict}")

        results.append(
            CaseResult(
                id=case.id,
                logical=case.logical,
                params=case.params,
                v1=s1,
                v2=s2,
                verdict=verdict,
            )
        )

    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "v1_url": v1_url,
        "v2_url": v2_url,
        "v1_server": f"{v1.server_info.get('name')}@{v1.server_info.get('version')}",
        "v2_server": f"{v2.server_info.get('name')}@{v2.server_info.get('version')}",
        "v1_tools": sorted(v1.tool_names),
        "v2_tools": sorted(v2.tool_names),
    }
    md_path, json_path = write_reports(out_dir, meta, results)

    # Also print markdown report to stdout
    print("\n" + "=" * 72)
    print(md_path.read_text(encoding="utf-8"))
    print("=" * 72)
    print(f"Wrote {md_path}")
    print(f"Wrote {json_path}")

    if transport_failed:
        return 1
    if args.fail_on_diverge and any(
        r.verdict in {"diverge", "both-error"} for r in results
    ):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
