/**
 * Door43 Content Service (DCS) API client — v2 clean implementation.
 *
 * Wraps the catalog API at https://git.door43.org/api/v1 and the
 * unfoldingWord/scripture-burrito catalog at https://catalog.door43.org/v5.
 *
 * All fetches use standard `fetch` (available in CF Workers + Node 18+).
 */

// DCS_BASE reserved for future direct API calls (catalog v5 used for now)
// const DCS_BASE = "https://git.door43.org/api/v1";
const CATALOG_V5 = "https://catalog.door43.org/v5";

export interface CatalogEntry {
  owner: string;
  repo: string;
  name: string;
  subject?: string;
  ingredients: Array<{
    identifier: string;
    path: string;
    title?: string;
  }>;
  catalog?: {
    prod?: { branch_or_tag_name?: string; zipball_url?: string };
    preprod?: { branch_or_tag_name?: string; zipball_url?: string };
    latest?: { branch_or_tag_name?: string; zipball_url?: string };
  };
}

export interface LanguageEntry {
  code: string;
  name: string;
  direction?: "ltr" | "rtl";
}

/** Lightweight fetch wrapper with error handling. */
async function apiFetch<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "translation-helps-mcp/2.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from DCS: ${url}`);
  }
  return response.json() as Promise<T>;
}

/** List all languages that have at least one resource in the catalog. */
export async function listLanguages(): Promise<LanguageEntry[]> {
  const url = `${CATALOG_V5}/languages`;
  const data = await apiFetch<{ results?: LanguageEntry[] } | LanguageEntry[]>(
    url,
  );
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

/** List subjects available in the catalog (e.g. "Aligned Bible", "Translation Notes"). */
export async function listSubjects(): Promise<string[]> {
  const url = `${CATALOG_V5}/subjects`;
  const data = await apiFetch<{ results?: { subject: string }[] } | string[]>(
    url,
  );
  if (Array.isArray(data)) return data;
  return (data.results ?? []).map((s) => s.subject);
}

/** List all catalog resources for a given language (and optional subject filter). */
export async function listResourcesForLanguage(
  languageCode: string,
  opts?: {
    subject?: string;
    organization?: string;
    stage?: "prod" | "preprod" | "latest";
  },
): Promise<CatalogEntry[]> {
  const params = new URLSearchParams({
    language: languageCode,
    metadataType: "rc",
    stage: opts?.stage ?? "prod",
    limit: "50",
  });
  if (opts?.subject) params.set("subject", opts.subject);
  if (opts?.organization) params.set("owner", opts.organization);

  const url = `${CATALOG_V5}/search?${params}`;
  const data = await apiFetch<{ results?: CatalogEntry[] } | CatalogEntry[]>(
    url,
  );
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

/** Resolve a specific resource's zip URL from the catalog. */
export async function getResourceZipUrl(
  languageCode: string,
  subject: string,
  organization = "unfoldingWord",
  stage: "prod" | "preprod" | "latest" = "prod",
): Promise<{ zipUrl: string; entry: CatalogEntry } | null> {
  const resources = await listResourcesForLanguage(languageCode, {
    subject,
    organization,
    stage,
  });
  if (!resources.length) return null;

  const entry = resources[0];
  const catEntry = entry.catalog?.[stage] ?? entry.catalog?.prod;
  if (!catEntry?.zipball_url) return null;

  return { zipUrl: catEntry.zipball_url, entry };
}
