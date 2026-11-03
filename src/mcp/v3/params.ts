/**
 * Short parameter text for /v3. The language rule and the reference forms
 * are stated once in the server instructions.
 */

import { z } from "zod";

export const v3LanguageParam = z
  .string()
  .min(2)
  .default("en")
  .describe("BCP-47 code. Default en.");
