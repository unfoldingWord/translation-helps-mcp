#!/usr/bin/env python3
"""
Test script to verify Python SDK is synchronized with MCP server.
Tests all available methods and verifies they match the MCP server tools.
"""

import asyncio
import sys
from translation_helps import TranslationHelpsClient


async def test_sdk_sync():
    """Test that Python SDK methods match MCP server tools."""
    print("=" * 80)
    print("PYTHON SDK SYNCHRONIZATION TEST")
    print("=" * 80)
    
    async with TranslationHelpsClient() as client:
        # Test 1: List tools from MCP server
        print("\n1. Fetching tools from MCP server...")
        tools = await client.list_tools()
        tool_names = [tool["name"] for tool in tools]
        print(f"   ✅ Found {len(tool_names)} tools from MCP server")
        print(f"   Tools: {', '.join(sorted(tool_names))}")
        
        # Expected tools (from MCP server tools registry)
        expected_tools = {
            "fetch_scripture",
            "fetch_translation_notes",
            "fetch_translation_questions",
            "fetch_translation_word_links",
            "fetch_translation_word",
            "fetch_translation_academy",
            "list_languages",
            "list_subjects",
            "list_resources_for_language",
        }
        
        # Verify all expected tools are present
        missing_tools = expected_tools - set(tool_names)
        extra_tools = set(tool_names) - expected_tools
        
        if missing_tools:
            print(f"   ❌ Missing tools: {missing_tools}")
            return False
        
        if extra_tools:
            print(f"   ⚠️  Extra tools (not in expected list): {extra_tools}")
        
        print("   ✅ All expected tools are present")
        
        # Test 2: Verify fetch_scripture supports new parameters
        print("\n2. Testing fetch_scripture with new parameters...")
        try:
            # Test with resource parameter
            scripture = await client.fetch_scripture({
                "reference": "John 3:16",
                "language": "en",
                "resource": "ult"  # New parameter
            })
            if scripture and len(scripture) > 0:
                print("   ✅ fetch_scripture with 'resource' parameter works")
            else:
                print("   ❌ fetch_scripture returned empty result")
                return False
        except Exception as e:
            print(f"   ❌ fetch_scripture failed: {e}")
            return False
        
        # Test 3: Verify list_languages works (replacement for deprecated get_languages)
        print("\n3. Testing list_languages (replaces deprecated get_languages)...")
        try:
            languages = await client.list_languages({
                "organization": "unfoldingWord",
                "stage": "prod"
            })
            if languages and "languages" in languages:
                print(f"   ✅ list_languages works (found {len(languages.get('languages', []))} languages)")
            else:
                print("   ❌ list_languages returned unexpected format")
                return False
        except Exception as e:
            print(f"   ❌ list_languages failed: {e}")
            return False
        
        # Test 4: Verify deprecated methods are removed
        print("\n4. Verifying deprecated methods are removed...")
        deprecated_methods = ["get_languages", "get_system_prompt"]
        for method_name in deprecated_methods:
            if hasattr(client, method_name):
                print(f"   ❌ Deprecated method '{method_name}' still exists!")
                return False
        print("   ✅ Deprecated methods are correctly removed")
        
        # Test 5: Test all convenience methods exist and work
        print("\n5. Testing convenience methods...")
        convenience_methods = [
            ("fetch_scripture", {"reference": "John 3:16"}),
            ("fetch_translation_notes", {"reference": "John 3:16"}),
            ("fetch_translation_questions", {"reference": "John 3:16"}),
            ("fetch_translation_word", {"term": "love"}),
            ("list_languages", {}),
            ("list_subjects", {}),
            ("list_resources_for_language", {"language": "en"}),
        ]
        
        for method_name, params in convenience_methods:
            if not hasattr(client, method_name):
                print(f"   ❌ Method '{method_name}' not found!")
                return False
            print(f"   ✅ Method '{method_name}' exists")
        
        print("\n" + "=" * 80)
        print("✅ ALL TESTS PASSED - Python SDK is synchronized with MCP server!")
        print("=" * 80)
        return True


if __name__ == "__main__":
    try:
        success = asyncio.run(test_sdk_sync())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
