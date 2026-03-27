"""
Comprehensive test suite for State Injection Interceptor

Run with: pytest tests/test_interceptor.py -v
"""

import pytest
from translation_helps.context_manager import ContextManager
from translation_helps.state_injection_interceptor import (
    StateInjectionInterceptor,
    InterceptorOptions
)
from translation_helps.validators import (
    LANGUAGE_CODE_VALIDATOR,
    ORGANIZATION_VALIDATOR,
    REFERENCE_VALIDATOR,
    BOOLEAN_VALIDATOR,
    create_string_length_validator,
    create_number_range_validator,
    create_enum_validator
)


class TestContextManager:
    """Test suite for ContextManager."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.context_manager = ContextManager()
    
    def test_set_and_get_values(self):
        """Test setting and getting values."""
        self.context_manager.set('language', 'en')
        assert self.context_manager.get('language') == 'en'
    
    def test_has_key(self):
        """Test checking if key exists."""
        self.context_manager.set('language', 'en')
        assert self.context_manager.has('language') is True
        assert self.context_manager.has('nonexistent') is False
    
    def test_delete_value(self):
        """Test deleting values."""
        self.context_manager.set('language', 'en')
        assert self.context_manager.delete('language') is True
        assert self.context_manager.has('language') is False
    
    def test_clear_all_values(self):
        """Test clearing all values."""
        self.context_manager.set('language', 'en')
        self.context_manager.set('stage', 'prod')
        self.context_manager.clear()
        assert self.context_manager.has('language') is False
        assert self.context_manager.has('stage') is False
    
    def test_get_all_values(self):
        """Test getting all values."""
        self.context_manager.set('language', 'en')
        self.context_manager.set('stage', 'prod')
        all_values = self.context_manager.get_all()
        assert all_values == {
            'language': 'en',
            'stage': 'prod'
        }
    
    def test_set_many_values(self):
        """Test batch setting multiple values."""
        results = self.context_manager.set_many({
            'language': 'en',
            'stage': 'prod'
        })
        assert results['language'] is True
        assert results['stage'] is True
        assert self.context_manager.get('language') == 'en'
        assert self.context_manager.get('stage') == 'prod'
    
    def test_validation_accepts_valid_values(self):
        """Test that validation accepts valid language codes."""
        self.context_manager.add_validation_rule('language', LANGUAGE_CODE_VALIDATOR)
        assert self.context_manager.set('language', 'en') is True
        assert self.context_manager.set('language', 'en-US') is True
        assert self.context_manager.set('language', 'es-419') is True
    
    def test_validation_rejects_invalid_values(self):
        """Test that validation rejects invalid language codes."""
        self.context_manager.add_validation_rule('language', LANGUAGE_CODE_VALIDATOR)
        assert self.context_manager.set('language', 'invalid!!!') is False
        assert self.context_manager.set('language', '123') is False
        assert self.context_manager.get('language') is None
    
    def test_no_validation_for_keys_without_rules(self):
        """Test that values are accepted for keys without validation rules."""
        assert self.context_manager.set('customKey', 'anyValue') is True
        assert self.context_manager.get('customKey') == 'anyValue'
    
    def test_remove_validation_rule(self):
        """Test removing validation rules."""
        self.context_manager.add_validation_rule('language', LANGUAGE_CODE_VALIDATOR)
        self.context_manager.remove_validation_rule('language')
        assert self.context_manager.set('language', 'invalid') is True


class TestStateInjectionInterceptor:
    """Test suite for StateInjectionInterceptor."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.context_manager = ContextManager()
        self.interceptor = StateInjectionInterceptor(
            self.context_manager,
            {
                'fetch_scripture': ['language', 'stage'],
                'fetch_translation_notes': ['language', 'stage'],
                'list_languages': []
            },
            InterceptorOptions(debug=False)
        )
    
    def test_inject_missing_parameters(self):
        """Test injecting missing parameters from context."""
        self.context_manager.set('language', 'en')
        self.context_manager.set('stage', 'prod')
        
        result = self.interceptor.intercept('fetch_scripture', {
            'reference': 'John 3:16'
        })
        
        assert result.modified is True
        assert result.arguments == {
            'reference': 'John 3:16',
            'language': 'en',
            'stage': 'prod'
        }
        assert result.injected == {
            'language': 'en',
            'stage': 'prod'
        }
    
    def test_no_injection_when_parameters_provided(self):
        """Test that no injection occurs when parameters are already provided."""
        self.context_manager.set('language', 'en')
        
        result = self.interceptor.intercept('fetch_scripture', {
            'reference': 'John 3:16',
            'language': 'es-419'  # Explicitly provided
        })
        
        assert result.arguments['language'] == 'es-419'  # Should keep explicit value
        assert result.injected == {}  # Nothing injected
    
    def test_handle_tools_with_no_requirements(self):
        """Test handling tools with no context requirements."""
        self.context_manager.set('language', 'en')
        
        result = self.interceptor.intercept('list_languages', {})
        
        assert result.modified is False
        assert result.injected == {}
    
    def test_handle_unknown_tools(self):
        """Test handling unknown tools gracefully."""
        self.context_manager.set('language', 'en')
        
        result = self.interceptor.intercept('unknown_tool', {
            'someArg': 'value'
        })
        
        assert result.modified is False
        assert result.arguments == {'someArg': 'value'}
    
    def test_sync_explicit_parameters_to_context(self):
        """Test syncing explicitly-provided parameters to context."""
        result = self.interceptor.intercept('fetch_translation_notes', {
            'reference': 'John 3:16',
            'language': 'es-419',
            'stage': 'prod'
        })
        
        assert result.modified is True
        assert result.synced == {
            'language': 'es-419',
            'stage': 'prod'
        }
        assert self.context_manager.get('language') == 'es-419'
        assert self.context_manager.get('stage') == 'prod'
    
    def test_sync_and_inject_in_same_call(self):
        """Test syncing and injecting in the same call."""
        self.context_manager.set('stage', 'prod')
        
        result = self.interceptor.intercept('fetch_scripture', {
            'reference': 'John 3:16',
            'language': 'en'  # New language to sync
            # stage missing - will be injected
        })
        
        assert result.synced == {'language': 'en'}
        assert result.injected == {'stage': 'prod'}
        assert result.arguments == {
            'reference': 'John 3:16',
            'language': 'en',
            'stage': 'prod'
        }
    
    def test_validation_failure_during_sync(self):
        """Test handling validation failure during sync."""
        self.context_manager.add_validation_rule('language', LANGUAGE_CODE_VALIDATOR)
        
        result = self.interceptor.intercept('fetch_scripture', {
            'reference': 'John 3:16',
            'language': 'invalid!!!'  # Invalid language code
        })
        
        # Sync should fail, parameter stays in arguments but not in context
        assert result.synced == {}
        assert self.context_manager.get('language') is None
    
    def test_add_tool_requirements_dynamically(self):
        """Test adding tool requirements dynamically."""
        self.interceptor.add_tool_requirements('custom_tool', ['language', 'customParam'])
        self.context_manager.set('language', 'en')
        self.context_manager.set('customParam', 'value')
        
        result = self.interceptor.intercept('custom_tool', {'arg': 'test'})
        
        assert result.injected == {
            'language': 'en',
            'customParam': 'value'
        }
    
    def test_update_tool_configuration(self):
        """Test updating tool configuration."""
        self.interceptor.update_tool_config({
            'new_tool': ['language']
        })
        
        config = self.interceptor.get_tool_config()
        assert config['new_tool'] == ['language']
    
    def test_remove_tool_requirements(self):
        """Test removing tool requirements."""
        self.interceptor.remove_tool_requirements('fetch_scripture')
        
        result = self.interceptor.intercept('fetch_scripture', {
            'reference': 'John 3:16'
        })
        
        assert result.modified is False
    
    def test_callback_on_context_injected(self):
        """Test callback when context is injected."""
        callback_invoked = False
        callback_data = {}
        
        def on_injected(tool_name, injected_params):
            nonlocal callback_invoked, callback_data
            callback_invoked = True
            callback_data = {'tool_name': tool_name, 'injected': injected_params}
        
        custom_interceptor = StateInjectionInterceptor(
            self.context_manager,
            {'fetch_scripture': ['language']},
            InterceptorOptions(on_context_injected=on_injected)
        )
        
        self.context_manager.set('language', 'en')
        custom_interceptor.intercept('fetch_scripture', {'reference': 'John 3:16'})
        
        assert callback_invoked is True
        assert callback_data['tool_name'] == 'fetch_scripture'
        assert callback_data['injected'] == {'language': 'en'}
    
    def test_callback_on_context_synced(self):
        """Test callback when context is synced."""
        callback_invoked = False
        callback_data = {}
        
        def on_synced(tool_name, synced_params):
            nonlocal callback_invoked, callback_data
            callback_invoked = True
            callback_data = {'tool_name': tool_name, 'synced': synced_params}
        
        custom_interceptor = StateInjectionInterceptor(
            self.context_manager,
            {'fetch_scripture': ['language']},
            InterceptorOptions(on_context_synced=on_synced)
        )
        
        custom_interceptor.intercept('fetch_scripture', {
            'reference': 'John 3:16',
            'language': 'es-419'
        })
        
        assert callback_invoked is True
        assert callback_data['tool_name'] == 'fetch_scripture'
        assert callback_data['synced'] == {'language': 'es-419'}
    
    def test_handle_none_argument_values(self):
        """Test handling None argument values."""
        self.context_manager.set('language', 'en')
        
        result = self.interceptor.intercept('fetch_scripture', {
            'reference': 'John 3:16',
            'language': None  # Explicitly None
        })
        
        # None should not trigger injection
        assert 'language' in result.arguments
    
    def test_handle_empty_arguments_object(self):
        """Test handling empty arguments object."""
        self.context_manager.set('language', 'en')
        self.context_manager.set('stage', 'prod')
        
        result = self.interceptor.intercept('fetch_scripture', {})
        
        assert result.injected == {'language': 'en', 'stage': 'prod'}
    
    def test_does_not_modify_original_arguments(self):
        """Test that original arguments object is not modified."""
        self.context_manager.set('language', 'en')
        self.context_manager.set('stage', 'prod')
        
        original_args = {'reference': 'John 3:16'}
        result = self.interceptor.intercept('fetch_scripture', original_args)
        
        assert original_args == {'reference': 'John 3:16'}  # Unchanged
        assert result.arguments != original_args  # New object
        assert id(result.arguments) != id(original_args)


