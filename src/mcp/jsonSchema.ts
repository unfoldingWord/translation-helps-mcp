/**
 * Single source of truth for serializing MCP tool schemas to JSON Schema.
 *
 * zod 4 ships JSON Schema generation natively. The previous dependency,
 * `zod-to-json-schema@3`, is a zod-3 library: handed a zod 4 schema it does
 * not throw — it returns `{ "$schema": "..." }` with no `properties`, so the
 * published tool contract silently loses every argument (#42).
 *
 * Both the manifest (`src/mcp/manifest.ts`) and the web MCP proxy route
 * (`web/src/routes/api/mcp-proxy/+server.ts`) must use this helper so the two
 * surfaces cannot drift apart.
 */
import { z } from "zod";

export function toJsonSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, {
    // Matches the dialect the previous generator emitted.
    target: "draft-7",
    io: "input",
    // zod 3's generator emitted `additionalProperties: false` on every object;
    // zod 4 omits it. Restore it so the zod 4 upgrade does not quietly loosen
    // the published tool contract from strict to permissive.
    override: (ctx) => {
      const js = ctx.jsonSchema as Record<string, unknown>;
      if (js && js.type === "object" && js.properties) {
        js.additionalProperties = false;
      }
    },
  });
}
