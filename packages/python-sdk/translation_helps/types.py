"""
Type definitions for Translation Helps MCP Client v2
"""

from typing import TypedDict, Optional, Dict, Any, List


class ClientOptions(TypedDict, total=False):
    """Options for configuring the TranslationHelpsClient."""
    serverUrl: Optional[str]       # Default: https://translation-helps-mcp.workers.dev/mcp
    timeout: Optional[float]       # Seconds (default 90)
    headers: Optional[Dict[str, str]]


class FetchScriptureOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16", "GEN 1:1-3"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"
    resourceType: Optional[str]    # "ult" | "ust" | "glt" | "gst" (default "ult")
    format: Optional[str]          # "text" | "usfm" (default "text")


class FetchTranslationNotesOptions(TypedDict, total=False):
    reference: str                 # Required
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationQuestionsOptions(TypedDict, total=False):
    reference: str                 # Required
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationWordLinksOptions(TypedDict, total=False):
    reference: str                 # Required
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationWordOptions(TypedDict, total=False):
    """Provide `path` (preferred) OR `term`. Use path from fetch_translation_word_links."""
    path: Optional[str]            # e.g. "bible/kt/grace" — preferred
    term: Optional[str]            # e.g. "grace" — fallback
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationAcademyOptions(TypedDict, total=False):
    path: str                      # Required — e.g. "translate/figs-metaphor"
    language: Optional[str]
    organization: Optional[str]


class ListLanguagesOptions(TypedDict, total=False):
    organization: Optional[str]
    stage: Optional[str]           # "prod" | "preprod" | "latest"


class ListSubjectsOptions(TypedDict, total=False):
    organization: Optional[str]
    stage: Optional[str]


class ListResourcesForLanguageOptions(TypedDict, total=False):
    language: str                  # Required
    organization: Optional[str]
    stage: Optional[str]
    subject: Optional[str]


class RagQueryOptions(TypedDict, total=False):
    query: str                     # Required — natural language question
    language: Optional[str]
    reference: Optional[str]       # Restrict to a specific passage
    resourceTypes: Optional[List[str]]   # ["tn","tw","ta","tq"]
    topK: Optional[int]            # 1–20 (default 5)
    enableRerank: Optional[bool]   # Default True


class GetBundleOptions(TypedDict, total=False):
    reference: str                 # Required
    language: Optional[str]
    organization: Optional[str]
    includeScripture: Optional[bool]
    includeNotes: Optional[bool]
    includeWords: Optional[bool]
    includeQuestions: Optional[bool]


class IndexResourceOptions(TypedDict, total=False):
    """Admin tool — requires adminToken matching ADMIN_TOKEN env var."""
    language: str                  # Required
    subject: str                   # Required — e.g. "Translation Notes"
    organization: Optional[str]
    stage: Optional[str]
    force: Optional[bool]
    adminToken: Optional[str]


# Legacy types kept for compatibility
class MCPTool(TypedDict, total=False):
    name: str
    description: Optional[str]
    inputSchema: Dict[str, Any]


class MCPPrompt(TypedDict, total=False):
    name: str
    description: Optional[str]
    arguments: Optional[List[Dict[str, Any]]]
