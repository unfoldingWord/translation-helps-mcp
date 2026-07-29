/**
 * Platform-neutral storage interfaces.
 *
 * Cloudflare Workers bindings (KVNamespace, R2Bucket) and simple in-memory
 * mocks both satisfy these structurally — inject them via ZipEnv / TocEnv.
 */

/** Duck-typed subset of Cloudflare KVNamespace. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

/** Object returned from a bucket get(). */
export interface BucketObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Duck-typed subset of Cloudflare R2Bucket (bytes in/out only). */
export interface BucketLike {
  get(key: string): Promise<BucketObjectLike | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<unknown>;
}

/** Schedule work that may outlive the current request (e.g. CF waitUntil). */
export type WaitUntil = (promise: Promise<unknown>) => void;

export interface WaitUntilHost {
  waitUntil(promise: Promise<unknown>): void;
}
