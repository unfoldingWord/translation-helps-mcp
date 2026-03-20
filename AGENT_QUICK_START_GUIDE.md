# Agent Quick Start Guide - Translation Helps API

A practical guide for AI agents consuming the Translation Helps MCP API after metadata standardization.

---

## TL;DR for Agents

**Universal Pattern:**
```typescript
const response = await fetch('/api/{endpoint}?{params}');
const data = await response.json();

// Every response has:
data.metadata.resourceType  // "tw", "ta", "tn", "tq", "twl", "scripture"
data.metadata.subject       // "Translation Words", "Translation Academy", etc.
data.metadata.language      // "en", "es", etc.
data.metadata.organization  // "unfoldingWord", "all", "multiple"
data.metadata.license       // "CC BY-SA 4.0"
```

---

## Quick Reference: All Endpoints

### 1. Translation Word (TW)

**Fetch a word definition:**
```bash
GET /api/fetch-translation-word?path=bible/kt/love
```

**Response:**
```json
{
  "title": "love",
  "path": "bible/kt/love",
  "definition": "...",
  "content": "...",
  "metadata": {
    "resourceType": "tw",
    "subject": "Translation Words",
    "language": "en",
    "organization": "unfoldingWord",
    "license": "CC BY-SA 4.0"
  }
}
```

### 2. Translation Academy (TA)

**Fetch a teaching article:**
```bash
GET /api/fetch-translation-academy?path=translate/figs-metaphor
```

**Response:**
```json
{
  "title": "Metaphor",
  "path": "translate/figs-metaphor",
  "content": "...",
  "metadata": {
    "resourceType": "ta",
    "subject": "Translation Academy",
    "language": "en",
    "organization": "unfoldingWord",
    "license": "CC BY-SA 4.0"
  }
}
```

### 3. Translation Notes (TN)

**Fetch translation notes for a verse:**
```bash
GET /api/fetch-translation-notes?reference=gen+1:1
```

**Response:**
```json
{
  "reference": "gen 1:1",
  "items": [
    {
      "Reference": "1:1",
      "ID": "abc123",
      "Note": "...",
      "externalReference": {
        "target": "ta",
        "path": "translate/figs-metaphor"
      }
    }
  ],
  "counts": { "totalCount": 6 },
  "metadata": {
    "resourceType": "tn",
    "subject": "TSV Translation Notes",
    "language": "en",
    "organization": "all",
    "license": "CC BY-SA 4.0"
  }
}
```

### 4. Translation Questions (TQ)

**Fetch comprehension questions:**
```bash
GET /api/fetch-translation-questions?reference=gen+1:1
```

**Response:**
```json
{
  "reference": "gen 1:1",
  "items": [
    {
      "ID": "q1",
      "Reference": "1:1",
      "Question": "What did God create?",
      "Response": "God created the heavens and the earth.",
      "Tags": "creation, beginning"
    }
  ],
  "counts": { "totalCount": 3 },
  "metadata": {
    "resourceType": "tq",
    "subject": "TSV Translation Questions",
    "language": "en",
    "organization": "all",
    "license": "CC BY-SA 4.0"
  }
}
```

### 5. Translation Word Links (TWL)

**Fetch word links for a verse:**
```bash
GET /api/fetch-translation-word-links?reference=gen+1:1
```

**Response:**
```json
{
  "reference": "gen 1:1",
  "items": [
    {
      "id": "twl1",
      "reference": "1:1",
      "occurrence": 1,
      "quote": "...",
      "strongsId": "H430",
      "externalReference": {
        "target": "tw",
        "path": "bible/kt/god",
        "category": "kt"
      }
    }
  ],
  "counts": { "linksFound": 8 },
  "metadata": {
    "resourceType": "twl",
    "subject": "TSV Translation Words Links",
    "language": "en",
    "organization": "unfoldingWord",
    "license": "CC BY-SA 4.0"
  }
}
```

### 6. Scripture

**Fetch Bible text:**
```bash
GET /api/fetch-scripture?reference=gen+1:1
```

