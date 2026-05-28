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


# ---------------------------------------------------------------------------
# RAG tools (rag_query, get_bundle, index_resource)
# ---------------------------------------------------------------------------

class RagQueryFilters(TypedDict, total=False):
    """Metadata filters for rag_query."""
    resourceType: Optional[Any]  # str or List[str]
    subject: Optional[List[str]]
    project: Optional[str]
    owner: Optional[str]


class RagQueryOptions(TypedDict, total=False):
    """Options for the rag_query MCP tool.

    Example::

        results = await client.rag_query(RagQueryOptions(
            query="What does grace mean?",
            language="en",
            reference="JHN 3:16",
            k=10,
        ))
    """
    query: str              # Required
    language: Optional[str]
    reference: Optional[str]
    filters: Optional[RagQueryFilters]
    k: Optional[int]        # 1–100, default 10
    enableExact: Optional[bool]
    requestId: Optional[str]


class GetBundleOptions(TypedDict, total=False):
    """Options for the get_bundle MCP tool.

    Example::

        bundle = await client.get_bundle(GetBundleOptions(
            language="en",
            reference="JHN 3:16",
        ))
    """
    language: str            # Required
    reference: str           # Required
    owner: Optional[str]
    project: Optional[str]
    force: Optional[bool]
    requestId: Optional[str]


class IndexResourceOptions(TypedDict, total=False):
    """Options for the index_resource admin MCP tool.

    Requires ``admin_token`` matching the server's ``ADMIN_TOKEN`` env var.

    Example::

        job = await client.index_resource(IndexResourceOptions(
            resource_id="unfoldingWord/en_tn",
            admin_token="secret",
        ))
    """
    resourceId: str          # Required, format "owner/project"
    zipUrl: Optional[str]
    force: Optional[bool]
    priority: Optional[str]  # "low" | "normal" | "high"
    requestId: Optional[str]
    adminToken: Optional[str]

