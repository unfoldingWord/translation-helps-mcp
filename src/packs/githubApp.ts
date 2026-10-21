/**
 * The Worker's GitHub credentials: a GitHub App with `actions: write` on unfoldingWord/tc-study only. It signs an
 * App JWT with WebCrypto (no Node crypto in Workers) and trades it for a short-lived installation token.
 */

export type DispatchEnv = {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  PACKS_TARGET?: "staging" | "production";
};

export const GITHUB_API = "https://api.github.com";

export function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "translation-helps-mcp",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** GitHub installation tokens last 1 h; 50 min leaves room for a dispatch that starts near the end. */
const TOKEN_TTL_S = 50 * 60;

function tokenKey(installationId: string): string {
  return `packs:github-token:${installationId}`;
}

// --- PEM → PKCS#8 ----------------------------------------------------------------------------------------------------

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, content: Uint8Array): Uint8Array {
  const head = [tag, ...derLength(content.length)];
  const out = new Uint8Array(head.length + content.length);
  out.set(head);
  out.set(content, head.length);
  return out;
}

/** PrivateKeyInfo { version 0, AlgorithmIdentifier rsaEncryption NULL, OCTET STRING <RSAPrivateKey> }. */
function wrapPkcs1(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const rsaEncryption = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const octets = der(0x04, pkcs1);
  const body = new Uint8Array(
    version.length + rsaEncryption.length + octets.length,
  );
  body.set(version);
  body.set(rsaEncryption, version.length);
  body.set(octets, version.length + rsaEncryption.length);
  return der(0x30, body);
}

/** WebCrypto imports only PKCS#8, but GitHub downloads App keys as PKCS#1 ("RSA PRIVATE KEY"). */
function pemToPkcs8(pem: string): Uint8Array {
  // Secrets pasted through dashboards often arrive with literal "\n".
  const text = pem.replace(/\\n/g, "\n");
  const isPkcs1 = text.includes("BEGIN RSA PRIVATE KEY");
  const b64 = text
    .replace(/-----(BEGIN|END)[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return isPkcs1 ? wrapPkcs1(bytes) : bytes;
}

// --- JWT -------------------------------------------------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/** iat is 60 s back for clock drift; GitHub refuses an exp more than 10 min ahead. */
export async function appJwt(
  appId: string,
  privateKeyPem: string,
  now: Date = new Date(),
): Promise<string> {
  const nowS = Math.floor(now.getTime() / 1000);
  const signingInput = `${base64urlJson({ alg: "RS256", typ: "JWT" })}.${base64urlJson(
    {
      iat: nowS - 60,
      exp: nowS + 9 * 60,
      iss: appId,
    },
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

// --- Installation token ----------------------------------------------------------------------------------------------

type CachedToken = { token: string; until: number };

function readCached(raw: string | null, now: Date): string | null {
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as Partial<CachedToken>;
    // KV's own expiry is the real limit; `until` keeps an injected clock honest too.
    if (
      typeof cached.token === "string" &&
      typeof cached.until === "number" &&
      cached.until > now.getTime()
    ) {
      return cached.token;
    }
  } catch {
    // An unreadable cache entry is just a miss.
  }
  return null;
}

export async function installationToken(
  env: DispatchEnv,
  kv: KVNamespace,
  now: Date = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const {
    GITHUB_APP_ID: appId,
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_INSTALLATION_ID: installation,
  } = env;
  if (!appId || !privateKey || !installation)
    throw new Error("GitHub App secrets are not configured");

  const key = tokenKey(installation);
  const cached = readCached(await kv.get(key), now);
  if (cached) return cached;

  const jwt = await appJwt(appId, privateKey, now);
  const res = await fetchImpl(
    `${GITHUB_API}/app/installations/${encodeURIComponent(installation)}/access_tokens`,
    {
      method: "POST",
      headers: githubHeaders(jwt),
    },
  );
  if (!res.ok) throw new Error(`GitHub installation token: ${res.status}`);
  const body = (await res.json()) as { token?: unknown };
  if (typeof body.token !== "string")
    throw new Error("GitHub installation token: no token in the answer");

  const entry: CachedToken = {
    token: body.token,
    until: now.getTime() + TOKEN_TTL_S * 1000,
  };
  await kv.put(key, JSON.stringify(entry), { expirationTtl: TOKEN_TTL_S });
  return body.token;
}
