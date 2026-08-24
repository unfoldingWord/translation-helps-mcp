/**
 * @translation-helps/door43
 *
 * Catalog client, ZIP resource fetcher, and parsers for Door43 / DCS
 * Bible translation resources (scripture, notes, words, academy, OBS).
 */

// Platform injection interfaces
export type {
  KvLike,
  BucketLike,
  BucketObjectLike,
  WaitUntil,
  WaitUntilHost,
} from "./platform.js";

// Contracts / shared shapes
export type {
  ScriptureVersionRole,
  ScriptureVersion,
  TranslationNoteRow,
  TranslationWordLinkRow,
  TranslationQuestionRow,
  AcademyArticle,
  WordArticle,
  ArticleSearchResult,
  QuoteShape,
  NoteIndexEntry,
  WordIndexEntry,
  RollupEntry,
  PassageIndex,
  ResourceAvailability,
  ApiError,
  ApiErrorResponse,
} from "./contracts/index.js";

// Catalog / DCS client
export {
  clearCatalogProcessCache,
  catalogSearch,
  listLanguages,
  listSubjects,
  listResourcesForLanguage,
  findLanguageVariants,
  resolveCatalogLanguage,
  pickPreferredCatalogEntry,
  getResourceZipUrl,
  getResourceZipUrlByAbbreviation,
} from "./resources/dcsClient.js";
export type {
  CatalogKVCache,
  CatalogEntry,
  LanguageEntry,
  CatalogSearchOptions,
} from "./resources/dcsClient.js";

// ZIP fetcher
export { ZipResourceFetcher2 } from "./resources/ZipResourceFetcher2.js";
export type {
  ZipCacheSource,
  ZipEnv,
} from "./resources/ZipResourceFetcher2.js";

// Reference parsing
export {
  parseReference,
  parseReferenceForTool,
  normalizeReference,
  bookNameToUsfm,
} from "./resources/referenceParser.js";

// Scripture roles
export { resolveScriptureVersionRole } from "./resources/scriptureRoles.js";

// Reference parsing (types)
export type {
  ParsedReference,
  ToolReference,
} from "./resources/referenceParser.js";
export { isValidReference } from "./resources/referenceParser.js";

// OBS
export {
  parseObsReference,
  parseObsStoryMarkdown,
  parseObsNotesTsv,
  parseObsQuestionsTsv,
  obsStoryPath,
  storyFilename,
} from "./resources/obs.js";
export type {
  ObsReference,
  ObsFrame,
  ObsStory,
  ObsNoteRow,
  ObsQuestionRow,
} from "./resources/obs.js";

// rc:// links
export {
  parseRcLink,
  rcToTaPath,
  rcToTwPath,
  extractTaPathsFromNotes,
  extractTwPathsFromLinks,
} from "./resources/rcLinks.js";
export type { RcLink } from "./resources/rcLinks.js";

// Article titles / TOC
export {
  findTitleInIngredients,
  resolveTitleFromPath,
} from "./resources/articleTitles.js";
export {
  getArticleTitleMap,
  resolveTitleFromToc,
} from "./resources/articleToc.js";
export type { TocEnv } from "./resources/articleToc.js";

// Parsers
export * from "./parsers/index.js";

// Alignment
export * from "./alignment/index.js";
