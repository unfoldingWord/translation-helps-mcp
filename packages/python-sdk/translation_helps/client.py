"""
Translation Helps MCP Client v2 — Python

Connects to the MCP server via Streamable HTTP at /mcp.
Compatible with Python 3.8+ (uses httpx for async HTTP).

Progressive-disclosure workflow::

    client = TranslationHelpsClient()

    # 1. Discover language codes + resource availability
    langs = client.list_languages({"filter": "es"})
    resources = client.list_resources({"language": "en"})

    # 2a. Orient: scripture text — all versions (cheap, repeatable)
    passage = client.get_passage({"reference": "JHN 3:16", "language": "en"})

    # 2b. Orient: book/chapter background + resource availability (no verse text)
    ctx = client.get_passage_context({"reference": "JHN 3:16", "language": "en"})

    # 3. Survey: compact index of issues and key terms (no full bodies)
    index = client.get_passage_index({"reference": "JHN 3:16", "language": "en"})

    # 4. Drill: fetch a specific note, TA article, or TW article
    note = client.get_note({"reference": "JHN 3:16", "id": "abc123", "language": "en"})
    article = client.get_academy_article({"path": "translate/figs-metaphor"})
    word = client.get_word_article({"path": "bible/kt/grace"})

    # 5. Check: comprehension questions
    questions = client.get_questions({"reference": "JHN 3:16"})

    # 6. Lateral discovery: find articles by concept
    hits = client.search_articles({"query": "abstract nouns", "resourceTypes": ["ta"]})
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

try:
    import urllib.request
    import urllib.error
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False


DEFAULT_SERVER_URL = "https://translation-helps-mcp-v2.workers.dev/mcp"


class TranslationHelpsClient:
    """
    Synchronous client for Translation Helps MCP v2.

    Example::

        client = TranslationHelpsClient()
        ctx = client.get_passage_context({"reference": "JHN 3:16", "language": "en"})
        print(ctx["content"][0]["text"])
    """

    def __init__(
        self,
        server_url: str = DEFAULT_SERVER_URL,
        timeout: float = 90.0,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        self.server_url = server_url
        self.timeout = timeout
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **(headers or {}),
        }
        self._request_id = 0

    def _call(self, method: str, params: Dict[str, Any]) -> Any:
        self._request_id += 1
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }).encode()

        if HAS_HTTPX:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(
                    self.server_url,
                    content=payload,
                    headers=self.headers,
                )
                response.raise_for_status()
                return response.json()
        elif HAS_URLLIB:
            req = urllib.request.Request(
                self.server_url,
                data=payload,
                headers=self.headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read())
        else:
            raise ImportError("Install httpx: pip install httpx")

    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Low-level tool call. Returns the MCP result dict."""
        response = self._call("tools/call", {"name": name, "arguments": arguments})
        result = response.get("result")
        if result is None:
            raise ValueError(f"No result in MCP response: {response}")
        return result  # type: ignore[return-value]

    def list_tools(self) -> list:
        response = self._call("tools/list", {})
        return response.get("result", {}).get("tools", [])

    # ---------------------------------------------------------------------------
    # Workflow tools — primary progressive-disclosure interface
    # ---------------------------------------------------------------------------

    def list_languages(self, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Discover available language codes.

        Args:
            options: Optional dict with ``filter`` (substring to filter on).

        Returns:
            MCP result with list of language entries.

        Example::
            langs = client.list_languages({"filter": "es"})
        """
        return self.call_tool("list_languages", options or {})

    def list_resources(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        List which translation resource types are available for a language.

        Returns an availability summary (type, abbreviation, role) from the
        Door43 catalog. Optional ``book`` / ``reference`` filter book-scoped
        resources that do not cover that book.

        Args:
            options: Dict with ``language`` (required, BCP-47 code).
                Optional ``book`` (USFM code/name) or ``reference``.

        Returns:
            MCP result with ``available`` / ``resources`` lists.

        Example::
            resources = client.list_resources({"language": "en"})
            tit = client.list_resources({"language": "hi", "book": "TIT"})
        """
        if not options.get("language"):
            raise ValueError("language parameter is required")
        return self.call_tool("list_resources", options)

    def get_passage(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get the scripture TEXT for a passage — all versions (literal, simplified,
        original UGNT/UHB) in one call. Cheap and repeatable: call it whenever you
        need to (re-)read the verse text. For book/chapter background and resource
        availability, use ``get_passage_context``.

        Required: reference. Optional: language.

        Example::
            passage = client.get_passage({"reference": "JHN 3:16", "language": "en"})
        """
        return self.call_tool("get_passage", options)

    def get_passage_context(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 1 (orient): Get the background AROUND a passage — book/chapter intro
        notes (tagged scope "book"/"chapter") and a summary of which resources exist.

        Also accepts a bare book reference (e.g. "TIT" or "Titus") — then returns
        only the book overview (front:intro).

        Does NOT return the verse text — use ``get_passage`` for that.
        Call this once when starting to study a passage.

        Args:
            options: Dict with ``reference`` (required), ``language``, ``organization``.

        Returns:
            MCP result with intro notes (book + chapter) and resource availability.

        Example::
            ctx = client.get_passage_context({"reference": "JHN 3:16", "language": "en"})
        """
        return self.call_tool("get_passage_context", options)

    def get_passage_index(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 2 (survey): Get a compact, self-describing index of translation issues
        and key terms without full article bodies.

        Use note IDs and article paths from the index to drill into specific
        items with get_note / get_academy_article / get_word_article.

        Args:
            options: Dict with ``reference`` (required), ``language``, ``organization``.

        Returns:
            MCP result with notes index (id, quote, taArticle) and
            word-links index (twArticle), plus issues[] and keyTerms[] rollups.

        Example::
            index = client.get_passage_index({"reference": "JHN 3:16", "language": "en"})
        """
        return self.call_tool("get_passage_index", options)

    def get_note(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 3 (drill): Fetch the full body of a specific translation note by ID,
        or all verse-level notes for a reference.

        Args:
            options: Dict with ``reference`` (required), ``language``, ``organization``,
                     and optionally ``id`` (specific note ID from get_passage_index).

        Returns:
            MCP result with note body markdown.

        Example::
            note = client.get_note({
                "reference": "JHN 3:16",
                "id": "abc123",
                "language": "en",
            })
        """
        return self.call_tool("get_note", options)

    def get_academy_article(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 3 (drill): Fetch the full Markdown content of a Translation Academy article.

        Use the path from a note's taArticle.path field.

        Args:
            options: Dict with ``path`` (required), ``language``, ``organization``.

        Returns:
            MCP result with full article markdown.

        Example::
            article = client.get_academy_article({"path": "translate/figs-metaphor"})
        """
        return self.call_tool("get_academy_article", options)

    def get_word_article(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 3 (drill): Fetch the full Markdown content of a Translation Words article.

        Use the path from a word-link's twArticle.path field.

        Args:
            options: Dict with ``path`` (required), ``language``, ``organization``.

        Returns:
            MCP result with full article markdown.

        Example::
            word = client.get_word_article({"path": "bible/kt/grace"})
        """
        return self.call_tool("get_word_article", options)

    def get_questions(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 4 (check): Fetch comprehension questions for a passage.

        Use to verify understanding before drafting a translation.

        Args:
            options: Dict with ``reference`` (required), ``language``, ``organization``.

        Returns:
            MCP result with question/answer pairs.

        Example::
            questions = client.get_questions({"reference": "JHN 3:16"})
        """
        return self.call_tool("get_questions", options)

    def search_articles(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Lateral discovery: Search Translation Academy and Translation Words articles
        by concept. Returns ranked paths to pass to get_academy_article or get_word_article.

        Args:
            options: Dict with ``query`` (required), ``language``,
                     ``resourceTypes`` (["ta"] | ["tw"] | ["ta","tw"]), ``topK``.

        Returns:
            MCP result with ranked article paths and titles.

        Example::
            hits = client.search_articles({
                "query": "abstract nouns",
                "resourceTypes": ["ta"],
                "topK": 5,
            })
        """
        return self.call_tool("search_articles", options)

    def get_obs_story(self, options: "GetObsStoryOptions") -> Dict[str, Any]:
        """
        Fetch Open Bible Stories text for a story:frame reference.

        Args:
            options: Dict with ``reference`` (required, e.g. "1:1" or "OBS 1:1"),
                     ``language`` (optional, default "en").

        Returns:
            Dictionary with story title, frames (imageUrl, text), and attribution.

        Example::
            story = client.get_obs_story({"reference": "1:1", "language": "en"})
        """
        return self.call_tool("get_obs_story", options)

    def get_obs_notes(self, options: "GetObsNotesOptions") -> Dict[str, Any]:
        """
        Fetch OBS Translation Notes for a story:frame reference.

        Args:
            options: Dict with ``reference`` (required), ``language`` (optional, default "en").

        Returns:
            Dictionary with notes list for the requested OBS frame.

        Example::
            notes = client.get_obs_notes({"reference": "1:1", "language": "en"})
        """
        return self.call_tool("get_obs_notes", options)

    def get_obs_questions(self, options: "GetObsQuestionsOptions") -> Dict[str, Any]:
        """
        Fetch OBS Translation Questions for a story:frame reference.

        Args:
            options: Dict with ``reference`` (required), ``language`` (optional, default "en").

        Returns:
            Dictionary with questions list for the requested OBS frame.

        Example::
            questions = client.get_obs_questions({"reference": "1:1", "language": "en"})
        """
        return self.call_tool("get_obs_questions", options)

    @staticmethod
    def parse_result(result: Dict[str, Any]) -> Any:
        """Extract and parse JSON from an MCP tool result."""
        for item in result.get("content", []):
            if item.get("type") == "text":
                try:
                    return json.loads(item["text"])
                except (json.JSONDecodeError, KeyError):
                    continue
        raise ValueError("No parseable JSON in tool result")


class AsyncTranslationHelpsClient:
    """
    Async client for Translation Helps MCP v2.

    Requires ``httpx`` (pip install httpx).

    Example::

        import asyncio
        from translation_helps import AsyncTranslationHelpsClient

        async def main():
            async with AsyncTranslationHelpsClient() as client:
                ctx = await client.get_passage_context({
                    "reference": "JHN 3:16",
                    "language": "en",
                })
                print(ctx)

        asyncio.run(main())
    """

    def __init__(
        self,
        server_url: str = DEFAULT_SERVER_URL,
        timeout: float = 90.0,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        if not HAS_HTTPX:
            raise ImportError("AsyncTranslationHelpsClient requires httpx: pip install httpx")
        self.server_url = server_url
        self.timeout = timeout
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **(headers or {}),
        }
        self._request_id = 0
        self._client: Optional[Any] = None

    async def __aenter__(self) -> "AsyncTranslationHelpsClient":
        import httpx
        self._client = httpx.AsyncClient(timeout=self.timeout)
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _call(self, method: str, params: Dict[str, Any]) -> Any:
        import httpx
        self._request_id += 1
        payload = json.dumps({
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }).encode()
        client = self._client or httpx.AsyncClient(timeout=self.timeout)
        response = await client.post(self.server_url, content=payload, headers=self.headers)
        response.raise_for_status()
        return response.json()

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Low-level async tool call."""
        response = await self._call("tools/call", {"name": name, "arguments": arguments})
        result = response.get("result")
        if result is None:
            raise ValueError(f"No result in MCP response: {response}")
        return result  # type: ignore[return-value]

    async def list_tools(self) -> list:
        response = await self._call("tools/list", {})
        return response.get("result", {}).get("tools", [])

    # ---------------------------------------------------------------------------
    # Workflow tools
    # ---------------------------------------------------------------------------

    async def list_languages(self, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Discover available language codes. Optional: filter."""
        return await self.call_tool("list_languages", options or {})

    async def list_resources(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        List resource types available for a language.
        Required: language. Optional: book, reference (filter book-scoped coverage).
        """
        if not options.get("language"):
            raise ValueError("language parameter is required")
        return await self.call_tool("list_resources", options)

    async def get_passage(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Scripture text — all versions (literal, simplified, original UGNT/UHB).
        Cheap and repeatable. Required: reference. Optional: language.
        """
        return await self.call_tool("get_passage", options)

    async def get_passage_context(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 1 (orient): Book/chapter intro notes + resource availability.
        Does NOT include verse text (use get_passage). Required: reference. Optional: language, organization.
        """
        return await self.call_tool("get_passage_context", options)

    async def get_passage_index(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 2 (survey): Compact index of issues + key terms (no full bodies).
        Required: reference. Optional: language, organization.
        """
        return await self.call_tool("get_passage_index", options)

    async def get_note(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 3 (drill): Full note body by ID or all notes for a reference.
        Required: reference. Optional: id, language, organization.
        """
        return await self.call_tool("get_note", options)

    async def get_academy_article(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 3 (drill): Full TA article markdown.
        Required: path (from taArticle.path). Optional: language, organization.
        """
        return await self.call_tool("get_academy_article", options)

    async def get_word_article(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 3 (drill): Full TW article markdown.
        Required: path (from twArticle.path). Optional: language, organization.
        """
        return await self.call_tool("get_word_article", options)

    async def get_questions(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Step 4 (check): Comprehension questions for a passage.
        Required: reference. Optional: language, organization.
        """
        return await self.call_tool("get_questions", options)

    async def search_articles(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Lateral discovery: concept → article path.
        Required: query. Optional: language, resourceTypes, topK.
        """
        return await self.call_tool("search_articles", options)

    async def get_obs_story(self, options: "GetObsStoryOptions") -> Dict[str, Any]:
        """
        Fetch Open Bible Stories text for a story:frame reference.

        Args:
            options: reference (required, e.g. "1:1" or "OBS 1:1"), language (optional, default "en")

        Returns:
            Dictionary with story title, frames (imageUrl, text), and attribution

        Example:
            story = await client.get_obs_story({"reference": "1:1", "language": "en"})
        """
        return await self.call_tool("get_obs_story", options)

    async def get_obs_notes(self, options: "GetObsNotesOptions") -> Dict[str, Any]:
        """
        Fetch OBS Translation Notes for a story:frame reference.

        Args:
            options: reference (required), language (optional, default "en")

        Returns:
            Dictionary with notes list for the requested OBS frame

        Example:
            notes = await client.get_obs_notes({"reference": "1:1", "language": "en"})
        """
        return await self.call_tool("get_obs_notes", options)

    async def get_obs_questions(self, options: "GetObsQuestionsOptions") -> Dict[str, Any]:
        """
        Fetch OBS Translation Questions for a story:frame reference.

        Args:
            options: reference (required), language (optional, default "en")

        Returns:
            Dictionary with questions list for the requested OBS frame

        Example:
            questions = await client.get_obs_questions({"reference": "1:1", "language": "en"})
        """
        return await self.call_tool("get_obs_questions", options)

    @staticmethod
    def parse_result(result: Dict[str, Any]) -> Any:
        """Extract and parse JSON from an MCP tool result."""
        return TranslationHelpsClient.parse_result(result)
