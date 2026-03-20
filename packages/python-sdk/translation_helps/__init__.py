"""
Translation Helps MCP Client SDK

Official Python client for connecting to the Translation Helps MCP server.

Core Functionality:
- TranslationHelpsClient: MCP protocol client for tools, prompts, and resources
- All MCP protocol methods (list_tools, list_prompts, call_tool, get_prompt, etc.)

Optional Adapter Utilities:
- Adapter functions in adapters module are OPTIONAL convenience helpers
- Use them if you want provider-specific conversions, or write your own logic
- Core client works with any MCP-compatible interface (Claude Desktop, Cursor, etc.)
"""

from .client import TranslationHelpsClient
from .types import (
    ClientOptions,
    FetchScriptureOptions,
    FetchTranslationNotesOptions,
    FetchTranslationQuestionsOptions,
    FetchTranslationWordOptions,
    FetchTranslationWordLinksOptions,
    FetchTranslationAcademyOptions,
    ListLanguagesOptions,
    ListSubjectsOptions,
    ListResourcesForLanguageOptions,
    MCPTool,
    MCPPrompt,
)
from .adapters import (
    convert_tools_to_openai,
    convert_prompts_to_openai,
    convert_tools_to_anthropic,
    convert_all_to_openai,
    provider_supports_prompts,
    get_prompt_strategy,
    detect_prompts_support_from_client,
    prepare_tools_for_provider,
)
from .prompts import (
    get_system_prompt,
    detect_request_type,
    RequestType,
)
# Interceptor components
from .context_manager import ContextManager
from .state_injection_interceptor import (
    StateInjectionInterceptor,
    InterceptorOptions,
    InterceptionResult
)
from .default_tool_config import (
    DEFAULT_TOOL_CONTEXT_CONFIG,
    PERSISTENT_CONTEXT_KEYS,
    VOLATILE_CONTEXT_KEYS,
    create_tool_config,
    bulk_add_context_requirements
)
from .validators import (
    LANGUAGE_CODE_VALIDATOR,
    ORGANIZATION_VALIDATOR,
    RESOURCE_TYPE_VALIDATOR,
    REFERENCE_VALIDATOR,
    BOOK_CODE_VALIDATOR,
    CHAPTER_VALIDATOR,
    VERSE_VALIDATOR,
    FORMAT_VALIDATOR,
    BOOLEAN_VALIDATOR,
    STAGE_VALIDATOR,
    create_string_length_validator,
    create_number_range_validator,
    create_enum_validator,
    create_composite_validator
)

__version__ = "1.6.0"  # Bumped for State Injection Interceptor feature
__all__ = [
    "TranslationHelpsClient",
    "ClientOptions",
    "FetchScriptureOptions",
    "FetchTranslationNotesOptions",
    "FetchTranslationQuestionsOptions",
    "FetchTranslationWordOptions",
    "FetchTranslationWordLinksOptions",
    "FetchTranslationAcademyOptions",
    "ListLanguagesOptions",
    "ListSubjectsOptions",
    "ListResourcesForLanguageOptions",
    "MCPTool",
    "MCPPrompt",
    "convert_tools_to_openai",
    "convert_prompts_to_openai",
    "convert_tools_to_anthropic",
    "convert_all_to_openai",
    "provider_supports_prompts",
    "get_prompt_strategy",
    "detect_prompts_support_from_client",
    "prepare_tools_for_provider",
    "get_system_prompt",
    "detect_request_type",
    "RequestType",
    # Interceptor
    "ContextManager",
    "StateInjectionInterceptor",
    "InterceptorOptions",
    "InterceptionResult",
    "DEFAULT_TOOL_CONTEXT_CONFIG",
    "PERSISTENT_CONTEXT_KEYS",
    "VOLATILE_CONTEXT_KEYS",
    "create_tool_config",
    "bulk_add_context_requirements",
    # Validators
    "LANGUAGE_CODE_VALIDATOR",
    "ORGANIZATION_VALIDATOR",
    "RESOURCE_TYPE_VALIDATOR",
    "REFERENCE_VALIDATOR",
    "BOOK_CODE_VALIDATOR",
    "CHAPTER_VALIDATOR",
    "VERSE_VALIDATOR",
    "FORMAT_VALIDATOR",
    "BOOLEAN_VALIDATOR",
    "STAGE_VALIDATOR",
    "create_string_length_validator",
    "create_number_range_validator",
    "create_enum_validator",
    "create_composite_validator",
]

