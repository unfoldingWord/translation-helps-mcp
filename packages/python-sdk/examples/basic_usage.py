"""
Basic usage examples for Translation Helps MCP Client v2
"""

from translation_helps import TranslationHelpsClient

client = TranslationHelpsClient()

# 1. Discover available languages
languages = client.list_languages({"filter": "es"})
print("Languages:", languages)

# 1b. Check which resource types exist for a language
resources = client.list_resources({"language": "en"})
print("Resources:", resources)

# 2a. Orient — scripture text (all versions)
passage = client.get_passage({
    "reference": "JHN 3:16",
    "language": "en",
})
print("Passage:", passage)

# 2b. Orient — book/chapter background + resource availability
ctx = client.get_passage_context({
    "reference": "JHN 3:16",
    "language": "en",
})
print("Context:", ctx)

# 3. Survey — compact index of issues + key terms
index = client.get_passage_index({
    "reference": "JHN 3:16",
    "language": "en",
})
print("Index:", index)

# 4. Drill — note, TA article, TW article
note = client.get_note({
    "reference": "JHN 3:16",
    "language": "en",
})
print("Notes:", note)

word = client.get_word_article({
    "path": "bible/kt/grace",
    "language": "en",
})
print("Word:", word)

article = client.get_academy_article({
    "path": "translate/figs-metaphor",
    "language": "en",
})
print("Academy:", article)

# 5. Check — comprehension questions
questions = client.get_questions({
    "reference": "JHN 3:16",
    "language": "en",
})
print("Questions:", questions)

# 6. Lateral discovery — find articles by concept
results = client.search_articles({
    "query": "How should I translate figurative language?",
    "language": "en",
    "resourceTypes": ["ta"],
    "topK": 5,
})
print("Search results:", results)
