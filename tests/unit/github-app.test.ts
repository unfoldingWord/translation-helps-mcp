/**
 * The Worker asks GitHub for builds as a GitHub App: an RS256 JWT signed with WebCrypto, exchanged for an
 * installation token that is kept in KV.
 */

import { createPrivateKey } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  appJwt,
  forgetInstallationToken,
  installationToken,
  type DispatchEnv,
} from "../../src/packs/githubApp";

function toPem(der: ArrayBuffer, label: string): string {
  const b64 = Buffer.from(der).toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

async function testKeys() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8Pem = toPem(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    "PRIVATE KEY",
  );
  // GitHub hands out PKCS#1 ("RSA PRIVATE KEY") files.
  const pkcs1Pem = createPrivateKey(pkcs8Pem)
    .export({ type: "pkcs1", format: "pem" })
    .toString();
  return { publicKey: pair.publicKey, pkcs8Pem, pkcs1Pem };
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

async function verifies(jwt: string, publicKey: CryptoKey): Promise<boolean> {
  const [header, payload, signature] = jwt.split(".");
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    Buffer.from(signature, "base64url"),
    new TextEncoder().encode(`${header}.${payload}`),
  );
}

function fakeKv() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; options: unknown }> = [];
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string, options?: unknown) => {
      store.set(key, value);
      puts.push({ key, options });
    },
    delete: async (key: string) => void store.delete(key),
  };
  return { kv: kv as unknown as KVNamespace, store, puts };
}

const NOW = new Date("2026-10-21T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

describe("appJwt", () => {
  it("signs an RS256 JWT with iat 60 s back, exp 9 min ahead and the App id as iss (PKCS#8 key)", async () => {
    const keys = await testKeys();
    const jwt = await appJwt("12345", keys.pkcs8Pem, NOW);
    const [header, payload] = jwt.split(".");
    expect(decodePart(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodePart(payload)).toEqual({
      iat: NOW_S - 60,
      exp: NOW_S + 9 * 60,
      iss: "12345",
    });
    expect(await verifies(jwt, keys.publicKey)).toBe(true);
  });

  it("accepts GitHub's PKCS#1 key as downloaded", async () => {
    const keys = await testKeys();
    expect(keys.pkcs1Pem).toContain("BEGIN RSA PRIVATE KEY");
    const jwt = await appJwt("12345", keys.pkcs1Pem, NOW);
    expect(await verifies(jwt, keys.publicKey)).toBe(true);
  });

  it("accepts a key stored with escaped newlines, as secrets often are", async () => {
    const keys = await testKeys();
    const escaped = keys.pkcs1Pem.replace(/\n/g, "\\n");
    const jwt = await appJwt("12345", escaped, NOW);
    expect(await verifies(jwt, keys.publicKey)).toBe(true);
  });
});

describe("installationToken", () => {
  async function setup() {
    const keys = await testKeys();
    const env: DispatchEnv = {
      GITHUB_APP_ID: "12345",
      GITHUB_APP_PRIVATE_KEY: keys.pkcs1Pem,
      GITHUB_APP_INSTALLATION_ID: "678",
    };
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { token: "ghs_test", expires_at: "2026-10-21T13:00:00Z" },
        { status: 201 },
      ),
    );
    return { keys, env, fetchImpl, ...fakeKv() };
  }

  it("exchanges the App JWT for an installation token with GitHub's headers", async () => {
    const { keys, env, fetchImpl, kv } = await setup();
    const token = await installationToken(
      env,
      kv,
      NOW,
      fetchImpl as unknown as typeof fetch,
    );
    expect(token).toBe("ghs_test");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.github.com/app/installations/678/access_tokens",
    );
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
    expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
    expect(headers.get("User-Agent")).toBeTruthy();
    const auth = headers.get("Authorization") ?? "";
    expect(auth.startsWith("Bearer ")).toBe(true);
    expect(await verifies(auth.slice("Bearer ".length), keys.publicKey)).toBe(
      true,
    );
  });

  it("keeps the token in KV for 50 minutes and reuses it", async () => {
    const { env, fetchImpl, kv, puts } = await setup();
    await installationToken(env, kv, NOW, fetchImpl as unknown as typeof fetch);
    expect(puts).toHaveLength(1);
    expect(puts[0].options).toEqual({ expirationTtl: 50 * 60 });

    const later = new Date(NOW.getTime() + 49 * 60_000);
    expect(
      await installationToken(
        env,
        kv,
        later,
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBe("ghs_test");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const tooLate = new Date(NOW.getTime() + 51 * 60_000);
    await installationToken(
      env,
      kv,
      tooLate,
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("still returns the token when KV cannot cache it, or cannot be read", async () => {
    const { env, fetchImpl, kv } = await setup();
    const failing = {
      ...kv,
      get: async () => {
        throw new Error("KV get failed");
      },
      put: async () => {
        throw new Error("KV PUT failed: 429");
      },
    } as unknown as KVNamespace;
    const token = await installationToken(
      env,
      failing,
      NOW,
      fetchImpl as unknown as typeof fetch,
    );
    expect(token).toBe("ghs_test");
  });

  it("forgets a cached token on request", async () => {
    const { env, fetchImpl, kv, store } = await setup();
    await installationToken(env, kv, NOW, fetchImpl as unknown as typeof fetch);
    expect(store.size).toBe(1);
    await forgetInstallationToken(env, kv);
    expect(store.size).toBe(0);
  });

  it("throws when GitHub refuses, and caches nothing", async () => {
    const { env, kv, puts } = await setup();
    const refusing = vi.fn(
      async () => new Response("Bad credentials", { status: 401 }),
    );
    await expect(
      installationToken(env, kv, NOW, refusing as unknown as typeof fetch),
    ).rejects.toThrow(/401/);
    expect(puts).toHaveLength(0);
  });

  it("throws without the App secrets", async () => {
    const { kv, fetchImpl } = await setup();
    await expect(
      installationToken({}, kv, NOW, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
