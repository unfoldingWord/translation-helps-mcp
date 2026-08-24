"""
Type definitions for Translation Helps MCP Client v2

The server exposes a progressive-disclosure workflow:
  1. list_languages      — orient: discover valid language codes
  2. list_resources      — orient: resource availability for a language
  3. get_passage         — orient/draft: scripture text (all versions), cheap + repeatable
  4. get_passage_context — orient: book/chapter intro notes + resource availability
  5. get_passage_index   — survey: compact index of issues + key terms (no bodies)
  6. get_note            — drill: full note body by id
  7. get_academy_article — drill: full TA article by path
  8. get_word_article    — drill: full TW article by path
  9. get_questions       — check: comprehension questions for a passage
  10. search_articles    — lateral: concept → article path
"""

from typing import TypedDict, Optional, Dict, Any, List


class ClientOptions(TypedDict, total=False):
    """Options for configuring the TranslationHelpsClient."""
    serverUrl: Optional[str]       # Default: https://translation-helps-mcp.workers.dev/mcp
    timeout: Optional[float]       # Seconds (default 90)
    headers: Optional[Dict[str, str]]


# ---------------------------------------------------------------------------
# Workflow tool option types
# ---------------------------------------------------------------------------

class ListLanguagesOptions(TypedDict, total=False):
    filter: Optional[str]          # Substring filter on language code or name


class ListResourcesOptions(TypedDict, total=False):
    language: str                  # Required — BCP-47 language code
    book: Optional[str]            # Optional USFM book code/name (e.g. "TIT")
    reference: Optional[str]       # Optional passage; book is extracted like book


class GetPassageOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16", "GEN 1:1-3"
    language: Optional[str]        # BCP-47 code (default "en")


class GetPassageContextOptions(TypedDict, total=False):
    reference: str                 # Required — e.g. "JHN 3:16", "GEN 1", or bare book "TIT" (book overview only)
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
# OBS option types
# ---------------------------------------------------------------------------

class GetObsStoryOptions(TypedDict, total=False):
    """Options for get_obs_story — fetch Open Bible Stories text."""
    reference: str             # Required — OBS story:frame, e.g. "1:1", "1:0", "front"
    language: Optional[str]    # BCP-47 code (default "en")


class GetObsNotesOptions(TypedDict, total=False):
    """Options for get_obs_notes — fetch OBS Translation Notes."""
    reference: str             # Required — OBS story:frame, e.g. "1:1"
    language: Optional[str]    # BCP-47 code (default "en")


class GetObsQuestionsOptions(TypedDict, total=False):
    """Options for get_obs_questions — fetch OBS Translation Questions."""
    reference: str             # Required — OBS story:frame, e.g. "1:1"
    language: Optional[str]    # BCP-47 code (default "en")


# Shared MCP shapes
class MCPTool(TypedDict, total=False):
    name: str
    description: Optional[str]
    inputSchema: Dict[str, Any]


class MCPPrompt(TypedDict, total=False):
    name: str
    description: Optional[str]
    arguments: Optional[List[Dict[str, Any]]]
