"""
ContextManager - Generic state store for client-side session context

Manages dynamic key-value pairs that can be automatically injected
into MCP tool calls when the LLM drops implicit context parameters.
"""

from typing import Any, Callable, Dict, Optional, Protocol


class ValidationRule(Protocol):
    """Protocol for validation rules."""
    
    def validate(self, value: Any) -> bool:
        """Validate a value."""
        ...
    
    @property
    def error_message(self) -> str:
        """Get error message for validation failure."""
        ...


class Validator:
    """Concrete implementation of ValidationRule."""
    
    def __init__(self, validate_fn: Callable[[Any], bool], error_message: str):
        self._validate_fn = validate_fn
        self._error_message = error_message
    
    def validate(self, value: Any) -> bool:
        """Validate a value using the validation function."""
        return self._validate_fn(value)
    
    @property
    def error_message(self) -> str:
        """Get the error message."""
        return self._error_message


ContextValue = Any
ContextStore = Dict[str, ContextValue]
ValidationRules = Dict[str, ValidationRule]


class ContextManager:
    """
    Generic context manager for storing and retrieving session state.
    
    Examples:
        >>> context = ContextManager()
        >>> context.set('language', 'en')
        True
        >>> context.get('language')
        'en'
        >>> context.has('language')
        True
    """
    
    def __init__(self):
        """Initialize the context manager."""
        self._store: ContextStore = {}
        self._validation_rules: ValidationRules = {}
    
    def get(self, key: str, default: Optional[ContextValue] = None) -> Optional[ContextValue]:
        """
        Get a value from the context store.
        
        Args:
            key: The context key to retrieve
            default: Default value if key doesn't exist
            
        Returns:
            The stored value or default
        """
        return self._store.get(key, default)
    
    def set(self, key: str, value: ContextValue) -> bool:
        """
        Set a value in the context store with optional validation.
        
        Args:
            key: The context key to set
            value: The value to store
            
        Returns:
            True if value was set successfully, False if validation failed
        """
        # Run validation if rule exists for this key
        if key in self._validation_rules:
            rule = self._validation_rules[key]
            if not rule.validate(value):
                print(
                    f"[ContextManager] Validation failed for key '{key}': {rule.error_message}",
                    f"(attempted value: {value})"
                )
                return False
        
        self._store[key] = value
        return True
    
    def has(self, key: str) -> bool:
        """
        Check if a key exists in the context store.
        
        Args:
            key: The context key to check
            
        Returns:
            True if key exists and value is not None
        """
        return key in self._store and self._store[key] is not None
    
    def delete(self, key: str) -> bool:
        """
        Remove a key from the context store.
        
        Args:
            key: The context key to remove
            
        Returns:
            True if key was removed, False if it didn't exist
        """
        if self.has(key):
            del self._store[key]
            return True
        return False
    
    def clear(self) -> None:
        """Clear all context values."""
        self._store = {}
    
    def get_all(self) -> ContextStore:
        """
        Get all context values (as a copy).
        
        Returns:
            Dictionary containing all context values
        """
        return self._store.copy()
    
    def add_validation_rule(self, key: str, rule: ValidationRule) -> None:
        """
        Register a validation rule for a specific context key.
        
        Args:
            key: The context key to validate
            rule: The validation rule to apply
        """
        self._validation_rules[key] = rule
    
    def remove_validation_rule(self, key: str) -> None:
        """
        Remove a validation rule.
        
        Args:
            key: The context key to remove validation for
        """
        if key in self._validation_rules:
            del self._validation_rules[key]
    
    def set_many(self, values: Dict[str, ContextValue]) -> Dict[str, bool]:
        """
        Batch set multiple values at once.
        
        Args:
            values: Dictionary of key-value pairs to set
            
        Returns:
            Dictionary mapping keys to success status (True/False)
        """
        results = {}
        for key, value in values.items():
            results[key] = self.set(key, value)
        return results
    
    def __repr__(self) -> str:
        """String representation of the context manager."""
        return f"ContextManager(store={self._store})"
