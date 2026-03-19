"""
Built-in validation rules for common context parameters

These validators prevent the LLM from hallucinating invalid parameter values.
"""

import re
from typing import Any, Callable, List

from .context_manager import Validator


def language_code_validator() -> Validator:
    """
    Validates that a language code is a valid ISO 639 format.
    Accepts formats: "en", "en-US", "es-419", "zh-CN"
    
    Returns:
        Validator instance for language codes
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        # ISO 639-1 (2-letter) or ISO 639-1 with region/script
        # Examples: "en", "en-US", "es-419", "zh-Hans", "zh-Hans-CN"
        pattern = r'^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2}|-[0-9]{3})?$'
        
        return bool(re.match(pattern, value)) and len(value) <= 15
    
    return Validator(
        validate,
        "Language code must be a valid ISO 639 format (e.g., 'en', 'en-US', 'es-419')"
    )


def organization_validator() -> Validator:
    """
    Validates organization name (alphanumeric with hyphens/underscores).
    Examples: "unfoldingWord", "door43", "my-org", "org_name"
    
    Returns:
        Validator instance for organization names
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        # Allow alphanumeric, hyphens, underscores, 1-50 characters
        pattern = r'^[a-zA-Z0-9_-]{1,50}$'
        
        return bool(re.match(pattern, value))
    
    return Validator(
        validate,
        "Organization must be alphanumeric with hyphens/underscores (1-50 chars)"
    )


def resource_type_validator() -> Validator:
    """
    Validates resource type (alphanumeric with underscores).
    Examples: "ult", "ust", "tn", "tw", "tq", "ta"
    
    Returns:
        Validator instance for resource types
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        # Allow lowercase alphanumeric with underscores, 1-20 characters
        pattern = r'^[a-z0-9_]{1,20}$'
        
        return bool(re.match(pattern, value))
    
    return Validator(
        validate,
        "Resource type must be lowercase alphanumeric with underscores (1-20 chars)"
    )


def reference_validator() -> Validator:
    """
    Validates Bible reference format.
    Examples: "John 3:16", "Genesis 1:1", "Romans 1:1-7", "1 John 2:3"
    
    Returns:
        Validator instance for Bible references
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        # Basic pattern: Book Chapter:Verse or Book Chapter:Verse-Verse
        # Allows: "John 3:16", "1 John 2:3", "Romans 1:1-7"
        pattern = r'^[1-3]?\s?[A-Za-z]+\s+\d+:\d+(-\d+)?$'
        
        return bool(re.match(pattern, value)) and len(value) <= 50
    
    return Validator(
        validate,
        "Reference must be valid Bible format (e.g., 'John 3:16', 'Romans 1:1-7')"
    )


def book_code_validator() -> Validator:
    """
    Validates book code (3-letter uppercase).
    Examples: "GEN", "JHN", "ROM", "1CO", "3JN"
    
    Returns:
        Validator instance for book codes
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        # 3-letter uppercase, may start with a digit
        pattern = r'^[1-3]?[A-Z]{2,3}$'
        
        return bool(re.match(pattern, value)) and len(value) <= 3
    
    return Validator(
        validate,
        "Book code must be 3-letter uppercase (e.g., 'GEN', 'JHN', '3JN')"
    )


def chapter_validator() -> Validator:
    """
    Validates chapter number (1-150).
    
    Returns:
        Validator instance for chapter numbers
    """
    def validate(value: Any) -> bool:
        try:
            num = int(value) if isinstance(value, str) else value
            return isinstance(num, int) and 1 <= num <= 150
        except (ValueError, TypeError):
            return False
    
    return Validator(
        validate,
        "Chapter must be a number between 1 and 150"
    )


def verse_validator() -> Validator:
    """
    Validates verse number (1-176, for Psalm 119).
    
    Returns:
        Validator instance for verse numbers
    """
    def validate(value: Any) -> bool:
        try:
            num = int(value) if isinstance(value, str) else value
            return isinstance(num, int) and 1 <= num <= 176
        except (ValueError, TypeError):
            return False
    
    return Validator(
        validate,
        "Verse must be a number between 1 and 176"
    )


def format_validator() -> Validator:
    """
    Validates format parameter (json, text, usfm, markdown).
    
    Returns:
        Validator instance for format parameters
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        valid_formats = ['json', 'text', 'usfm', 'markdown', 'plain']
        return value.lower() in valid_formats
    
    return Validator(
        validate,
        "Format must be one of: json, text, usfm, markdown, plain"
    )


