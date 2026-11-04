/**
 * GET /api/v1/languages
 * Returns all tc-ready languages from the DCS catalog.
 */
import type { RouteContext } from "../worker.js";
import { json } from "../worker.js";
import { listLanguages } from "@translation-helps/door43";
import { serverTimingActive, withServerTiming } from "../serverTiming.js";

export async function handleLanguages(ctx: RouteContext): Promise<Response> {
  if (!serverTimingActive())
    return withServerTiming(() => handleLanguages(ctx));
  const { env } = ctx;
  const languages = await listLanguages(env.TRANSLATION_HELPS_CACHE);
  return json({ languages });
}