**Response:**
```json
{
  "scripture": [
    {
      "text": "In the beginning...",
      "translation": "ULT v88",
      "citation": {...}
    }
  ],
  "reference": "gen 1:1",
  "counts": { "totalCount": 4 },
  "metadata": {
    "resourceType": "scripture",
    "subject": "Bible",
    "language": "en",
    "organization": "multiple",
    "license": "CC BY-SA 4.0",
    "resources": ["ULT v88", "UST v88", "T4T v1", "BSB v1"]
  }
}
```

---

## Common Agent Tasks

### Task 1: Following External References

**Scenario:** User reads a Translation Note that references a TA article.

```typescript
async function followNoteReferences(reference: string) {
  // 1. Get translation notes
  const tnResp = await fetch(`/api/fetch-translation-notes?reference=${reference}`);
  const tn = await tnResp.json();
  
  // 2. Find items with TA references
  const taItems = tn.items.filter(
    item => item.externalReference?.target === 'ta'
  );
  
  // 3. Fetch all referenced TA articles
  const taArticles = await Promise.all(
    taItems.map(item => 
      fetch(`/api/fetch-translation-academy?path=${item.externalReference.path}`)
        .then(r => r.json())
    )
  );
  
  return { notes: tn, academy: taArticles };
}
```

### Task 2: Building a Word Study

**Scenario:** User wants to study all words in a verse.

```typescript
async function buildWordStudy(reference: string) {
  // 1. Get word links for the verse
  const twlResp = await fetch(`/api/fetch-translation-word-links?reference=${reference}`);
  const twl = await twlResp.json();
  
  // 2. Extract unique TW paths
  const twPaths = [...new Set(
    twl.items
      .filter(item => item.externalReference?.target === 'tw')
      .map(item => item.externalReference.path)
  )];
  
  // 3. Fetch all word definitions
  const words = await Promise.all(
    twPaths.map(path =>
      fetch(`/api/fetch-translation-word?path=${path}`)
        .then(r => r.json())
    )
  );
  
  return { links: twl, words };
}
```

### Task 3: Complete Verse Context

**Scenario:** User wants all resources for a verse.

```typescript
async function getCompleteVerseContext(reference: string) {
  // Fetch all resources in parallel
  const [scripture, notes, questions, wordLinks] = await Promise.all([
    fetch(`/api/fetch-scripture?reference=${reference}`).then(r => r.json()),
    fetch(`/api/fetch-translation-notes?reference=${reference}`).then(r => r.json()),
    fetch(`/api/fetch-translation-questions?reference=${reference}`).then(r => r.json()),
    fetch(`/api/fetch-translation-word-links?reference=${reference}`).then(r => r.json())
  ]);
  
  // Follow external references from notes
  const taRefs = notes.items
    .filter(item => item.externalReference?.target === 'ta')
    .map(item => item.externalReference.path);
  
  const academy = await Promise.all(
    taRefs.map(path =>
      fetch(`/api/fetch-translation-academy?path=${path}`).then(r => r.json())
    )
  );
  
  // Follow external references from word links
  const twRefs = [...new Set(
    wordLinks.items
      .filter(item => item.externalReference?.target === 'tw')
      .map(item => item.externalReference.path)
  )];
  
  const words = await Promise.all(
    twRefs.map(path =>
      fetch(`/api/fetch-translation-word?path=${path}`).then(r => r.json())
    )
  );
  
  return {
    scripture,
    notes,
    questions,
    wordLinks,
    academy,
    words,
    metadata: {
      // All responses have consistent metadata structure
      resources: [
        scripture.metadata,
        notes.metadata,
        questions.metadata,
        wordLinks.metadata
      ]
    }
  };
}
```

---

## Error Handling

### 404 with TOC (TW & TA Only)

When path is empty or invalid, get Table of Contents:

```typescript
try {
  const resp = await fetch('/api/fetch-translation-word?path=');
  if (resp.status === 404) {
    const error = await resp.json();
    const toc = error.details.toc;
    
    // toc contains all available paths
    console.log('Available word paths:', toc);
    
    // Let user choose from TOC
  }
} catch (err) {
  console.error('Error:', err);
}
```

### 400 for Deprecated Parameters

```typescript
// This will return 400 Bad Request
const resp = await fetch('/api/fetch-translation-word?term=love');
// Error: "The 'term' parameter is no longer supported. Use 'path' instead."

// Correct usage:
const resp = await fetch('/api/fetch-translation-word?path=bible/kt/love');
```

