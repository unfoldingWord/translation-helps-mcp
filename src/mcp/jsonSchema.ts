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

/**
 * Wrap a tool's Zod raw shape for `McpServer.registerTool`.
 *
 * Passing a bare shape lets the SDK build a plain `z.object()`, and SDK 1.30's
 * zod 4 path (`zod/v4-mini`'s `toJSONSchema`) omits `additionalProperties`
 * for those — so `tools/list` would advertise OPEN objects where the zod 3
 * path advertised closed ones (#42 review).
 *
 * `.meta()` sets the emitted JSON Schema keyword WITHOUT changing parse
 * semantics: the object still accepts-and-strips unknown keys, exactly as
 * before. `z.strictObject()` would also emit the keyword but would start
 * THROWING on unknown keys, undoing the argument tolerance of #24/#28.
 *
 * Only INPUT schemas need this. The SDK serializes `outputSchema` with
 * `io: "output"`, which already emits `additionalProperties: false` because an
 * object's output is exactly its declared keys — verified 13/13 both before
 * and after this change.
 */
export function strictToolSchema(shape: z.ZodRawShape): z.ZodType {
  return z.object(shape).meta({ additionalProperties: false });
}
