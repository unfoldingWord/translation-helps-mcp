/**
 * Sticky CHECKING session markers — pure string helpers.
 *
 * IMPORTANT: imported by the browser chat page. Keep this module free of
 * door43 / fflate / Node-only deps (Vite marks fflate external for SSR).
 */

/** Hidden sticky-checking marker (not shown in UI). */
export function buildCheckingSessionMarker(reference: string): string {
  const ref = reference.trim().replace(/\s+/g, " ");
  return `<!-- CHECKING:${ref} -->`;
}

/** Terminal clear — ends sticky checking for later turns. */
export function buildCheckingClearedMarker(): string {
  return `<!-- CHECKING:cleared -->`;
}

/**
 * Ensure a checking reply carries the sticky session marker (and optionally
 * a cleared marker). Preserves any existing CHECKING footer.
 */
export function ensureCheckingSessionFooter(
  response: string,
  reference: string,
  opts?: { cleared?: boolean },
): string {
  const base = response.trimEnd();
  if (opts?.cleared) {
    if (/<!--\s*CHECKING:cleared\s*-->/i.test(base)) return base;
    // Drop a live session marker when clearing.
    const withoutLive = base
      .replace(/\n?<!--\s*CHECKING:(?!cleared)[^>]*-->\s*/gi, "\n")
      .trimEnd();
    return `${withoutLive}\n${buildCheckingClearedMarker()}`;
  }
  if (/<!--\s*CHECKING:/i.test(base)) return base;
  const ref = reference.trim();
  if (!ref) return base;
  return `${base}\n${buildCheckingSessionMarker(ref)}`;
}
