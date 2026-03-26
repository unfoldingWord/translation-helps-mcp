"""
Default tool-to-context mapping for Translation Helps MCP Server

This configuration defines which context parameters each tool requires.
The StateInjectionInterceptor uses this to automatically inject missing parameters.
"""

from typing import Dict, List


# Type alias
ToolContextConfig = Dict[str, List[str]]


# Default context requirements for Translation Helps MCP tools.
# Catalog owner scope is all-org on the server; inject language and stage only.
DEFAULT_TOOL_CONTEXT_CONFIG: ToolContextConfig = {
    # Scripture / helps: language and stage auto-injected
    'fetch_scripture': ['language', 'stage'],
    
    # Translation Notes tools
    'fetch_translation_notes': ['language', 'stage'],
    
    # Translation Questions tools
    'fetch_translation_questions': ['language', 'stage'],
    
    # Translation Words tools
    'fetch_translation_word': ['language', 'stage'],
    'fetch_translation_word_links': ['language', 'stage'],
    
    # Translation Academy tools
    'fetch_translation_academy': ['language', 'stage'],
    
    # Discovery tools - these typically don't need context injection
    # but may benefit from stage defaults
    'list_languages': ['stage'],
    'list_subjects': ['stage'],
    'list_resources_for_language': ['stage']
}


# Context keys that should be persisted across the session
PERSISTENT_CONTEXT_KEYS = [
    'language',
    'stage'
]


# Context keys that should be reset between conversations
VOLATILE_CONTEXT_KEYS = [
    'reference',
    'book',
    'chapter',
    'verse'
]


def create_tool_config(custom_config: Dict[str, List[str]]) -> ToolContextConfig:
    """
    Helper function to create a custom tool config by merging with defaults.
    
    Args:
        custom_config: Custom tool configuration to merge with defaults
        
    Returns:
        Merged tool configuration
        
    Examples:
        >>> config = create_tool_config({
        ...     'my_custom_tool': ['language', 'customParam']
        ... })
        >>> 'fetch_scripture' in config
        True
        >>> config['my_custom_tool']
        ['language', 'customParam']
    """
    return {**DEFAULT_TOOL_CONTEXT_CONFIG, **custom_config}


def bulk_add_context_requirements(
    base_config: ToolContextConfig,
    tool_names: List[str],
    context_keys: List[str]
) -> ToolContextConfig:
    """
    Helper function to add context requirements to multiple tools at once.
    
    Args:
        base_config: Base tool configuration
        tool_names: List of tool names to update
        context_keys: Context keys to add to each tool
        
    Returns:
        Updated tool configuration
        
    Examples:
        >>> config = DEFAULT_TOOL_CONTEXT_CONFIG.copy()
        >>> config = bulk_add_context_requirements(
        ...     config,
        ...     ['fetch_scripture', 'fetch_translation_notes'],
        ...     ['customParam']
        ... )
        >>> 'customParam' in config['fetch_scripture']
        True
    """
    new_config = base_config.copy()
    
    for tool_name in tool_names:
        existing = new_config.get(tool_name, [])
        # Merge and deduplicate
        new_config[tool_name] = list(set(existing + context_keys))
    
    return new_config
