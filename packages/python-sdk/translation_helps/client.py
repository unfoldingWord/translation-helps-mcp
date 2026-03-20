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
    ListLanguagesOptions,
    ListSubjectsOptions,
    ListResourcesForLanguageOptions,
)
from .context_manager import ContextManager
from .state_injection_interceptor import (
    StateInjectionInterceptor,
    InterceptorOptions,
    ToolContextConfig
)
from .default_tool_config import DEFAULT_TOOL_CONTEXT_CONFIG
from .validators import (
    LANGUAGE_CODE_VALIDATOR,
    ORGANIZATION_VALIDATOR,
    STAGE_VALIDATOR,
    REFERENCE_VALIDATOR,
    FORMAT_VALIDATOR,
    BOOLEAN_VALIDATOR
)

DEFAULT_SERVER_URL = "https://tc-helps.mcp.servant.bible/api/mcp"
DEFAULT_TIMEOUT = 90.0  # Increased from 30s to 90s for cold cache scenarios (DCS ZIP downloads can be slow)


class TranslationHelpsClient:
    """
    Client for connecting to the Translation Helps MCP server.
    
    Example:
        >>> client = TranslationHelpsClient()
        >>> await client.connect()
        >>> scripture = await client.fetch_scripture(reference="John 3:16")
    """

    def __init__(
        self,
        options: Optional[ClientOptions] = None,
        enable_interceptor: bool = False,
        tool_context_config: Optional[ToolContextConfig] = None,
        interceptor_options: Optional[InterceptorOptions] = None,
        initial_context: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize the client.
        
        Args:
            options: Optional client configuration
            enable_interceptor: Enable state injection interceptor
            tool_context_config: Custom tool-to-context mapping (uses DEFAULT_TOOL_CONTEXT_CONFIG if not provided)
            interceptor_options: Interceptor configuration options
            initial_context: Initial context values to pre-populate
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
        
        # Initialize Context Manager
        self._context_manager = ContextManager()
        self._interceptor: Optional[StateInjectionInterceptor] = None
        self._interceptor_enabled = False
        
        # Register validation rules
        self._context_manager.add_validation_rule('language', LANGUAGE_CODE_VALIDATOR)
        self._context_manager.add_validation_rule('organization', ORGANIZATION_VALIDATOR)
        self._context_manager.add_validation_rule('stage', STAGE_VALIDATOR)
        self._context_manager.add_validation_rule('reference', REFERENCE_VALIDATOR)
        self._context_manager.add_validation_rule('format', FORMAT_VALIDATOR)
        self._context_manager.add_validation_rule('includeAlignment', BOOLEAN_VALIDATOR)
        self._context_manager.add_validation_rule('includeContext', BOOLEAN_VALIDATOR)
        self._context_manager.add_validation_rule('includeIntro', BOOLEAN_VALIDATOR)
        
        # Initialize interceptor if enabled
        if enable_interceptor:
            self.enable_state_injection(tool_context_config, interceptor_options)
        
        # Pre-populate context if provided
        if initial_context:
            self._context_manager.set_many(initial_context)

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

            # Handle JSON-RPC 2.0 format - serverInfo is in result.serverInfo or directly in response
            # The _send_request method now extracts result, so serverInfo should be directly accessible
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

            # Handle MCP error responses (JSON-RPC 2.0 format)
            if "error" in data:
                raise RuntimeError(
                    data["error"].get("message", "MCP server error")
                )

            # Extract result from JSON-RPC 2.0 format if present
            # The server now always returns JSON-RPC 2.0 format: { jsonrpc: "2.0", result: {...}, id: ... }
            # But we need to support both formats for backward compatibility
            response_data = data.get("result") if "result" in data else data

            return response_data
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
        """
        Call a tool by name (with interceptor support).
        
        Args:
            name: Tool name
            arguments: Tool arguments
            
        Returns:
            Tool response with optional state_injection metadata
        """
        await self._ensure_initialized()
        
        # Apply state injection interceptor if enabled
        final_arguments = arguments
        interception_metadata = None
        
        if self._interceptor_enabled and self._interceptor:
            result = self._interceptor.intercept(name, arguments)
            final_arguments = result.arguments
            
            # Store metadata for debugging/logging
            if result.modified:
                interception_metadata = {
                    'injected': result.injected,
                    'synced': result.synced,
                    'original_args': arguments,
                    'final_args': final_arguments
                }
                
                print(f'[SDK] 🔄 State Injection Applied: tool={name}, '
                      f'injected={list(result.injected.keys())}, '
                      f'synced={list(result.synced.keys())}')
        
        # Call the MCP server with potentially modified arguments
        response = await self._send_request("tools/call", {
            "name": name,
            "arguments": final_arguments,
        })
        
        # Attach interception metadata if available
        if interception_metadata:
            if not isinstance(response, dict):
                response = {'result': response}
            response['_state_injection'] = interception_metadata
        
        return response

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
        params: Dict[str, Any] = {
            "reference": options["reference"],
            "language": options.get("language", "en"),
            "format": options.get("format", "text"),
            "includeVerseNumbers": options.get("includeVerseNumbers", True),
        }
        
        # Only include organization if explicitly provided (defaults to searching all orgs)
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
        
        # Add optional parameters if provided
        if options.get("resource") is not None:
            params["resource"] = options["resource"]
        if options.get("includeAlignment") is not None:
            params["includeAlignment"] = options["includeAlignment"]
        
        response = await self.call_tool("fetch_scripture", params)

        # Extract text from response
        if response.get("content") and response["content"][0].get("text"):
            return response["content"][0]["text"]

        raise ValueError("Invalid response format from fetch_scripture")

    async def fetch_translation_notes(
        self, options: FetchTranslationNotesOptions
    ) -> Dict[str, Any]:
        """Fetch translation notes.

        Omit ``organization`` to search all Door43 organizations. For languages such as
        Spanish, notes are usually not under unfoldingWord—passing only reference and
        language is the right default.
        """
        params: Dict[str, Any] = {
            "reference": options["reference"],
            "language": options.get("language", "en"),
            "includeIntro": options.get("includeIntro", True),
            "includeContext": options.get("includeContext", True),
        }
        
        # Only include organization if explicitly provided
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
            
        response = await self.call_tool("fetch_translation_notes", params)

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_notes")

    async def fetch_translation_questions(
        self, options: FetchTranslationQuestionsOptions
    ) -> Dict[str, Any]:
        """Fetch translation questions."""
        params: Dict[str, Any] = {
            "reference": options["reference"],
            "language": options.get("language", "en"),
        }
        
        # Only include organization if explicitly provided
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
            
        response = await self.call_tool("fetch_translation_questions", params)

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_questions")

    async def fetch_translation_word(
        self, options: FetchTranslationWordOptions
    ) -> Dict[str, Any]:
        """Fetch translation word (by term or reference)."""
        params: Dict[str, Any] = {
            "reference": options.get("reference"),
            "term": options.get("term"),
            "language": options.get("language", "en"),
            "category": options.get("category"),
        }
        
        # Only include organization if explicitly provided
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
            
        response = await self.call_tool("fetch_translation_word", params)

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_word")

    async def fetch_translation_word_links(
        self, options: FetchTranslationWordLinksOptions
    ) -> Dict[str, Any]:
        """Fetch translation word links."""
        params: Dict[str, Any] = {
            "reference": options["reference"],
            "language": options.get("language", "en"),
        }
        
        # Only include organization if explicitly provided
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
            
        response = await self.call_tool("fetch_translation_word_links", params)

        if response.get("content") and response["content"][0].get("text"):
            return json.loads(response["content"][0]["text"])

        raise ValueError("Invalid response format from fetch_translation_word_links")

    async def fetch_translation_academy(
        self, options: FetchTranslationAcademyOptions
    ) -> Any:
        """Fetch translation academy articles."""
        params: Dict[str, Any] = {
            "reference": options.get("reference"),
            "rcLink": options.get("rcLink"),
            "moduleId": options.get("moduleId"),
            "path": options.get("path"),
            "language": options.get("language", "en"),
            "format": options.get("format", "json"),
        }
        
        # Only include organization if explicitly provided
        if options.get("organization") is not None:
            params["organization"] = options["organization"]
            
        response = await self.call_tool("fetch_translation_academy", params)

        if response.get("content") and response["content"][0].get("text"):
            text = response["content"][0]["text"]
            if options.get("format") == "markdown":
                return text
            return json.loads(text)

        raise ValueError("Invalid response format from fetch_translation_academy")


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

    async def list_resources_for_language(
        self, options: ListResourcesForLanguageOptions
    ) -> Dict[str, Any]:
        """
        List all resources for a specific language (RECOMMENDED - much faster!).
        
        Single API call (~1-2 seconds). Use this after list_languages() to discover
        what's available for a chosen language.
        
        Args:
            options: Language (required) and optional filters
            options["topic"]: Filter by topic tag. Defaults to "tc-ready" if not provided.
            
        Returns:
            Dictionary with resources for the specified language organized by subject
            
        Example:
            >>> resources = await client.list_resources_for_language({
            ...     "language": "es-419"
            ...     # topic defaults to "tc-ready" if not specified
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


    # ============================================================================
    # State Injection Interceptor Methods
    # ============================================================================
    
    def enable_state_injection(
        self,
        tool_config: Optional[ToolContextConfig] = None,
        options: Optional[InterceptorOptions] = None
    ) -> None:
        """
        Enable the State Injection Interceptor.
        
        Args:
            tool_config: Custom tool-to-context mapping (uses DEFAULT_TOOL_CONTEXT_CONFIG if not provided)
            options: Interceptor configuration options
        """
        final_config = tool_config or DEFAULT_TOOL_CONTEXT_CONFIG
        self._interceptor = StateInjectionInterceptor(
            self._context_manager,
            final_config,
            options or InterceptorOptions()
        )
        self._interceptor_enabled = True

    def disable_state_injection(self) -> None:
        """Disable the State Injection Interceptor."""
        self._interceptor = None
        self._interceptor_enabled = False

    def get_context_manager(self) -> ContextManager:
        """Get the context manager instance."""
        return self._context_manager

    def get_interceptor(self) -> Optional[StateInjectionInterceptor]:
        """Get the interceptor instance."""
        return self._interceptor

    def set_context(self, key: str, value: Any) -> bool:
        """
        Set a context value.
        
        Args:
            key: Context key
            value: Context value
            
        Returns:
            True if value was set successfully, False if validation failed
        """
        return self._context_manager.set(key, value)

    def get_context(self, key: str, default: Any = None) -> Any:
        """
        Get a context value.
        
        Args:
            key: Context key
            default: Default value if key doesn't exist
            
        Returns:
            Context value or default
        """
        return self._context_manager.get(key, default)

    def set_context_many(self, values: Dict[str, Any]) -> Dict[str, bool]:
        """
        Set multiple context values at once.
        
        Args:
            values: Dictionary of key-value pairs
            
        Returns:
            Dictionary mapping keys to success status (True/False)
        """
        return self._context_manager.set_many(values)

    def clear_context(self) -> None:
        """Clear all context."""
        self._context_manager.clear()

    def get_all_context(self) -> Dict[str, Any]:
        """Get all context values."""
        return self._context_manager.get_all()

    # ============================================================================
    # End State Injection Interceptor Methods
    # ============================================================================

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