---

## Metadata Usage Patterns

### Pattern 1: Display Resource Attribution

```typescript
function displayResourceInfo(data: any) {
  const { resourceType, subject, language, organization, license } = data.metadata;
  
  return `
    Resource: ${subject}
    Type: ${resourceType}
    Language: ${language}
    Organization: ${organization}
    License: ${license}
  `;
}
```

### Pattern 2: Filter by Resource Type

```typescript
async function fetchAllResources(reference: string) {
  const responses = await Promise.all([
    fetch(`/api/fetch-scripture?reference=${reference}`),
    fetch(`/api/fetch-translation-notes?reference=${reference}`),
    fetch(`/api/fetch-translation-questions?reference=${reference}`)
  ]);
  
  const data = await Promise.all(responses.map(r => r.json()));
  
  // Group by resource type
  return data.reduce((acc, resource) => {
    const type = resource.metadata.resourceType;
    acc[type] = resource;
    return acc;
  }, {});
}
```

### Pattern 3: Validate Resources

```typescript
function validateResource(data: any): boolean {
  const required = ['resourceType', 'subject', 'language', 'organization', 'license'];
  
  return required.every(field => 
    data.metadata && data.metadata[field] !== undefined
  );
}
```

---

## Cheat Sheet

### Get Resource Info
```typescript
data.metadata.resourceType   // What kind of resource
data.metadata.subject        // Human-readable name
data.metadata.language       // Language code
data.metadata.organization   // Source org(s)
data.metadata.license        // License type
```

### Follow External References
```typescript
// From TN or TWL items:
if (item.externalReference) {
  const { target, path } = item.externalReference;
  
  const url = target === 'tw' 
    ? `/api/fetch-translation-word?path=${path}`
    : `/api/fetch-translation-academy?path=${path}`;
  
  const ref = await fetch(url).then(r => r.json());
}
```

### Get Counts
```typescript
// Operational counts are now in dedicated object
data.counts.totalCount
data.counts.verseNotesCount
data.counts.linksFound
// etc.
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Looking for language at root level

```typescript
// ❌ OLD:
const language = data.language;

// ✅ NEW:
const language = data.metadata.language;
```

### Pitfall 2: Trying to parse RC links

```typescript
// ❌ OLD:
const path = item.rcLink.match(/rc:\/\/\*\/tw\/dict\/(.+)/)[1];

// ✅ NEW:
const path = item.externalReference.path;
```

### Pitfall 3: Using deprecated parameters

```typescript
// ❌ OLD:
fetch('/api/fetch-translation-word?term=love')

// ✅ NEW:
fetch('/api/fetch-translation-word?path=bible/kt/love')
```

### Pitfall 4: Mixing counts and metadata

```typescript
// ❌ OLD:
const count = data.metadata.totalCount;

// ✅ NEW:
const count = data.counts.totalCount;
```

---

## Advanced Patterns

### Pattern 1: Build Complete Study Material

```typescript
async function buildCompleteStudy(reference: string) {
  // Parallel fetch all base resources
  const [scripture, tn, tq, twl] = await Promise.all([
    fetch(`/api/fetch-scripture?reference=${reference}`).then(r => r.json()),
    fetch(`/api/fetch-translation-notes?reference=${reference}`).then(r => r.json()),
    fetch(`/api/fetch-translation-questions?reference=${reference}`).then(r => r.json()),
    fetch(`/api/fetch-translation-word-links?reference=${reference}`).then(r => r.json())
  ]);
  
  // Extract all external references
  const taRefs = tn.items
    .filter(i => i.externalReference?.target === 'ta')
    .map(i => i.externalReference.path);
  
  const twRefs = [...new Set(
    twl.items
      .filter(i => i.externalReference?.target === 'tw')
      .map(i => i.externalReference.path)
  )];
  
  // Fetch all referenced resources in parallel
  const [academy, words] = await Promise.all([
    Promise.all(taRefs.map(p => 
      fetch(`/api/fetch-translation-academy?path=${p}`).then(r => r.json())
    )),
    Promise.all(twRefs.map(p => 
      fetch(`/api/fetch-translation-word?path=${p}`).then(r => r.json())
    ))
  ]);
  
  return {
    scripture,
    notes: tn,
    questions: tq,
    wordLinks: twl,
    academy,
    words,
    // All metadata accessible consistently
    allMetadata: [scripture, tn, tq, twl, ...academy, ...words]
      .map(r => r.metadata)
  };
}
```

### Pattern 2: Resource Type Router

```typescript
function getEndpointForResourceType(resourceType: string): string {
  const endpoints = {
    tw: '/api/fetch-translation-word',
    ta: '/api/fetch-translation-academy',
    tn: '/api/fetch-translation-notes',
    tq: '/api/fetch-translation-questions',
    twl: '/api/fetch-translation-word-links',
    scripture: '/api/fetch-scripture'
  };
  
  return endpoints[resourceType];
}

