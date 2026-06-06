/**
 * src/core/resources/articleTitles.ts
 *
 * Resolve human-readable titles for TA supportReferences and TW twLinks
 * from catalog ingredient metadata — no article fetch required.
 *
 * Ported from bt-synergy: apps/tc-study/src/components/resources/
 *   TranslationNotesViewer/hooks/useEntryTitles.ts → findTitleInIngredients
 */

// ---------------------------------------------------------------------------
// findTitleInIngredients (ported)
// ---------------------------------------------------------------------------

/**
 * Search a catalog entry's ingredients list for the title of a given entry.
 *
 * Matches by:
 * 1. `ing.identifier === entryId`
 * 2. `ing.path` (without .md) === entryId
 * 3. For academy: last slug segment match
 * 4. For words: last two slug segments (category/term) match
 *
 * Returns the ingredient's `title` field, or `null` if not found.
 */
export function findTitleInIngredients(
  ingredients: Array<{ identifier?: string; path?: string; title?: string }>,
  entryId: string,
  resourceType: "academy" | "words",
): string | null {
  const ingredient = ingredients.find((ing) => {
    if (ing.identifier === entryId) return true;
    if (ing.path && ing.path.replace(/\.md$/, "") === entryId) return true;

    if (resourceType === "academy") {
      const entryLast = entryId.split("/").pop();
      const ingId = ing.identifier?.split("/").pop();
      if (entryLast && ingId && entryLast === ingId) return true;
    }

    if (resourceType === "words") {
      const entryParts = entryId.split("/");
      const ingParts = ing.identifier?.split("/") ?? [];
      if (entryParts.length >= 2 && ingParts.length >= 2) {
        const entryTerm = entryParts[entryParts.length - 1];
        const entryCategory = entryParts[entryParts.length - 2];
        const ingTerm = ingParts[ingParts.length - 1];
        const ingCategory = ingParts[ingParts.length - 2];
        if (entryTerm === ingTerm && entryCategory === ingCategory) return true;
      }
    }

    return false;
  });

  return ingredient?.title ?? null;
}

// ---------------------------------------------------------------------------
// resolveTitleFromPath (slug-level fallback, no network)
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable title from an rc:// link or slug path.
 *
 * Examples:
 *   "rc://star/ta/man/translate/figs-metaphor" gives "Figs Metaphor"
 *   "translate/figs-metaphor"                  gives "Figs Metaphor"
 *   "rc://star/tw/dict/bible/kt/god"           gives "God"
 *   "bible/kt/god"                             gives "God"
 *
 * This is a cheap, synchronous fallback used when ingredient titles are not
 * available. The title is derived by taking the last path segment and
 * prettifying it (hyphen/underscore to spaces, title-case each word).
 */
export function resolveTitleFromPath(pathOrRcLink: string): string | null {
  if (!pathOrRcLink) return null;

  // Strip rc:// prefix and wildcard owner
  const cleaned = pathOrRcLink
    .replace(/^rc:\/\/[^/]+\//, "")  // remove rc://*/  or rc://lang/
    .replace(/^ta\/man\//, "")       // remove ta/man/ segment
    .replace(/^tw\/dict\//, "");     // remove tw/dict/ segment

  // Take last meaningful segment
  const parts = cleaned.split("/").filter(Boolean);
  const slug = parts[parts.length - 1] ?? cleaned;

  if (!slug) return null;

  // Prettify: replace hyphens/underscores with spaces, title-case each word
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
