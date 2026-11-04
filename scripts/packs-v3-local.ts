/**
 * scripts/packs-v3-local.ts
 *
 * Serves /v3/packs/* from a folder through the Worker's own handler (src/api/routes/packsV3.ts), so a staging
 * folder can be checked with the same bytes, headers and statuses the Worker gives. PACKS_V3 is on, the bucket is
 * the folder (src/packs/dirBucket.ts), there is no analytics and no rate limit. Nothing is written anywhere.
 *
 *   npx tsx scripts/packs-v3-local.ts --dir <folder> [--port 8790]
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { handlePacksV3Request } from "../src/api/routes/packsV3";
import { dirBucket } from "../src/packs/dirBucket";

const PREFIX = "/v3/packs/";
const HOST = "127.0.0.1";

export type LocalServer = {
  url: string;
  port: number;
  server: Server;
  close: () => Promise<void>;
};

export async function startLocalServer(opts: {
  dir: string;
  port?: number;
}): Promise<LocalServer> {
  const env = {
    PACKS_V3: "on",
    LANGUAGE_PACKS: dirBucket(opts.dir),
    // Packs never reads the cache on the v3 route; a rate limit of 0 is off.
    TRANSLATION_HELPS_CACHE: {} as KVNamespace,
    RATE_LIMIT_RPM: "0",
    PARTS_RATE_LIMIT_RPM: "0",
  };
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    let response: Response;
    if (!url.pathname.startsWith(PREFIX)) {
      response = new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      response = await handlePacksV3Request(
        new Request(url, { method: req.method, headers }),
        env as never,
        ctx,
        url.pathname.slice(PREFIX.length),
      );
    }
    const out: Record<string, string> = {};
    response.headers.forEach((value, name) => (out[name] = value));
    res.writeHead(response.status, out);
    if (!response.body || req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[packs-v3-local]", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 8790, HOST, resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://${HOST}:${port}`,
    port,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]) {
  const dir = argValue(argv, "--dir");
  if (!dir) {
    console.error("usage: packs-v3-local.ts --dir <folder> [--port 8790]");
    process.exit(2);
    return;
  }
  const port = Number(argValue(argv, "--port") ?? 8790);
  const started = await startLocalServer({ dir, port });
  console.log(`listening on ${started.url}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
