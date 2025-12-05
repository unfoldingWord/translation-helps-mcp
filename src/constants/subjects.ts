/**
 * Standardized Door43 Catalog Subjects
 * Maps resource types to catalog subject names
 * Supports both standard and TSV-prefixed variants
 *
 * Based on Door43 Catalog API subject names from:
 * https://git.door43.org/api/v1/catalog/list/subjects
 */

export const CATALOG_SUBJECTS = {
  // Scripture Resources
  BIBLE: "Bible",
  ALIGNED_BIBLE: "Aligned Bible",

  // Translation Helps (standard names)
  TRANSLATION_NOTES: "Translation Notes",
  TRANSLATION_WORDS: "Translation Words",
  TRANSLATION_QUESTIONS: "Translation Questions",
  TRANSLATION_ACADEMY: "Translation Academy",

  // Translation Helps (TSV variants - also valid in catalog)
  TSV_TRANSLATION_NOTES: "TSV Translation Notes",
  TSV_TRANSLATION_WORDS: "TSV Translation Words",
  TSV_TRANSLATION_QUESTIONS: "TSV Translation Questions",
  TSV_TRANSLATION_WORDS_LINKS: "TSV Translation Words Links",

  // Supporting Resources
  OPEN_BIBLE_STORIES: "Open Bible Stories",
  OBS_TRANSLATION_NOTES: "OBS Translation Notes",
  OBS_TRANSLATION_QUESTIONS: "OBS Translation Questions",
  OBS_STUDY_NOTES: "OBS Study Notes",
  OBS_STUDY_QUESTIONS: "OBS Study Questions",
  STUDY_NOTES: "Study Notes",
  STUDY_QUESTIONS: "Study Questions",
  TSV_STUDY_NOTES: "TSV Study Notes",
  TSV_STUDY_QUESTIONS: "TSV Study Questions",

  // Original Language Resources
  GREEK_NEW_TESTAMENT: "Greek New Testament",
  HEBREW_OLD_TESTAMENT: "Hebrew Old Testament",
  GREEK_GRAMMAR: "Greek Grammar",
  HEBREW_GRAMMAR: "Hebrew Grammar",
  GREEK_LEXICON: "Greek Lexicon",
  HEBREW_ARAMAIC_LEXICON: "Hebrew-Aramaic Lexicon",
  ARAMAIC_GRAMMAR: "Aramaic Grammar",

  // Other
  TRAINING_LIBRARY: "Training Library",
} as const;

/**
 * Default subjects for resource discovery
 * Used when searching for available resources in a language
 * Focused on core Bible translation resources (excludes OBS and grammar resources)
 */
export const DEFAULT_DISCOVERY_SUBJECTS = [
  // Scripture Resources
  CATALOG_SUBJECTS.BIBLE,
  CATALOG_SUBJECTS.ALIGNED_BIBLE,

  // Core Translation Helps
  CATALOG_SUBJECTS.TRANSLATION_WORDS,
  CATALOG_SUBJECTS.TRANSLATION_ACADEMY,
  CATALOG_SUBJECTS.TSV_TRANSLATION_NOTES,
  CATALOG_SUBJECTS.TSV_TRANSLATION_QUESTIONS,
  CATALOG_SUBJECTS.TSV_TRANSLATION_WORDS_LINKS,
] as const;

/**
 * Map resource type abbreviation to catalog subjects (supports variants)
 * Returns array of possible subject names for a given resource type
 */
export function getSubjectsForResourceType(resourceType: string): string[] {
  const type = resourceType.toLowerCase().trim();
  switch (type) {
    case "ult":
    case "glt":
      return [CATALOG_SUBJECTS.ALIGNED_BIBLE];
    case "ust":
    case "gst":
      return [CATALOG_SUBJECTS.BIBLE];
    case "tn":
      return [
        CATALOG_SUBJECTS.TRANSLATION_NOTES,
        CATALOG_SUBJECTS.TSV_TRANSLATION_NOTES,
      ];
    case "tw":
      return [
        CATALOG_SUBJECTS.TRANSLATION_WORDS,
        CATALOG_SUBJECTS.TSV_TRANSLATION_WORDS,
      ];
    case "tq":
      return [
        CATALOG_SUBJECTS.TRANSLATION_QUESTIONS,
        CATALOG_SUBJECTS.TSV_TRANSLATION_QUESTIONS,
      ];
    case "twl":
      return [CATALOG_SUBJECTS.TSV_TRANSLATION_WORDS_LINKS];
    case "ta":
      return [CATALOG_SUBJECTS.TRANSLATION_ACADEMY];
    case "obs":
      return [CATALOG_SUBJECTS.OPEN_BIBLE_STORIES];
    case "ugnt":
      return [CATALOG_SUBJECTS.GREEK_NEW_TESTAMENT];
    case "uhb":
      return [CATALOG_SUBJECTS.HEBREW_OLD_TESTAMENT];
    default:
      return [];
  }
}

/**
 * Get all subjects for multiple resource types
 */
export function getSubjectsForResourceTypes(resourceTypes: string[]): string[] {
  const allSubjects = new Set<string>();
  for (const type of resourceTypes) {
    const subjects = getSubjectsForResourceType(type);
    subjects.forEach((s) => allSubjects.add(s));
  }
  return Array.from(allSubjects);
}

/**
 * Map subject name to resource type abbreviation
 * Handles both standard and TSV-prefixed variants
 */
export function mapSubjectToResourceType(subject: string): string | undefined {
  const subjectLower = subject.toLowerCase();

  if (
    subjectLower.includes("translation words") &&
    !subjectLower.includes("links")
  ) {
    return "tw";
  }
  if (subjectLower.includes("translation notes")) {
    return "tn";
  }
  if (subjectLower.includes("translation questions")) {
    return "tq";
  }
  if (
    subjectLower.includes("translation word links") ||
    subjectLower.includes("twl")
  ) {
    return "twl";
  }
  if (subjectLower.includes("aligned bible") || subjectLower.includes("ult")) {
    return "ult";
  }
  if (subjectLower.includes("simplified") || subjectLower.includes("ust")) {
    return "ust";
  }
  if (subjectLower.includes("bible") && !subjectLower.includes("aligned")) {
    return "bible";
  }
  if (
    subjectLower.includes("translation academy") ||
    subjectLower.includes("ta")
  ) {
    return "ta";
  }
  if (
    subjectLower.includes("open bible stories") ||
    subjectLower.includes("obs")
  ) {
    return "obs";
  }

  return undefined;
}
