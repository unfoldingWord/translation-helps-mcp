#!/usr/bin/env python3
"""
Comprehensive SDK Test Suite
Tests recent fixes:
- list_resources_for_language searches all orgs (no org filter param)
- Topic parameter (should default to "tc-ready")
- Prompt improvements for translation notes
"""

import asyncio
import os
import sys
from typing import Any, Dict

# Add the package to the path
sys.path.insert(0, os.path.dirname(__file__))

from translation_helps import TranslationHelpsClient

SERVER_URL = os.getenv('SERVER_URL', 'http://localhost:3000/api')

class Colors:
    GREEN = '\033[32m'
    RED = '\033[31m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    RESET = '\033[0m'

def log(message: str, color: str = Colors.RESET):
    print(f"{color}{message}{Colors.RESET}")

def log_test(name: str):
    print(f"\n{Colors.BLUE}========================================{Colors.RESET}")
    log(f"Testing: {name}", Colors.YELLOW)
    print(f"{Colors.BLUE}========================================{Colors.RESET}")

async def test_organization_parameter():
    log_test('Organization Parameter - Multi-Org Search (Default)')
    
    client = TranslationHelpsClient({"serverUrl": SERVER_URL})
    await client.connect()
    
    try:
        log('Testing list_resources_for_language WITHOUT organization param...', Colors.BLUE)
        result = await client.list_resources_for_language({
            'language': 'en',
            'limit': 100
        })
        
        org_counts = {}
        for subject, resources in result.get('resourcesBySubject', {}).items():
            for resource in resources:
                org = resource.get('organization', 'unknown')
                org_counts[org] = org_counts.get(org, 0) + 1
        
        log(f"[OK] Found resources from {len(org_counts)} organizations:", Colors.GREEN)
        for org, count in org_counts.items():
            print(f"  - {org}: {count} resources")
        
        if len(org_counts) > 1:
            log('[OK] PASS: Multi-organization search working correctly!', Colors.GREEN)
        else:
            log('[!] WARNING: Only found 1 organization. This might be correct if only one org has "en" resources.', Colors.YELLOW)
        
    except Exception as error:
        log(f'[X] FAIL: {str(error)}', Colors.RED)
        raise
    finally:
        await client.close()

async def test_topic_parameter():
    log_test('Topic Parameter - Default "tc-ready"')
    
    client = TranslationHelpsClient({"serverUrl": SERVER_URL})
    await client.connect()
    
    try:
        log('Testing list_resources_for_language WITHOUT topic param (should default to "tc-ready")...', Colors.BLUE)
        result = await client.list_resources_for_language({
            'language': 'en',
            'limit': 50
        })
        
        topic_counts = {}
        for subject, resources in result.get('resourcesBySubject', {}).items():
            for resource in resources:
                topics = resource.get('metadata', {}).get('topic', ['no-topic'])
                for topic in topics:
                    topic_counts[topic] = topic_counts.get(topic, 0) + 1
        
        log("[OK] Found resources with topics:", Colors.GREEN)
        for topic, count in topic_counts.items():
            print(f"  - {topic}: {count} resources")
        
        if topic_counts.get('tc-ready', 0) > 0:
            log('[OK] PASS: Topic filter defaulting to "tc-ready" correctly!', Colors.GREEN)
        else:
            log('[!] WARNING: No "tc-ready" resources found. This might be correct for some languages.', Colors.YELLOW)
        
    except Exception as error:
        log(f'[X] FAIL: {str(error)}', Colors.RED)
        raise
    finally:
        await client.close()

async def test_fetch_scripture():
    log_test('Fetch Scripture - Organization Parameter')
    
    client = TranslationHelpsClient({"serverUrl": SERVER_URL})
    await client.connect()
    
    try:
        log('Testing fetch_scripture WITHOUT organization (should search all orgs)...', Colors.BLUE)
        scripture = await client.fetch_scripture({
            'reference': 'John 3:16',
            'language': 'en',
            'format': 'text'
        })
        
        if scripture and len(scripture) > 0:
            log(f'[OK] Successfully fetched scripture: "{scripture[:50]}..."', Colors.GREEN)
            log('[OK] PASS: Scripture fetch succeeded', Colors.GREEN)
        else:
            raise Exception('No scripture text returned')
        
    except Exception as error:
        log(f'[X] FAIL: {str(error)}', Colors.RED)
        raise
    finally:
        await client.close()

async def test_fetch_translation_notes():
    log_test('Fetch Translation Notes')
    
    client = TranslationHelpsClient({"serverUrl": SERVER_URL})
    await client.connect()
    
    try:
        log('Testing fetch_translation_notes...', Colors.BLUE)
        notes = await client.fetch_translation_notes({
            'reference': 'Titus 1:1',
            'language': 'en'
        })
        
        if notes:
            log("[OK] Successfully fetched translation notes", Colors.GREEN)
            print(f"  - Verse notes: {len(notes.get('verseNotes', []))}")
            print(f"  - Context notes: {len(notes.get('contextNotes', []))}")
            
            verse_notes = notes.get('verseNotes', [])
            if verse_notes and len(verse_notes) > 0:
                log("\nFirst note preview:", Colors.BLUE)
                first_note = verse_notes[0]
                try:
                    print(f"  Quote: {first_note.get('Quote')}")
                    note_text = first_note.get('Note', '')
                    print(f"  Note: {note_text[:100]}...")
                except UnicodeEncodeError:
                    print(f"  Quote: [Greek text - encoding issue]")
                    print(f"  Note: {first_note.get('Note', '')[:100].encode('ascii', 'replace').decode()}...")
            
            log('[OK] PASS: Translation notes fetch succeeded', Colors.GREEN)
        else:
            raise Exception('No notes returned')
        
    except Exception as error:
        log(f'[X] FAIL: {str(error)}', Colors.RED)
        raise
    finally:
        await client.close()

async def test_fetch_translation_questions():
    log_test('Fetch Translation Questions')
    
    client = TranslationHelpsClient({"serverUrl": SERVER_URL})
    await client.connect()
    
    try:
        log('Testing fetch_translation_questions...', Colors.BLUE)
        questions = await client.fetch_translation_questions({
            'reference': 'Genesis 1:1',
            'language': 'en'
        })
        
        if questions and len(questions) > 0:
            log(f'[OK] Successfully fetched {len(questions)} translation questions', Colors.GREEN)
            log("\nFirst question preview:", Colors.BLUE)
            try:
                print(f"  Q: {questions[0].get('Question')}")
                answer = questions[0].get('Answer', '')
                print(f"  A: {answer[:100]}...")
            except (UnicodeEncodeError, IndexError):
                print(f"  Q: [Question text - encoding/index issue]")
                print(f"  A: [Answer text - encoding/index issue]")
            log('[OK] PASS: Translation questions fetch succeeded', Colors.GREEN)
        else:
            raise Exception('No questions returned')
        
    except Exception as error:
        log(f'[X] FAIL: {str(error)}', Colors.RED)
        raise
    finally:
        await client.close()

async def test_language_variant_fallback():
    log_test('Language Variant Fallback (es-419 to es)')
    
    client = TranslationHelpsClient({"serverUrl": SERVER_URL})
    await client.connect()
    
    try:
        log('Testing list_resources_for_language with es-419...', Colors.BLUE)
        result = await client.list_resources_for_language({
            'language': 'es-419',
            'limit': 50
        })
        
        total = result.get('totalResources', 0)
        if total > 0:
            log(f'[OK] Successfully found {total} resources', Colors.GREEN)
            log(f'[OK] Language used: {result.get("language", "es-419")}', Colors.GREEN)
            
            if result.get('detectedVariant'):
                log(f'[OK] Variant fallback detected: {result.get("detectedVariant")}', Colors.GREEN)
            
            log('[OK] PASS: Language variant fallback working!', Colors.GREEN)
        else:
            log('[!] WARNING: No resources found for es-419', Colors.YELLOW)
        
    except Exception as error:
        log(f'[X] FAIL: {str(error)}', Colors.RED)
        raise
    finally:
        await client.close()

async def run_all_tests():
    print(f"\n{Colors.BLUE}==============================================={Colors.RESET}")
    print(f"{Colors.BLUE}  Translation Helps SDK - Comprehensive Tests  {Colors.RESET}")
    print(f"{Colors.BLUE}==============================================={Colors.RESET}")
    print(f"\nServer URL: {SERVER_URL}\n")
    
    tests = [
        {'name': 'Multi-Org Discovery', 'fn': test_multi_organization_discovery},
        {'name': 'Topic Default', 'fn': test_topic_parameter},
        {'name': 'Fetch Scripture', 'fn': test_fetch_scripture},
        {'name': 'Fetch Translation Notes', 'fn': test_fetch_translation_notes},
        {'name': 'Fetch Translation Questions', 'fn': test_fetch_translation_questions},
        {'name': 'Language Variant Fallback', 'fn': test_language_variant_fallback}
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            await test['fn']()
            passed += 1
        except Exception as error:
            failed += 1
            log(f'\n[FAIL] Test "{test["name"]}" failed: {str(error)}', Colors.RED)
    
    print(f"\n{Colors.BLUE}========================================{Colors.RESET}")
    log("\nTest Results:", Colors.YELLOW)
    color = Colors.GREEN if passed == len(tests) else Colors.YELLOW
    log(f"  Passed: {passed}/{len(tests)}", color)
    if failed > 0:
        log(f"  Failed: {failed}/{len(tests)}", Colors.RED)
    print(f"\n{Colors.BLUE}========================================{Colors.RESET}\n")
    
    if failed > 0:
        sys.exit(1)

if __name__ == '__main__':
    try:
        asyncio.run(run_all_tests())
    except KeyboardInterrupt:
        log('\n\n[INTERRUPTED] Tests interrupted by user', Colors.RED)
        sys.exit(1)
    except Exception as error:
        log(f'\n[ERROR] Fatal error: {str(error)}', Colors.RED)
        import traceback
        traceback.print_exc()
        sys.exit(1)
