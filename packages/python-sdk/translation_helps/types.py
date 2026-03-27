"""
Type definitions for Translation Helps MCP Client
"""

from typing import TypedDict, Optional, Dict, Any, List


class MCPTool(TypedDict, total=False):
    name: str
    description: Optional[str]
    inputSchema: Dict[str, Any]


class MCPPrompt(TypedDict, total=False):
    name: str
    description: Optional[str]
    arguments: Optional[List[Dict[str, Any]]]


class ClientOptions(TypedDict, total=False):
    """Options for configuring the client"""
    serverUrl: Optional[str]  # Server URL for remote HTTP servers
    timeout: Optional[int]  # Timeout for HTTP requests in milliseconds
    headers: Optional[Dict[str, str]]  # Custom headers to include in requests


class FetchScriptureOptions(TypedDict, total=False):
    reference: str
    language: Optional[str]
    format: Optional[str]  # 'text' or 'usfm'
    includeVerseNumbers: Optional[bool]
    resource: Optional[str]  # 'ult', 'ust', 't4t', 'ueb', 'all', or comma-separated (e.g., 'ult,ust')
    includeAlignment: Optional[bool]  # Include word alignment data (only available with USFM format)


class FetchTranslationNotesOptions(TypedDict, total=False):
    reference: str
    language: Optional[str]
    includeIntro: Optional[bool]
    includeContext: Optional[bool]


class FetchTranslationQuestionsOptions(TypedDict, total=False):
    reference: str
    language: Optional[str]


class FetchTranslationWordOptions(TypedDict, total=False):
    reference: Optional[str]
    term: Optional[str]
    language: Optional[str]
    category: Optional[str]  # 'kt', 'names', or 'other'


class FetchTranslationWordLinksOptions(TypedDict, total=False):
    reference: str
    language: Optional[str]


class FetchTranslationAcademyOptions(TypedDict, total=False):
    reference: Optional[str]
    rcLink: Optional[str]
    moduleId: Optional[str]
    path: Optional[str]
    language: Optional[str]
    format: Optional[str]  # 'json' or 'markdown'


class ListLanguagesOptions(TypedDict, total=False):
    stage: Optional[str]


class ListSubjectsOptions(TypedDict, total=False):
    language: Optional[str]
    stage: Optional[str]


class ListResourcesForLanguageOptions(TypedDict, total=False):
    language: str  # Required
    stage: Optional[str]
    subject: Optional[str]
    limit: Optional[int]
    topic: Optional[str]  # Defaults to "tc-ready" if not provided

