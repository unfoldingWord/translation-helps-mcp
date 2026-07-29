"""
Translation Helps MCP Client v2 — Python SDK

Official Python client for the Translation Helps MCP server.
Connects via Streamable HTTP at /mcp.

Usage::

    from translation_helps import TranslationHelpsClient

    client = TranslationHelpsClient()
    result = client.get_passage({"reference": "JHN 3:16", "language": "en"})
"""

from .client import TranslationHelpsClient, AsyncTranslationHelpsClient
from .types import (
    ClientOptions,
    ListLanguagesOptions,
    ListResourcesOptions,
    GetPassageOptions,
    GetPassageContextOptions,
    GetPassageIndexOptions,
    GetNoteOptions,
    GetAcademyArticleOptions,
    GetWordArticleOptions,
    GetQuestionsOptions,
    SearchArticlesOptions,
    GetObsStoryOptions,
    GetObsNotesOptions,
    GetObsQuestionsOptions,
)

__version__ = "2.0.0"

__all__ = [
    "TranslationHelpsClient",
    "AsyncTranslationHelpsClient",
    "ClientOptions",
    "ListLanguagesOptions",
    "ListResourcesOptions",
    "GetPassageOptions",
    "GetPassageContextOptions",
    "GetPassageIndexOptions",
    "GetNoteOptions",
    "GetAcademyArticleOptions",
    "GetWordArticleOptions",
    "GetQuestionsOptions",
    "SearchArticlesOptions",
    "GetObsStoryOptions",
    "GetObsNotesOptions",
    "GetObsQuestionsOptions",
]