async function fetchByResourceType(type: string, params: any) {
  const endpoint = getEndpointForResourceType(type);
  const query = new URLSearchParams(params).toString();
  return fetch(`${endpoint}?${query}`).then(r => r.json());
}
```

### Pattern 3: Smart Reference Following

```typescript
async function followAllReferences(item: any, maxDepth: number = 2): Promise<any[]> {
  const results: any[] = [item];
  
  if (maxDepth <= 0 || !item.externalReference) {
    return results;
  }
  
  const { target, path } = item.externalReference;
  const endpoint = target === 'tw' 
    ? '/api/fetch-translation-word'
    : '/api/fetch-translation-academy';
  
  const ref = await fetch(`${endpoint}?path=${path}`).then(r => r.json());
  results.push(ref);
  
  // Recursively follow if the referenced item has more references
  if (ref.items) {
    for (const subItem of ref.items) {
      if (subItem.externalReference) {
        const nested = await followAllReferences(subItem, maxDepth - 1);
        results.push(...nested);
      }
    }
  }
  
  return results;
}
```

---

## Best Practices for Agents

### DO ✅

1. **Always check metadata** - Use `resourceType` to know what you're working with
2. **Use externalReference** - Pre-parsed, ready to use
3. **Separate concerns** - Use `counts` for stats, `metadata` for provenance
4. **Parallel fetching** - Fetch independent resources simultaneously
5. **Cache metadata** - Subject and license rarely change

### DON'T ❌

1. **Don't parse RC links** - Use `externalReference` instead
2. **Don't use deprecated params** - Use `path` for TW/TA
3. **Don't mix counts and metadata** - They're now separate
4. **Don't assume structure** - Check `resourceType` first
5. **Don't ignore errors** - 404 with TOC helps discovery

---

## Error Scenarios & Responses

### Empty/Invalid Path (TW & TA)

**Request:**
```bash
GET /api/fetch-translation-word?path=
```

**Response (404):**
```json
{
  "error": "No path provided. Please specify a translation word path.",
  "details": {
    "toc": {
      "bible": {
        "kt": ["love", "grace", "faith", ...],
        "names": ["abraham", "moses", ...],
        "other": ["servant", "witness", ...]
      }
    }
  }
}
```

**Agent Action:** Present TOC to user, let them choose.

### Deprecated Parameter

**Request:**
```bash
GET /api/fetch-translation-word?term=love
```

**Response (400):**
```json
{
  "error": "The 'term' parameter is no longer supported. Use 'path' instead.",
  "details": {
    "deprecatedParam": "term",
    "replacement": "path",
    "example": "/api/fetch-translation-word?path=bible/kt/love"
  }
}
```

**Agent Action:** Automatically retry with correct parameter.

---

## Performance Tips

### Tip 1: Batch External References

```typescript
// ❌ SLOW: Sequential
for (const item of items) {
  if (item.externalReference) {
    await fetch(`/api/...?path=${item.externalReference.path}`);
  }
}

// ✅ FAST: Parallel
const refs = items
  .filter(i => i.externalReference)
  .map(i => i.externalReference);

const results = await Promise.all(
  refs.map(ref => 
    fetch(`/api/fetch-${ref.target === 'tw' ? 'translation-word' : 'translation-academy'}?path=${ref.path}`)
      .then(r => r.json())
  )
);
```

### Tip 2: Cache Metadata

```typescript
const metadataCache = new Map();