def boolean_validator() -> Validator:
    """
    Validates boolean parameters.
    
    Returns:
        Validator instance for boolean values
    """
    def validate(value: Any) -> bool:
        return isinstance(value, bool) or value in ('true', 'false', 'True', 'False')
    
    return Validator(
        validate,
        "Must be a boolean value (True/False)"
    )


def stage_validator() -> Validator:
    """
    Validates stage parameter (prod, preprod, latest).
    
    Returns:
        Validator instance for stage parameters
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        valid_stages = ['prod', 'preprod', 'latest']
        return value.lower() in valid_stages
    
    return Validator(
        validate,
        "Stage must be one of: prod, preprod, latest"
    )


def create_string_length_validator(min_length: int = 1, max_length: int = 100) -> Validator:
    """
    Create a validator for string length constraints.
    
    Args:
        min_length: Minimum string length
        max_length: Maximum string length
        
    Returns:
        Validator instance for string length
    """
    def validate(value: Any) -> bool:
        return isinstance(value, str) and min_length <= len(value) <= max_length
    
    return Validator(
        validate,
        f"String must be between {min_length} and {max_length} characters"
    )


def create_number_range_validator(min_value: float, max_value: float) -> Validator:
    """
    Create a validator for number range constraints.
    
    Args:
        min_value: Minimum value
        max_value: Maximum value
        
    Returns:
        Validator instance for number range
    """
    def validate(value: Any) -> bool:
        try:
            num = float(value) if isinstance(value, str) else value
            return isinstance(num, (int, float)) and min_value <= num <= max_value
        except (ValueError, TypeError):
            return False
    
    return Validator(
        validate,
        f"Number must be between {min_value} and {max_value}"
    )


def create_enum_validator(
    allowed_values: List[str],
    case_sensitive: bool = False
) -> Validator:
    """
    Create a validator for enum/choice constraints.
    
    Args:
        allowed_values: List of allowed values
        case_sensitive: Whether to perform case-sensitive comparison
        
    Returns:
        Validator instance for enum values
    """
    def validate(value: Any) -> bool:
        if not isinstance(value, str):
            return False
        
        if case_sensitive:
            return value in allowed_values
        else:
            return value.lower() in [v.lower() for v in allowed_values]
    
    return Validator(
        validate,
        f"Must be one of: {', '.join(allowed_values)}"
    )


def create_composite_validator(*validators: Validator) -> Validator:
    """
    Create a composite validator that requires all validators to pass.
    
    Args:
        *validators: Variable number of validators to combine
        
    Returns:
        Composite validator instance
    """
    def validate(value: Any) -> bool:
        return all(v.validate(value) for v in validators)
    
    error_messages = '; '.join(v.error_message for v in validators)
    
    return Validator(validate, error_messages)


# Pre-instantiated validators for convenience
LANGUAGE_CODE_VALIDATOR = language_code_validator()
ORGANIZATION_VALIDATOR = organization_validator()
RESOURCE_TYPE_VALIDATOR = resource_type_validator()
REFERENCE_VALIDATOR = reference_validator()
BOOK_CODE_VALIDATOR = book_code_validator()
CHAPTER_VALIDATOR = chapter_validator()
VERSE_VALIDATOR = verse_validator()
FORMAT_VALIDATOR = format_validator()
BOOLEAN_VALIDATOR = boolean_validator()
STAGE_VALIDATOR = stage_validator()
