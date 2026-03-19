"""
StateInjectionInterceptor - Automatically inject missing parameters from context

This interceptor middleware:
1. Checks which context parameters a tool requires
2. Injects missing parameters from the ContextManager
3. Syncs explicitly-provided parameters back to context
4. Validates parameters before storing
"""

from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass, field

from .context_manager import ContextManager, ContextValue


# Type aliases
ToolContextConfig = Dict[str, List[str]]  # tool_name -> [context_keys]


@dataclass
class InterceptorOptions:
    """Configuration options for the interceptor."""
    
    debug: bool = False
    log_prefix: str = "[StateInjectionInterceptor]"
    on_missing_required_param: Optional[Callable[[str, str], None]] = None
    on_context_injected: Optional[Callable[[str, Dict[str, ContextValue]], None]] = None
    on_context_synced: Optional[Callable[[str, Dict[str, ContextValue]], None]] = None


@dataclass
class InterceptionResult:
    """Result of intercepting a tool call."""
    
    arguments: Dict[str, Any]
    injected: Dict[str, ContextValue] = field(default_factory=dict)
    synced: Dict[str, ContextValue] = field(default_factory=dict)
    modified: bool = False


class StateInjectionInterceptor:
    """
    State Injection Interceptor
    
    Manages automatic parameter injection and context synchronization.
    
    Examples:
        >>> context_manager = ContextManager()
        >>> interceptor = StateInjectionInterceptor(
        ...     context_manager,
        ...     {'fetch_scripture': ['language', 'organization']}
        ... )
        >>> context_manager.set('language', 'en')
        >>> result = interceptor.intercept('fetch_scripture', {'reference': 'John 3:16'})
        >>> result.arguments['language']
        'en'
    """
    
    def __init__(
        self,
        context_manager: ContextManager,
        tool_config: ToolContextConfig,
        options: Optional[InterceptorOptions] = None
    ):
        """
        Initialize the interceptor.
        
        Args:
            context_manager: Context manager instance
            tool_config: Mapping of tool names to required context keys
            options: Interceptor configuration options
        """
        self._context_manager = context_manager
        self._tool_config = tool_config
        self._options = options or InterceptorOptions()
    
    def intercept(
        self,
        tool_name: str,
        tool_arguments: Dict[str, Any]
    ) -> InterceptionResult:
        """
        Intercept a tool call and inject/sync context as needed.
        
        Args:
            tool_name: Name of the MCP tool being called
            tool_arguments: Arguments provided by the LLM
            
        Returns:
            InterceptionResult with modified arguments
        """
        result = InterceptionResult(
            arguments=tool_arguments.copy()
        )
        
        # Check if this tool has context requirements
        required_context_keys = self._tool_config.get(tool_name, [])
        if not required_context_keys:
            self._log(f"No context requirements for tool: {tool_name}")
            return result
        
        self._log(
            f"Intercepting tool: {tool_name}",
            {
                'required_keys': required_context_keys,
                'provided_args': list(tool_arguments.keys())
            }
        )
        
        # Process each required context key
        for context_key in required_context_keys:
            # Case 1: Argument explicitly provided → Sync to context
            if context_key in tool_arguments and tool_arguments[context_key] is not None:
                provided_value = tool_arguments[context_key]
                sync_success = self._context_manager.set(context_key, provided_value)
                
                if sync_success:
                    result.synced[context_key] = provided_value
                    result.modified = True
                    self._log(f"Synced context: {context_key} = {provided_value}")
                else:
                    self._log(f"Failed to sync context (validation failed): {context_key}")
            
            # Case 2: Argument missing → Inject from context
            elif self._context_manager.has(context_key):
                context_value = self._context_manager.get(context_key)
                result.arguments[context_key] = context_value
                result.injected[context_key] = context_value
                result.modified = True
                self._log(f"Injected context: {context_key} = {context_value}")
            
            # Case 3: Missing and not in context → Log warning
            else:
                self._log(
                    f"⚠️ Missing required parameter: {context_key} "
                    "(not in arguments or context)"
                )
                if self._options.on_missing_required_param:
                    self._options.on_missing_required_param(tool_name, context_key)
        
        # Emit events if changes were made
        if result.injected and self._options.on_context_injected:
            self._options.on_context_injected(tool_name, result.injected)
        
        if result.synced and self._options.on_context_synced:
            self._options.on_context_synced(tool_name, result.synced)
        
        return result
    
    def update_tool_config(self, new_config: ToolContextConfig) -> None:
        """
        Update the tool configuration.
        
        Args:
            new_config: New tool configuration to merge with existing
        """
        self._tool_config.update(new_config)
    
    def get_tool_config(self) -> ToolContextConfig:
        """
        Get current tool configuration (as a copy).
        
        Returns:
            Dictionary mapping tool names to required context keys
        """
        return self._tool_config.copy()
    
    def add_tool_requirements(self, tool_name: str, context_keys: List[str]) -> None:
        """
        Add context requirements for a specific tool.
        
        Args:
            tool_name: Name of the tool
            context_keys: List of context keys required by this tool
        """
        existing = self._tool_config.get(tool_name, [])
        # Merge and deduplicate
        self._tool_config[tool_name] = list(set(existing + context_keys))
    
    def remove_tool_requirements(self, tool_name: str) -> None:
        """
        Remove context requirements for a specific tool.
        
        Args:
            tool_name: Name of the tool to remove requirements for
        """
        if tool_name in self._tool_config:
            del self._tool_config[tool_name]
    
    def _log(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """
        Internal logging method.
        
        Args:
            message: Log message
            data: Optional data to include in log
        """
        if self._options.debug:
            if data:
                print(f"{self._options.log_prefix} {message}", data)
            else:
                print(f"{self._options.log_prefix} {message}")
    
    def __repr__(self) -> str:
        """String representation of the interceptor."""
        return (
            f"StateInjectionInterceptor("
            f"tools={list(self._tool_config.keys())}, "
            f"debug={self._options.debug})"
        )
