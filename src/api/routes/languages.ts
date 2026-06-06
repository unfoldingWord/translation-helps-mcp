/**
 * GET /api/v1/languages
 * Returns all tc-ready languages from the DCS catalog.
 */
import type { RouteContext } from "../worker.js";
import { json } from "../worker.js";
import { listLanguages } from "../../core/resources/dcsClient.js";

export async function handleLanguages({ env }: RouteContext): Promise<Response> {
  const languages = await listLanguages(env.TRANSLATION_HELPS_CACHE);
  return json({ languages });
}
