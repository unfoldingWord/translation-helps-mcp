"""
Basic usage examples for Translation Helps MCP Client v2
"""

from translation_helps import TranslationHelpsClient

client = TranslationHelpsClient()

# 1. Get all translation helps for a passage in one call
bundle = client.get_bundle({"reference": "JHN 3:16", "language": "en"})
print("Bundle:", bundle)

# 2. Fetch scripture text
scripture = client.fetch_scripture({
    "reference": "JHN 3:16",
    "language": "en",
    "resourceType": "ult",   # Literal translation
    "format": "text",
})
print("Scripture:", scripture)

# 3. Fetch translation notes
notes = client.fetch_translation_notes({
    "reference": "JHN 3:16",
    "language": "en",
})
print("Notes:", notes)

# 4. Look up a translation word by path (preferred — use path from word links)
word = client.fetch_translation_word({
    "path": "bible/kt/grace",   # path from fetch_translation_word_links
    "language": "en",
})
print("Word:", word)

# Or by term (fallback)
word_by_term = client.fetch_translation_word({
    "term": "grace",
    "language": "en",
})
print("Word by term:", word_by_term)

# 5. Semantic search
results = client.rag_query({
    "query": "How should I translate figurative language?",
    "language": "en",
    "resourceTypes": ["ta", "tn"],
    "topK": 5,
})
print("RAG results:", results)

# 6. List available languages
languages = client.list_languages()
print("Languages:", languages)

# 7. Get word links for a reference, then fetch each article
links = client.fetch_translation_word_links({
    "reference": "JHN 3:16",
    "language": "en",
})
print("Word links:", links)

# 8. Translation Academy article
article = client.fetch_translation_academy({
    "path": "translate/figs-metaphor",
    "language": "en",
})
print("Academy:", article)
