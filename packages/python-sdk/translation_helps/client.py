"""
Translation Helps MCP Client v2 — Python

Connects to the MCP server via Streamable HTTP at /mcp.
Compatible with Python 3.8+ (uses httpx for async HTTP).
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


DEFAULT_SERVER_URL = "https://translation-helps-mcp.workers.dev/mcp"


class TranslationHelpsClient:
    """
    Synchronous client for Translation Helps MCP v2.

    Example::

        client = TranslationHelpsClient()
        result = client.get_bundle({"reference": "JHN 3:16", "language": "en"})
        print(result["content"][0]["text"])
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
            "Accept": "application/json",
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
    # Typed convenience methods
    # ---------------------------------------------------------------------------

    def fetch_scripture(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Fetch Bible text. Required: reference."""
        return self.call_tool("fetch_scripture", options)

    def fetch_translation_notes(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Fetch translation notes. Required: reference."""
        return self.call_tool("fetch_translation_notes", options)

    def fetch_translation_questions(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Fetch comprehension questions. Required: reference."""
        return self.call_tool("fetch_translation_questions", options)

    def fetch_translation_word_links(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """List translation word paths at a reference. Required: reference."""
        return self.call_tool("fetch_translation_word_links", options)

    def fetch_translation_word(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Get a translation word article. Provide path or term."""
        return self.call_tool("fetch_translation_word", options)

    def fetch_translation_academy(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Get a Translation Academy article. Required: path."""
        return self.call_tool("fetch_translation_academy", options)

    def list_languages(self, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """List available language codes."""
        return self.call_tool("list_languages", options or {})

    def list_subjects(self) -> Dict[str, Any]:
        """List resource subject types."""
        return self.call_tool("list_subjects", {})

    def list_resources_for_language(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """List resources for a language. Required: language."""
        return self.call_tool("list_resources_for_language", options)

    def rag_query(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Semantic search over translation resources. Required: query."""
        return self.call_tool("rag_query", options)

    def get_bundle(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Get all translation helps for a passage. Required: reference."""
        return self.call_tool("get_bundle", options)

    def index_resource(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Admin: index a resource. Required: language, subject, adminToken."""
        return self.call_tool("index_resource", options)

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
