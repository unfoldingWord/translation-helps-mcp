/**
 * The resources a scripture answer's `versionsNote` reads: every Bible and Aligned Bible resource of the language's own
 * catalog, picked or not (`scriptureVersionsForBook` names the ones it leaves out). The sweep records each of them in a
 * passage entry's `deps` (scripts/sweep-packs3.mjs `depsFor`) and the adapter serves only when those deps cover them
 * all at the catalog's release (adapters/scripture.ts), so a resource added later, or a new release of one not
 * picked, makes the passage fall back until it is swept again. No imports: the sweep loads it as is.
 */
export const VERSIONS_NOTE_SUBJECTS: readonly string[] = [
  "Aligned Bible",
  "Bible",
];

/** The keys, sorted, of the resources of `resources` (one catalog's) the versions note reads. */
export function versionsNoteKeys(
  resources: ReadonlyArray<{ key: string; subject: string }>,
): string[] {
  return [
    ...new Set(
      resources
        .filter((r) => VERSIONS_NOTE_SUBJECTS.includes(r.subject))
        .map((r) => r.key),
    ),
  ].sort();
}
