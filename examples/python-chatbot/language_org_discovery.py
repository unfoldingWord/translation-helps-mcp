"""
Language-Organization Discovery for Python Chatbot
Discovers available language-organization combinations from Door43 catalog
"""

import httpx
from typing import List, Dict, Optional

def map_language_to_catalog_code(language: str) -> str:
    """Map a language code to its catalog equivalent (e.g., es -> es-419)"""
    language_map = {
        'es': 'es-419',  # Spanish -> Latin American Spanish
        'es-MX': 'es-419',
        'es-AR': 'es-419',
        'es-CO': 'es-419',
        'es-CL': 'es-419',
        'es-PE': 'es-419',
    }
    return language_map.get(language, language)

async def discover_language_orgs() -> List[Dict[str, any]]:
    """
    Discover all available language-organization combinations from Door43 catalog
    
    Returns:
        List of dictionaries with 'language', 'displayName', and 'organizations' keys
    """
    catalog_url = "https://git.door43.org/api/v1/catalog/search?stage=prod&metadataType=rc&limit=1000"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(catalog_url)
        response.raise_for_status()
        catalog_data = response.json()
    
    if not catalog_data.get("data"):
        return []
    
    # Map to track language -> organizations
    language_map = {}
    
    for resource in catalog_data["data"]:
        # Get language code - try multiple fields
        lang_code = (
            resource.get("language") or
            resource.get("lang") or
            (lambda: None if not resource.get("name") else 
             __import__("re").match(r"^([a-z]{2,3}(?:-[A-Z][a-z]{3})?)", resource["name"], __import__("re").IGNORECASE) and
             __import__("re").match(r"^([a-z]{2,3}(?:-[A-Z][a-z]{3})?)", resource["name"], __import__("re").IGNORECASE).group(1).lower()
            )()
        )
        
        if not lang_code:
            continue
        
        # Map to catalog code (e.g., es -> es-419)
        catalog_lang_code = map_language_to_catalog_code(lang_code)
        
        # Get organization/owner
        org = resource.get("owner")
        if not org:
            continue
        
        # Initialize language entry if not exists (use catalog code)
        if catalog_lang_code not in language_map:
            # Try to extract display name from resource title
            display_name = None
            if resource.get("title"):
                import re
                title_match = re.match(r"^([^®(]+)", resource["title"])
                if title_match:
                    display_name = title_match.group(1).strip()
                    # Remove resource type suffixes
                    display_name = re.sub(r"\s+(ULT|UST|GLT|GST|TN|TW|TQ|TA|TWL)$", "", display_name, flags=re.IGNORECASE)
            
            language_map[lang_code] = {
                "organizations": set(),
                "displayName": display_name
            }
        
        # Add organization to language's set (use catalog code)
        language_map[catalog_lang_code]["organizations"].add(org)
    
    # Convert to result format
    options = []
    for language, data in sorted(language_map.items()):
        options.append({
            "language": language,
            "displayName": data["displayName"],
            "organizations": sorted(list(data["organizations"]))
        })
    
    return options

def get_organizations_for_language(discovery_result: List[Dict], language: str) -> List[str]:
    """Get organizations for a specific language"""
    for option in discovery_result:
        if option["language"] == language:
            return option["organizations"]
    return []

def get_language_display_name(discovery_result: List[Dict], language: str) -> str:
    """Get display name for a language"""
    for option in discovery_result:
        if option["language"] == language:
            return option.get("displayName") or language.upper()
    return language.upper()

