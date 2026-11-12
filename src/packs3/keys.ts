/**
 * Trusted signing keys for format 3 catalogs, from `PACKS_V3_TRUSTED_KEYS`: `"<16 hex>:<64 hex>,..."`. A key id is
 * the first 16 hex digits of the sha256 of the 32 raw key bytes (spec/catalog.md, "Signatures"), checked here so a
 * mistyped entry turns format 3 off instead of silently trusting nothing.
 */

const warned = new Set<string>();

/** Logs a line once per isolate for a `(lang, reason)` pair. */
export function warnOnce(lang: string, reason: string): void {
  const k = `${lang}\u0000${reason}`;
  if (warned.has(k)) return;
  warned.add(k);
  console.warn("packs3 fallback", { lang, reason });
}

export function resetWarnOnceForTests(): void {
  warned.clear();
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous sha256 (WebCrypto's is async and `parseTrustedKeys` is not). */
function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  dv.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!,
      b = h[1]!,
      c = h[2]!,
      d = h[3]!,
      e = h[4]!,
      f = h[5]!,
      g = h[6]!,
      hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          K[i]! +
          w[i]!) >>>
        0;
      const t2 =
        ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i]! + v) >>> 0));
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  h.forEach((v, i) => odv.setUint32(i * 4, v));
  return out;
}

const toHex = (u: Uint8Array) =>
  Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

/** `null` for unset, empty or any malformed entry (logged once). */
export function parseTrustedKeys(
  value: string | undefined,
): Record<string, Uint8Array> | null {
  if (value === undefined || value.trim() === "") return null;
  const keys: Record<string, Uint8Array> = {};
  for (const entry of value.split(",")) {
    const m = /^([0-9a-f]{16}):([0-9a-f]{64})$/.exec(entry.trim());
    if (!m) {
      warnOnce("-", "trusted-keys-malformed");
      return null;
    }
    const raw = Uint8Array.from(m[2]!.match(/../g)!, (x) => parseInt(x, 16));
    if (toHex(sha256(raw)).slice(0, 16) !== m[1]) {
      warnOnce("-", "trusted-keys-id-mismatch");
      return null;
    }
    keys[m[1]!] = raw;
  }
  return keys;
}
