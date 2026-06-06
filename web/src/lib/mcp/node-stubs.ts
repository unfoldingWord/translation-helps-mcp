/**
 * Stub file for Node.js built-in modules that are aliased in vite.config.ts.
 * These modules are not available in Cloudflare Workers / browser environments.
 * Importing 'os', 'fs', 'node:os', 'node:fs', 'node:path' resolves here.
 */

export default {};
export const platform = "browser";
export const homedir = () => "/";
export const tmpdir = () => "/tmp";
export const hostname = () => "localhost";
export const cpus = () => [];
export const release = () => "0.0.0";
export const arch = () => "browser";
export const readFileSync = () => null;
export const writeFileSync = () => null;
export const existsSync = () => false;
export const mkdirSync = () => null;
export const join = (...parts: string[]) => parts.join("/");
export const resolve = (...parts: string[]) => parts.join("/");
export const dirname = (p: string) => p.split("/").slice(0, -1).join("/");
export const basename = (p: string) => p.split("/").pop() ?? "";
export const extname = (p: string) => {
  const base = basename(p);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
};
