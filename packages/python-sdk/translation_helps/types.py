"""
Type definitions for Translation Helps MCP Client v2

The server exposes a progressive-disclosure workflow:
  1. list_languages      — orient: discover valid language codes
  2. get_passage         — orient/draft: scripture text (all versions), cheap + repeatable
  3. get_passage_context — orient: book/chapter intro notes + resource availability
  4. get_passage_index   — survey: compact index of issues + key terms (no bodies)
  5. get_note            — drill: full note body by id
  6. get_academy_article — drill: full TA article by path
  7. get_word_article    — drill: full TW article by path
  8. get_questions       — check: comprehension questions for a passage
  8. search_articles     — lateral: concept → article path
"""

from typing import TypedDict, Optional, Dict, Any, List


class ClientOptions(TypedDict, total=False):
    """Options for configuring the TranslationHelpsClient."""
    serverUrl: Optional[str]       # Default: https://translation-helps-mcp.workers.dev/mcp
    timeout: Optional[float]       # Seconds (default 90)
    headers: Optional[Dict[str, str]]


# ---------------------------------------------------------------------------
# Workflow tool option types (new progressive-disclosure surface)
# ---------------------------------------------------------------------------

class ListLanguagesOptions(TypedDict, total=False):
    filter: Optional[str]          # Substring filter on language code or name


class GetPassageOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16", "GEN 1:1-3"
    language: Optional[str]        # BCP-47 code (default "en")


class GetPassageContextOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16", "GEN 1"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"


class GetPassageIndexOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16", "MAT 5"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"


class GetNoteOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"
    id: Optional[str]              # Specific note ID from get_passage_index


class GetAcademyArticleOptions(TypedDict, total=False):
    path: str                      # Required — e.g. "translate/figs-metaphor"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"


class GetWordArticleOptions(TypedDict, total=False):
    path: str                      # Required — e.g. "bible/kt/grace"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"


class GetQuestionsOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"


class SearchArticlesOptions(TypedDict, total=False):
    query: str                     # Required — concept or phrase to search
    language: Optional[str]
    resourceTypes: Optional[List[str]]   # ["ta"] | ["tw"] | ["ta","tw"] (default both)
    topK: Optional[int]            # 1–20 (default 5)


# ---------------------------------------------------------------------------
# Legacy option types — kept for backward compatibility
# ---------------------------------------------------------------------------

class FetchScriptureOptions(TypedDict, total=False):
    """Deprecated: use GetPassageOptions instead."""
    reference: str                 # Required — e.g. "JHN 3:16", "GEN 1:1-3"
    language: Optional[str]        # BCP-47 code (default "en")
    organization: Optional[str]    # Default "unfoldingWord"
    format: Optional[str]          # "text" | "usfm" (default "text")


class FetchTranslationNotesOptions(TypedDict, total=False):
    """Deprecated: use GetNoteOptions instead."""
    reference: str                 # Required
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationQuestionsOptions(TypedDict, total=False):
    """Deprecated: use GetQuestionsOptions instead."""
    reference: str                 # Required
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationWordLinksOptions(TypedDict, total=False):
    """Deprecated: use GetPassageIndexOptions instead."""
    reference: str                 # Required
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationWordOptions(TypedDict, total=False):
    """Deprecated: use GetWordArticleOptions instead. Provide `path` OR `term`."""
    path: Optional[str]            # e.g. "bible/kt/grace" — preferred
    term: Optional[str]            # e.g. "grace" — fallback
    language: Optional[str]
    organization: Optional[str]


class FetchTranslationAcademyOptions(TypedDict, total=False):
    """Deprecated: use GetAcademyArticleOptions instead."""
    path: str                      # Required — e.g. "translate/figs-metaphor"
    language: Optional[str]
    organization: Optional[str]


class ListSubjectsOptions(TypedDict, total=False):
    organization: Optional[str]
    stage: Optional[str]


class ListResourcesForLanguageOptions(TypedDict, total=False):
    language: str                  # Required
    organization: Optional[str]
    stage: Optional[str]
    subject: Optional[str]


class GetBundleOptions(TypedDict, total=False):
    """Deprecated: use get_passage_context + get_passage_index instead."""
    reference: str                 # Required
    language: Optional[str]
    includeScripture: Optional[bool]
    includeNotes: Optional[bool]
    includeWords: Optional[bool]


class ListTranslationAcademyOptions(TypedDict, total=False):
    language: Optional[str]        # BCP-47 code (default "en")
    category: Optional[str]        # e.g. "translate" | "checking" — returns all if omitted


class ListTranslationWordsOptions(TypedDict, total=False):
    language: Optional[str]        # BCP-47 code (default "en")
    category: Optional[str]        # "kt" | "other" | "names" — returns all if omitted


# Legacy types kept for compatibility
class MCPTool(TypedDict, total=False):
    name: str
    description: Optional[str]
    inputSchema: Dict[str, Any]


class MCPPrompt(TypedDict, total=False):
    name: str
    description: Optional[str]
    arguments: Optional[List[Dict[str, Any]]]
