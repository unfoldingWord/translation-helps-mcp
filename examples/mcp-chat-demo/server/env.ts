import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load env the same places this monorepo usually keeps secrets:
 * 1. Repository root `.env` (see root `.env.example`) — was previously wrong: `../../` from here is `examples/`, not the repo root.
 * 2. `ui/.env` — SvelteKit/Vite dev for the main app loads private env from the `ui/` folder (`env.OPENAI_API_KEY` / `process.env` in `chat-stream`).
 * 3. This example’s `.env` (only fills vars not already set; dotenv does not override by default).
 */
export function loadDemoEnv(): void {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
  dotenv.config({ path: path.resolve(__dirname, "../../../ui/.env") });
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}
