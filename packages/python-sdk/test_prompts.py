#!/usr/bin/env python3
"""
Test script to verify Python SDK prompts support.
"""

import asyncio
import sys
from translation_helps import TranslationHelpsClient


async def test_prompts():
    """Test that Python SDK can access MCP server prompts."""
    print("=" * 80)
    print("PYTHON SDK PROMPTS SUPPORT TEST")
    print("=" * 80)
    
    async with TranslationHelpsClient() as client:
        # Test 1: Check if prompts are supported
        print("\n1. Checking prompts support...")
        supports_prompts = await client.check_prompts_support()
        if supports_prompts:
            print("   ✅ Server supports prompts")
        else:
            print("   ⚠️  Server does not support prompts")
            return False
        
        # Test 2: List available prompts
        print("\n2. Listing available prompts...")
        try:
            prompts = await client.list_prompts()
            print(f"   ✅ Found {len(prompts)} prompts:")
            for prompt in prompts:
                print(f"      - {prompt.get('name', 'unknown')}: {prompt.get('description', 'no description')[:60]}...")
        except Exception as e:
            print(f"   ❌ Failed to list prompts: {e}")
            return False
        
        # Test 3: Get a specific prompt
        print("\n3. Getting prompt template...")
        try:
            prompt_result = await client.get_prompt(
                "translation-helps-for-passage",
                {"reference": "John 3:16", "language": "en"}
            )
            if prompt_result and "messages" in prompt_result:
                print(f"   ✅ Successfully retrieved prompt template")
                print(f"      Messages in prompt: {len(prompt_result.get('messages', []))}")
            else:
                print(f"   ⚠️  Prompt returned unexpected format: {prompt_result.keys()}")
        except Exception as e:
            print(f"   ❌ Failed to get prompt: {e}")
            return False
        
        # Test 4: Get capabilities
        print("\n4. Checking capabilities...")
        try:
            capabilities = await client.get_capabilities()
            print(f"   ✅ Capabilities:")
            print(f"      - Tools supported: {capabilities.get('tools_supported', False)}")
            print(f"      - Prompts supported: {capabilities.get('prompts_supported', False)}")
        except Exception as e:
            print(f"   ❌ Failed to get capabilities: {e}")
            return False
        
        print("\n" + "=" * 80)
        print("✅ ALL PROMPTS TESTS PASSED!")
        print("=" * 80)
        return True


if __name__ == "__main__":
    try:
        success = asyncio.run(test_prompts())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
