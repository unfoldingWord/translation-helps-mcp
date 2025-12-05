"""
Translation Helps MCP Client

Connects to the Translation Helps MCP server via HTTP (remote).
"""

import json
from typing import Dict, Any, Optional, List
import httpx
from .types import (
    ClientOptions,
    MCPTool,
    MCPPrompt,
    FetchScriptureOptions,
    FetchTranslationNotesOptions,
    FetchTranslationQuestionsOptions,
    FetchTranslationWordOptions,
    FetchTranslationWordLinksOptions,
    FetchTranslationAcademyOptions,
    GetLanguagesOptions,
    ListLanguagesOptions,
    ListSubjectsOptions,
    ListResourcesByLanguageOptions,
    ListResourcesForLanguageOptions,
    SearchTranslationWordAcrossLanguagesOptions,
)

DEFAULT_SERVER_URL = "https://translation-helps-mcp-945.pages.dev/api/mcp"
DEFAULT_TIMEOUT = 30.0


class TranslationHelpsClient:
    """
    Client for connecting to the Translation Helps MCP server.
    
    Example:
        >>> client = TranslationHelpsClient()
        >>> await client.connect()
        >>> scripture = await client.fetch_scripture(reference="John 3:16")
    """

    def __init__(self, options: Optional[ClientOptions] = None):
        """
        Initialize the client.
        
        Args:
            options: Optional client configuration
        """
        options = options or {}
        self.server_url = options.get("serverUrl") or DEFAULT_SERVER_URL
        self.timeout = options.get("timeout") or (DEFAULT_TIMEOUT * 1000)  # Convert to ms
        self.headers = {
            "Content-Type": "application/json",
            **(options.get("headers") or {}),
        }
        self.tools_cache: Optional[List[MCPTool]] = None
        self.prompts_cache: Optional[List[MCPPrompt]] = None
        self.initialized = False
        self._http_client: Optional[httpx.AsyncClient] = None

    async def connect(self) -> None:
        """Initialize connection to the MCP server."""
        if self.initialized:
            return

        try:
            # Create HTTP client
            self._http_client = httpx.AsyncClient(
                timeout=self.timeout / 1000,  # Convert ms to seconds
                headers=self.headers,
            )

            # Initialize the server
            init_response = await self._send_request("initialize")

            if "serverInfo" not in init_response:
                raise ValueError("Invalid server response: missing serverInfo")

            # Cache tools and prompts
            await self._refresh_tools()
            # Prompts may not be supported by all servers - handle gracefully
            try:
                await self._refresh_prompts()
            except Exception as e:
                # If prompts/list is not supported, continue without prompts
                # This allows the SDK to work with servers that only support tools
                self.prompts_cache = []
                if "prompts/list" in str(e) or "500" in str(e):
                    # Server doesn't support prompts - this is okay
                    pass
                else:
                    # Re-raise if it's a different error
                    raise

            self.initialized = True
        except Exception as e:
            raise ConnectionError(
                f"Failed to connect to MCP server: {str(e)}"
            ) from e

    async def close(self) -> None:
        """Close the HTTP client connection."""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        self.initialized = False

    async def __aenter__(self):
        """Async context manager entry."""
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.close()

    async def _send_request(
        self, method: str, params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Send a request to the MCP server."""
        if not self._http_client:
            raise RuntimeError("Client not connected. Call connect() first.")

        payload: Dict[str, Any] = {"method": method}
        if params:
            payload["params"] = params

        try:
            response = await self._http_client.post(
                self.server_url,
                json=payload,
            )
            response.raise_for_status()

            data = response.json()

            # Handle MCP error responses
            if "error" in data:
                raise RuntimeError(
                    data["error"].get("message", "MCP server error")
                )

            return data
        except httpx.HTTPError as e:
            raise ConnectionError(f"HTTP error: {str(e)}") from e

    async def _refresh_tools(self) -> None:
        """Refresh the tools cache."""
        response = await self._send_request("tools/list")
        self.tools_cache = response.get("tools", [])

    async def _refresh_prompts(self) -> None:
        """Refresh the prompts cache."""
        response = await self._send_request("prompts/list")
        self.prompts_cache = response.get("prompts", [])

    async def _ensure_initialized(self) -> None:
        """Ensure the client is initialized."""
        if not self.initialized:
            await self.connect()

    async def list_tools(self) -> List[MCPTool]:
        """List available tools."""
        await self._ensure_initialized()
        if not self.tools_cache:
            await self._refresh_tools()
        return self.tools_cache or []

    async def list_prompts(self) -> List[MCPPrompt]:
        """List available prompts."""
        await self._ensure_initialized()
        if not self.prompts_cache:
            await self._refresh_prompts()
        return self.prompts_cache or []

    async def call_tool(
        self, name: str, arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call a tool by name."""
        await self._ensure_initialized()
        return await self._send_request("tools/call", {
            "name": name,
            "arguments": arguments,
        })

    async def get_prompt(
        self, name: str, arguments: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Get a prompt template."""
        await self._ensure_initialized()
        return await self._send_request("prompts/get", {
            "name": name,
            "arguments": arguments or {},
        })

    # Convenience methods for common operations

    async def fetch_scripture(
        self, options: FetchScriptureOptions
    ) -> str:
        """Fetch Bible scripture text."""
        response = await self.call_tool("fetch_scripture", {
            "reference": options["reference"],
            "language": options.get("language", "en"),
            "organization": options.get("organization", "unfoldingWord"),
            "format": options.get("format", "text"),
            "includeVerseNumbers": options.get("includeVerseNumbers", True),
        })

        # Extract text from response
        if response.get("content") and response["content"][0].get("text"):
            return response["content"][0]["text"]

        raise ValueError("Invalid response format from fetch_scripture")

    async def fetch_translation_notes(
        self, options: FetchTranslationNotesOptions
    ) -> Dict[str, Any]:
        """Fetch translation notes."""
        response = await self.call_tool("fetch_translation_notes", {
            "reference": options["reference"],
            "language": options.get("language", "en"),
            "organization": options.get("organization", "unfoldingWord"),
            "includeIntro": options.get("includeIntro", True),
            "includeContext": options.get("includeContext", True),
        })

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_notes")

    async def fetch_translation_questions(
        self, options: FetchTranslationQuestionsOptions
    ) -> Dict[str, Any]:
        """Fetch translation questions."""
        response = await self.call_tool("fetch_translation_questions", {
            "reference": options["reference"],
            "language": options.get("language", "en"),
            "organization": options.get("organization", "unfoldingWord"),
        })

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_questions")

    async def fetch_translation_word(
        self, options: FetchTranslationWordOptions
    ) -> Dict[str, Any]:
        """Fetch translation word (by term or reference)."""
        response = await self.call_tool("fetch_translation_word", {
            "reference": options.get("reference"),
            "term": options.get("term"),
            "language": options.get("language", "en"),
            "organization": options.get("organization", "unfoldingWord"),
            "category": options.get("category"),
        })

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_word")

    async def fetch_translation_word_links(
        self, options: FetchTranslationWordLinksOptions
    ) -> Dict[str, Any]:
        """Fetch translation word links."""
        response = await self.call_tool("fetch_translation_word_links", {
            "reference": options["reference"],
            "language": options.get("language", "en"),
            "organization": options.get("organization", "unfoldingWord"),
        })

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_word_links")

    async def fetch_translation_academy(
        self, options: FetchTranslationAcademyOptions
    ) -> Any:
        """Fetch translation academy articles."""
        response = await self.call_tool("fetch_translation_academy", {
            "reference": options.get("reference"),
            "rcLink": options.get("rcLink"),
            "moduleId": options.get("moduleId"),
            "path": options.get("path"),
            "language": options.get("language", "en"),
            "organization": options.get("organization", "unfoldingWord"),
            "format": options.get("format", "json"),
        })

        if response.get("content") and response["content"][0].get("text"):
            text = response["content"][0]["text"]
            if options.get("format") == "markdown":
                return text
            return json.loads(text)

        raise ValueError("Invalid response format from fetch_translation_academy")

    async def get_languages(
        self, options: Optional[GetLanguagesOptions] = None
    ) -> Dict[str, Any]:
        """Get available languages."""
        options = options or {}
        response = await self.call_tool("get_languages", {
            "organization": options.get("organization"),
        })

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from get_languages")

    async def list_languages(
        self, options: Optional[ListLanguagesOptions] = None
    ) -> Dict[str, Any]:
        """
        List available languages from Door43 catalog.
        
        Args:
            options: Optional filtering options (organization, stage)
            
        Returns:
            Dictionary with languages array and metadata
        """
        options = options or {}
        response = await self.call_tool("list_languages", {
            "organization": options.get("organization"),
            "stage": options.get("stage", "prod"),
        })

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from list_languages")

    async def list_subjects(
        self, options: Optional[ListSubjectsOptions] = None
    ) -> Dict[str, Any]:
        """
        List available resource subjects from Door43 catalog.
        
        Args:
            options: Optional filtering options (language, organization, stage)
            
        Returns:
            Dictionary with subjects array and metadata
        """
        options = options or {}
        response = await self.call_tool("list_subjects", {
            "language": options.get("language"),
            "organization": options.get("organization"),
            "stage": options.get("stage", "prod"),
        })

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from list_subjects")

    async def list_resources_by_language(
        self, options: Optional[ListResourcesByLanguageOptions] = None
    ) -> Dict[str, Any]:
        """
        List resources organized by language.
        
        NOTE: Makes multiple parallel API calls (~4-5s first time, cached afterward).
        For faster single-language discovery, use list_resources_for_language instead.
        
        Args:
            options: Optional filtering options (subjects, organization, stage, limit, topic)
            
        Returns:
            Dictionary with resources grouped by language
        """
        options = options or {}
        params: Dict[str, Any] = {
            "stage": options.get("stage", "prod"),
        }
        
        if options.get("subjects"):
            # Handle both string and list
            subjects = options["subjects"]
            params["subjects"] = subjects if isinstance(subjects, str) else ",".join(subjects)
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
        if options.get("limit"):
            params["limit"] = options["limit"]
        if options.get("topic"):
            params["topic"] = options["topic"]

        response = await self.call_tool("list_resources_by_language", params)

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from list_resources_by_language")

    async def list_resources_for_language(
        self, options: ListResourcesForLanguageOptions
    ) -> Dict[str, Any]:
        """
        List all resources for a specific language (RECOMMENDED - much faster!).
        
        Single API call (~1-2 seconds). Use this after list_languages() to discover
        what's available for a chosen language.
        
        Args:
            options: Language (required) and optional filters (organization, stage, subject, limit, topic)
            
        Returns:
            Dictionary with resources for the specified language organized by subject
            
        Example:
            >>> resources = await client.list_resources_for_language({
            ...     "language": "es-419",
            ...     "topic": "tc-ready"
            ... })
            >>> print(f"Found {resources['totalResources']} resources")
        """
        if not options.get("language"):
            raise ValueError("language parameter is required for list_resources_for_language")
        
        params: Dict[str, Any] = {
            "language": options["language"],
            "stage": options.get("stage", "prod"),
        }
        
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
        if options.get("subject"):
            params["subject"] = options["subject"]
        if options.get("limit"):
            params["limit"] = options["limit"]
        if options.get("topic"):
            params["topic"] = options["topic"]

        response = await self.call_tool("list_resources_for_language", params)

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from list_resources_for_language")

    async def search_translation_word_across_languages(
        self, options: SearchTranslationWordAcrossLanguagesOptions
    ) -> Dict[str, Any]:
        """
        Search for a translation word term across multiple languages.
        
        Useful when a term is not found in the current language or when you want
        to find all languages that have a specific term available.
        
        Args:
            options: Term (required) and optional filters (languages, organization, limit)
            
        Returns:
            Dictionary with search results showing which languages have the term
            
        Example:
            >>> results = await client.search_translation_word_across_languages({
            ...     "term": "love",
            ...     "languages": ["en", "es-419", "fr"],
            ...     "limit": 10
            ... })
            >>> print(f"Found in {len([r for r in results['results'] if r['found']])} languages")
        """
        if not options.get("term"):
            raise ValueError("term parameter is required for search_translation_word_across_languages")
        
        params: Dict[str, Any] = {
            "term": options["term"],
            "organization": options.get("organization", "unfoldingWord"),
            "limit": options.get("limit", 20),
        }
        
        if options.get("languages"):
            params["languages"] = options["languages"]

        response = await self.call_tool("search_translation_word_across_languages", params)

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from search_translation_word_across_languages")

    async def get_system_prompt(
        self, include_implementation_details: bool = False
    ) -> str:
        """Get system prompt."""
        response = await self.call_tool("get_system_prompt", {
            "includeImplementationDetails": include_implementation_details,
        })

        if response.get("content") and response["content"][0].get("text"):
            return response["content"][0]["text"]

        raise ValueError("Invalid response format from get_system_prompt")

    def is_connected(self) -> bool:
        """Check if client is initialized."""
        return self.initialized

    async def check_prompts_support(self) -> bool:
        """
        Dynamically check if the MCP server supports prompts.
        
        This attempts to call prompts/list and returns True if successful,
        False if prompts are not supported.
        
        Returns:
            True if the server supports prompts, False otherwise
            
        Example:
            >>> if await client.check_prompts_support():
            ...     # Server supports prompts - use them natively
            ...     prompts = await client.list_prompts()
        """
        await self._ensure_initialized()
        try:
            await self._refresh_prompts()
            return True
        except Exception:
            return False

    async def get_capabilities(self) -> Dict[str, Any]:
        """
        Get the server's capabilities by checking what's actually supported.
        
        This dynamically checks if tools and prompts are supported by attempting
        to use them, rather than relying on cached initialization data.
        
        Returns:
            Dictionary with capabilities information
            
        Example:
            >>> await client.connect()
            >>> caps = await client.get_capabilities()
            >>> if caps.get("prompts_supported"):
            ...     print("Server supports prompts")
        """
        await self._ensure_initialized()
        
        capabilities = {
            "tools_supported": self.tools_cache is not None and len(self.tools_cache) > 0,
            "prompts_supported": False
        }
        
        # Check prompts support dynamically
        try:
            capabilities["prompts_supported"] = await self.check_prompts_support()
        except Exception:
            capabilities["prompts_supported"] = False
        
        return capabilities

