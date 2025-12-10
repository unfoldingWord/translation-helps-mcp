#!/usr/bin/env python3
"""
Comprehensive test script for the Python SDK
Tests all available tools to ensure they work correctly.
"""

import asyncio
import sys
import os
from pathlib import Path

# Fix Windows console encoding issues
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"

# Add the Python SDK to the path
sys.path.insert(0, str(Path(__file__).parent / "packages" / "python-sdk"))

from translation_helps import TranslationHelpsClient


async def test_all_tools():
    """Test all available tools in the Python SDK."""
    
    print("=" * 80)
    print("Python SDK Comprehensive Test Suite")
    print("=" * 80)
    print()
    
    # Initialize client
    print("1. Initializing client...")
    client = TranslationHelpsClient({
        "serverUrl": "https://tc-helps.mcp.servant.bible/api/mcp"
    })
    
    try:
        await client.connect()
        print("   [OK] Client connected successfully")
        print()
    except Exception as e:
        print(f"   [FAIL] Failed to connect: {e}")
        return False
    
    # Test results
    results = {
        "passed": [],
        "failed": []
    }
    
    # Test 1: List Tools
    print("2. Testing list_tools()...")
    try:
        tools = await client.list_tools()
        assert isinstance(tools, list), "Tools should be a list"
        assert len(tools) > 0, "Should have at least one tool"
        print(f"   [OK] Found {len(tools)} tools")
        results["passed"].append("list_tools")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("list_tools", str(e)))
    print()
    
    # Test 2: List Languages
    print("3. Testing list_languages()...")
    try:
        languages = await client.list_languages()
        assert isinstance(languages, dict), "Languages should be a dict"
        assert "languages" in languages or "data" in languages, "Should have languages data"
        print(f"   [OK] Retrieved languages data")
        results["passed"].append("list_languages")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("list_languages", str(e)))
    print()
    
    # Test 3: List Subjects
    print("4. Testing list_subjects()...")
    try:
        subjects = await client.list_subjects()
        assert isinstance(subjects, dict), "Subjects should be a dict"
        print(f"   [OK] Retrieved subjects data")
        results["passed"].append("list_subjects")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("list_subjects", str(e)))
    print()
    
    # Test 4: List Resources for Language (with default topic)
    print("5. Testing list_resources_for_language() (default topic='tc-ready')...")
    try:
        resources = await client.list_resources_for_language({
            "language": "en"
        })
        assert isinstance(resources, dict), "Resources should be a dict"
        print(f"   [OK] Retrieved resources for language 'en'")
        if "totalResources" in resources:
            print(f"      Total resources: {resources['totalResources']}")
        results["passed"].append("list_resources_for_language")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("list_resources_for_language", str(e)))
    print()
    
    # Test 5: Fetch Scripture
    print("6. Testing fetch_scripture()...")
    try:
        scripture = await client.fetch_scripture({
            "reference": "John 3:16",
            "language": "en"
        })
        assert isinstance(scripture, str), "Scripture should be a string"
        assert len(scripture) > 0, "Scripture should not be empty"
        print(f"   [OK] Retrieved scripture (length: {len(scripture)} chars)")
        results["passed"].append("fetch_scripture")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("fetch_scripture", str(e)))
    print()
    
    # Test 6: Fetch Translation Notes
    print("7. Testing fetch_translation_notes()...")
    try:
        notes = await client.fetch_translation_notes({
            "reference": "John 3:16",
            "language": "en"
        })
        assert isinstance(notes, dict), "Notes should be a dict"
        print(f"   [OK] Retrieved translation notes")
        results["passed"].append("fetch_translation_notes")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("fetch_translation_notes", str(e)))
    print()
    
    # Test 7: Fetch Translation Questions
    print("8. Testing fetch_translation_questions()...")
    try:
        questions = await client.fetch_translation_questions({
            "reference": "John 3:16",
            "language": "en"
        })
        assert isinstance(questions, dict), "Questions should be a dict"
        print(f"   [OK] Retrieved translation questions")
        results["passed"].append("fetch_translation_questions")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("fetch_translation_questions", str(e)))
    print()
    
    # Test 8: Fetch Translation Word (by term)
    print("9. Testing fetch_translation_word() (by term)...")
    try:
        word = await client.fetch_translation_word({
            "term": "grace",
            "language": "en"
        })
        assert isinstance(word, dict), "Translation word should be a dict"
        print(f"   [OK] Retrieved translation word for 'grace'")
        results["passed"].append("fetch_translation_word")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("fetch_translation_word", str(e)))
    print()
    
    # Test 9: Fetch Translation Word Links
    print("10. Testing fetch_translation_word_links()...")
    try:
        links = await client.fetch_translation_word_links({
            "reference": "John 3:16",
            "language": "en"
        })
        assert isinstance(links, dict), "Word links should be a dict"
        print(f"   [OK] Retrieved translation word links")
        results["passed"].append("fetch_translation_word_links")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("fetch_translation_word_links", str(e)))
    print()
    
    # Test 10: Fetch Translation Academy
    print("11. Testing fetch_translation_academy()...")
    try:
        academy = await client.fetch_translation_academy({
            "moduleId": "figs-metaphor",
            "language": "en"
        })
        assert isinstance(academy, dict), "Academy content should be a dict"
        print(f"   [OK] Retrieved translation academy content")
        results["passed"].append("fetch_translation_academy")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("fetch_translation_academy", str(e)))
    print()
    
    # Test 11: Get System Prompt
    print("12. Testing get_system_prompt()...")
    try:
        prompt = await client.get_system_prompt()
        assert isinstance(prompt, str), "System prompt should be a string"
        assert len(prompt) > 0, "System prompt should not be empty"
        print(f"   [OK] Retrieved system prompt (length: {len(prompt)} chars)")
        results["passed"].append("get_system_prompt")
    except Exception as e:
        print(f"   [FAIL] Failed: {e}")
        results["failed"].append(("get_system_prompt", str(e)))
    print()
    
    # Summary
    print("=" * 80)
    print("Test Summary")
    print("=" * 80)
    print(f"[OK] Passed: {len(results['passed'])}/{len(results['passed']) + len(results['failed'])}")
    print(f"[FAIL] Failed: {len(results['failed'])}/{len(results['passed']) + len(results['failed'])}")
    print()
    
    if results["passed"]:
        print("Passed tests:")
        for test in results["passed"]:
            print(f"  [OK] {test}")
        print()
    
    if results["failed"]:
        print("Failed tests:")
        for test, error in results["failed"]:
            print(f"  [FAIL] {test}: {error}")
        print()
        return False
    
    print("[SUCCESS] All tests passed!")
    return True


if __name__ == "__main__":
    success = asyncio.run(test_all_tools())
    sys.exit(0 if success else 1)

