/**
 * src/core/contracts/index.ts
 *
 * Single source of truth for all shared data shapes used by the REST API,
 * MCP tools, and SDKs. Import from here, never from individual tool files.
 */

// ---------------------------------------------------------------------------
// Scripture
// ---------------------------------------------------------------------------

export type ScriptureVersionRole = "literal" | "simplified" | "original" | "other";

export interface ScriptureVersion {
  resourceType: string;
  role: ScriptureVersionRole;
  text: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Translation Notes
// ---------------------------------------------------------------------------

export interface TranslationNoteRow {
  book: string;
  chapter: string;
  verse: string;
  id: string;
  supportReference: string;
  quote: string;
  occurrence: string;
  note: string;
}

// ---------------------------------------------------------------------------
// Translation Word Links
// ---------------------------------------------------------------------------

export interface TranslationWordLinkRow {
  book: string;
  chapter: string;
  verse: string;
  twId: string;
  supportReference: string;
  origWords: string;
  occurrence: string;
  twLink: string;
  wordPath: string;
}

// ---------------------------------------------------------------------------
// Translation Questions
// ---------------------------------------------------------------------------

export interface TranslationQuestionRow {
  book: string;
  chapter: string;
  verse: string;
  id: string;
  question: string;
  response: string;
}

// ---------------------------------------------------------------------------
// Catalog article types
// ---------------------------------------------------------------------------

export interface AcademyArticle {
  path: string;
  title: string;
  category: string;
}

export interface WordArticle {
  path: string;
  title: string;
  category: "kt" | "other" | "names";
}

export interface ArticleSearchResult {
  path: string;
  title: string;
  resourceType: "ta" | "tw";
  score: number;
}

// ---------------------------------------------------------------------------
// Passage index (MCP workflow)
// ---------------------------------------------------------------------------

export interface QuoteShape {
  original: string;
  aligned: string;
}

export interface NoteIndexEntry {
  reference: string;
  id: string;
  quote: QuoteShape;
  occurrence: string;
  tags: string;
  taArticle: { path: string; title: string } | null;
}

export interface WordIndexEntry {
  reference: string;
  quote: QuoteShape;
  occurrence: string;
  twArticle: { path: string; category: string; title: string } | null;
}

export interface RollupEntry {
  path: string;
  title: string;
  count: number;
}

export interface PassageIndex {
  reference: string;
  language: string;
  notes: NoteIndexEntry[];
  words: WordIndexEntry[];
  issues: RollupEntry[];
  keyTerms: RollupEntry[];
}

// ---------------------------------------------------------------------------
// Resource availability (for context availability summary)
// ---------------------------------------------------------------------------

export interface ResourceAvailability {
  subject: string;
  abbreviation: string;
  role: ScriptureVersionRole | "notes" | "wordLinks" | "words" | "academy" | "questions";
}

// ---------------------------------------------------------------------------
// REST API error contract
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ApiErrorResponse {
  error: ApiError;
}