class TestValidators:
    """Test suite for Validators."""
    
    def test_language_code_validator_accepts_valid_codes(self):
        """Test language code validator accepts valid codes."""
        assert LANGUAGE_CODE_VALIDATOR.validate('en') is True
        assert LANGUAGE_CODE_VALIDATOR.validate('en-US') is True
        assert LANGUAGE_CODE_VALIDATOR.validate('es-419') is True
        assert LANGUAGE_CODE_VALIDATOR.validate('zh-Hans') is True
    
    def test_language_code_validator_rejects_invalid_codes(self):
        """Test language code validator rejects invalid codes."""
        assert LANGUAGE_CODE_VALIDATOR.validate('invalid') is False
        assert LANGUAGE_CODE_VALIDATOR.validate('123') is False
        assert LANGUAGE_CODE_VALIDATOR.validate('') is False
    
    def test_organization_validator_accepts_valid_names(self):
        """Test organization validator accepts valid names."""
        assert ORGANIZATION_VALIDATOR.validate('unfoldingWord') is True
        assert ORGANIZATION_VALIDATOR.validate('door43') is True
        assert ORGANIZATION_VALIDATOR.validate('my-org') is True
    
    def test_organization_validator_rejects_invalid_names(self):
        """Test organization validator rejects invalid names."""
        assert ORGANIZATION_VALIDATOR.validate('invalid space') is False
        assert ORGANIZATION_VALIDATOR.validate('invalid@char') is False
        assert ORGANIZATION_VALIDATOR.validate('') is False
    
    def test_reference_validator_accepts_valid_references(self):
        """Test reference validator accepts valid references."""
        assert REFERENCE_VALIDATOR.validate('John 3:16') is True
        assert REFERENCE_VALIDATOR.validate('Romans 1:1') is True
        assert REFERENCE_VALIDATOR.validate('Romans 1:1-7') is True
        assert REFERENCE_VALIDATOR.validate('1 John 2:3') is True
    
    def test_reference_validator_rejects_invalid_references(self):
        """Test reference validator rejects invalid references."""
        assert REFERENCE_VALIDATOR.validate('Invalid') is False
        assert REFERENCE_VALIDATOR.validate('John 3') is False
        assert REFERENCE_VALIDATOR.validate('3:16') is False
    
    def test_boolean_validator_accepts_boolean_values(self):
        """Test boolean validator accepts boolean values."""
        assert BOOLEAN_VALIDATOR.validate(True) is True
        assert BOOLEAN_VALIDATOR.validate(False) is True
        assert BOOLEAN_VALIDATOR.validate('true') is True
        assert BOOLEAN_VALIDATOR.validate('false') is True
    
    def test_boolean_validator_rejects_non_boolean_values(self):
        """Test boolean validator rejects non-boolean values."""
        assert BOOLEAN_VALIDATOR.validate('yes') is False
        assert BOOLEAN_VALIDATOR.validate(1) is False
        assert BOOLEAN_VALIDATOR.validate(None) is False
    
    def test_string_length_validator_factory(self):
        """Test string length validator factory."""
        validator = create_string_length_validator(3, 10)
        assert validator.validate('hello') is True
        assert validator.validate('ab') is False
        assert validator.validate('verylongstring') is False
    
    def test_number_range_validator_factory(self):
        """Test number range validator factory."""
        validator = create_number_range_validator(1, 10)
        assert validator.validate(5) is True
        assert validator.validate(0) is False
        assert validator.validate(11) is False
    
    def test_enum_validator_factory(self):
        """Test enum validator factory."""
        validator = create_enum_validator(['red', 'green', 'blue'])
        assert validator.validate('red') is True
        assert validator.validate('RED') is True  # Case insensitive
        assert validator.validate('yellow') is False
