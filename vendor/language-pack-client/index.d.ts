// Hand-written types of the vendored bundle: only what the Worker uses (see global constraints, "Allowed library calls").
export type TrustPolicy = { trustedKeys?: Record<string, Uint8Array> };

export type VerifiedCatalog = {
  id: string;
  bytes: Uint8Array;
  catalog: unknown;
  name: string;
  publisher: string;
  revision: number;
  origin: "published" | "local";
  signedBy?: string;
};

export type Answer<T> = {
  query: string;
  data: T | null;
  cites: unknown[];
  revision: { lang?: number; common?: number; units: Record<string, number> };
  coverage?: Record<string, unknown>;
  notInstalled: unknown[];
};

export type PassageData = unknown;
export type ArticleData = unknown;

export interface PackReader {
  lang: string;
  problems: unknown[];
  revisions(): { lang?: number; common?: number };
  installed(unit: string): boolean;
  book(book: string): Promise<unknown | undefined>;
  orig(book: string): Promise<unknown | undefined>;
  articles(group: string): Promise<unknown[] | undefined>;
  size(unit: string): number;
  unitOf(cls: "book" | "art" | "orig", key: string): string | undefined;
  listed(unit: string): boolean;
  passage(ref: string): Promise<Answer<PassageData>>;
  article(id: string, section?: string | "all"): Promise<Answer<ArticleData>>;
}

export class ClientError extends Error {
  code: string;
  status?: number;
  retryAfter?: number;
}

export function verifyCatalogFile(
  bytes: Uint8Array,
  policy: TrustPolicy,
  o: { from: "network" | "transfer" | "store" | "bridge"; expectedId?: string },
): Promise<VerifiedCatalog>;

export function openFromSegments(o: {
  lang: string;
  catalogs: VerifiedCatalog[];
  get: (id: string) => Promise<Uint8Array | undefined>;
}): PackReader;
