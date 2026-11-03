/**
 * Shared parameter text for /v3. The language rule is on the parameter:
 * many clients never pass the server instructions to the model.
 */

import { z } from "zod";

export const V3_LANGUAGE_DESCRIPTION =
  'Language code (BCP-47) of the resources to read, e.g. "en", "es-419", "hi". Use the language the user asked for or writes in; do not fall back to "en" when they want another language. th_list_resources lists the codes.';

export const v3LanguageParam = z
  .string()
  .min(2)
  .default("en")
  .describe(V3_LANGUAGE_DESCRIPTION);
