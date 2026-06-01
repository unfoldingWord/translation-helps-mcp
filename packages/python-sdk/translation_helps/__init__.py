"""
Translation Helps MCP Client v2 — Python SDK

Official Python client for the Translation Helps MCP server.
Connects via Streamable HTTP at /mcp.

Usage::

    from translation_helps import TranslationHelpsClient

    client = TranslationHelpsClient()
    result = client.get_bundle({"reference": "JHN 3:16", "language": "en"})
"""

from .client import TranslationHelpsClient
from .types import (
    ClientOptions,
    FetchScriptureOptions,
    FetchTranslationNotesOptions,
    FetchTranslationQuestionsOptions,
    FetchTranslationWordOptions,
    FetchTranslationWordLinksOptions,
    FetchTranslationAcademyOptions,
    ListLanguagesOptions,
    ListSubjectsOptions,
    ListResourcesForLanguageOptions,
    RagQueryOptions,
    GetBundleOptions,
    IndexResourceOptions,
)

__version__ = "2.0.0"

__all__ = [
    "TranslationHelpsClient",
    "ClientOptions",
    "FetchScriptureOptions",
    "FetchTranslationNotesOptions",
    "FetchTranslationQuestionsOptions",
    "FetchTranslationWordOptions",
    "FetchTranslationWordLinksOptions",
    "FetchTranslationAcademyOptions",
    "ListLanguagesOptions",
    "ListSubjectsOptions",
    "ListResourcesForLanguageOptions",
    "RagQueryOptions",
    "GetBundleOptions",
    "IndexResourceOptions",
]