function getCachedMetadata(resourceType: string) {
  if (!metadataCache.has(resourceType)) {
    // Fetch any resource of this type to get metadata
    const data = await fetchResource(resourceType);
    metadataCache.set(resourceType, data.metadata);
  }
  return metadataCache.get(resourceType);
}
```

### Tip 3: Use Counts for Planning

```typescript
async function estimateLoadTime(reference: string) {
  const tn = await fetch(`/api/fetch-translation-notes?reference=${reference}`)
    .then(r => r.json());
  
  const { totalCount } = tn.counts;
  
  // Estimate ~50ms per note to fetch external references
  const estimatedMs = totalCount * 50;
  
  console.log(`Estimated load time: ${estimatedMs}ms for ${totalCount} notes`);
}
```

---

## TypeScript Type Definitions

Use these in your agent implementation:

```typescript
interface StandardMetadata {
  resourceType: 'tw' | 'ta' | 'tn' | 'tq' | 'twl' | 'scripture';
  subject: string;
  language: string;
  organization: string;
  license: string;
  resources?: string[]; // Scripture only
  organizations?: string[]; // Multi-org responses
}

interface ExternalReference {
  target: 'tw' | 'ta';
  path: string;
  category?: string; // TW only
}

interface StandardCounts {
  totalCount?: number;
  verseNotesCount?: number;
  contextNotesCount?: number;
  questionsFound?: number;
  linksFound?: number;
  cached?: boolean;
  responseTime?: number;
}

interface BaseResponse {
  reference?: string;
  items?: any[];
  counts?: StandardCounts;
  metadata: StandardMetadata;
}
```

---

## Migration from Old Code

### Update Your Imports

```typescript
// OLD:
import { TranslationWordResponse } from './old-types';

// NEW:
import { TranslationWordResponse, StandardMetadata } from './new-types';
```

### Update Your Access Patterns

```typescript
// OLD:
const lang = response.language;
const org = response.organization;
const count = response.metadata.totalCount;

// NEW:
const lang = response.metadata.language;
const org = response.metadata.organization;
const count = response.counts.totalCount;
```

### Update Your Reference Following

```typescript
// OLD:
const match = item.rcLink.match(/rc:\/\/\*\/tw\/dict\/(.+)/);
const path = match ? match[1] : null;
await fetch(`/api/fetch-translation-word?path=${path}`);

// NEW:
const { path } = item.externalReference;
await fetch(`/api/fetch-translation-word?path=${path}`);
```

---

## Testing Your Integration

### Validation Checklist

- [ ] All endpoints return `metadata` object
- [ ] Metadata has all 5 required fields
- [ ] `externalReference` used instead of RC links
- [ ] `counts` separated from `metadata`
- [ ] External reference flow works (TN→TA, TWL→TW)
- [ ] Error handling works (404 with TOC, 400 for deprecated)

### Sample Test

```typescript
async function validateEndpoint(url: string, expectedType: string) {
  const resp = await fetch(url);
  const data = await resp.json();
  
  console.assert(data.metadata !== undefined, 'Metadata missing');
  console.assert(data.metadata.resourceType === expectedType, 'Wrong resource type');
  console.assert(data.metadata.subject !== undefined, 'Subject missing');
  console.assert(data.metadata.language !== undefined, 'Language missing');
  console.assert(data.metadata.organization !== undefined, 'Organization missing');
  console.assert(data.metadata.license === 'CC BY-SA 4.0', 'License missing');
  
  console.log(`✅ ${url} validated successfully`);
}
```

---

## Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| 404 error for TW/TA | Check the `path` parameter format |
| 400 error | Remove deprecated parameters (`term`, `moduleId`, etc.) |
| Missing metadata | Verify API version (should be latest) |
| Can't find external reference | Check `externalReference` not `rcLink` |
| Wrong organization | Check `metadata.organization` not root |

---

## Summary

**For agents, the new API is:**
- ✅ Simpler (fewer parameters, no RC parsing)
- ✅ Faster (pre-parsed references)
- ✅ More predictable (universal structure)
- ✅ Self-documenting (metadata tells you everything)
- ✅ Easier to test (consistent validation patterns)

**Key Takeaway:** Check `metadata.resourceType`, use `externalReference.path` directly, and enjoy the consistent structure everywhere!

---

**Last Updated:** March 12, 2026  
**API Version:** 2.0+ (post-standardization)  
**Contact:** See main project README for support
