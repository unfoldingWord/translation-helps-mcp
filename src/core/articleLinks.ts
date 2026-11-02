/**
 * Rewrite repository-relative and rc:// article links into paths the
 * article tools accept. Note links (rc://…/tn/help/…) stay as they are.
 */

import { resolveTitleFromPath } from "@translation-helps/door43";

export interface ArticleLinkRef {
  path: string;
  title: string;
}

export interface ArticleLinkSource {
  kind: "tw" | "ta";
  path: string;
}

const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;
const WIKI_LINK = /\[\[(rc:\/\/[^\]\s]+)\]\]/gi;
const RC_ARTICLE = /^rc:\/\/[^/]+\/(tw\/dict|ta\/man|tn\/help)\/(.+)$/i;

function canonical(kind: "tw" | "ta", raw: string): string | null {
  let bare = raw.trim().replace(/\.md$/i, "");
  if (kind === "ta") bare = bare.replace(/\/\d+$/i, "");
  const parts = bare.split("/").filter(Boolean);
  if (kind === "tw") {
    if (parts.length !== 3) return null;
    if (!/^bible$/i.test(parts[0] ?? "")) return null;
    if (!/^(kt|names|other)$/i.test(parts[1] ?? "")) return null;
    return `bible/${(parts[1] ?? "").toLowerCase()}/${(parts[2] ?? "").toLowerCase()}`;
  }
  if (parts.length !== 2) return null;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(parts[0] ?? "")) return null;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(parts[1] ?? "")) return null;
  return `${parts[0]}/${parts[1]}`;
}

function folderOf(from: ArticleLinkSource): string[] | null {
  const key = canonical(from.kind, from.path);
  if (!key) return null;
  const parts = key.split("/");
  return from.kind === "ta" ? parts : parts.slice(0, -1);
}

function fromRelative(href: string, from: ArticleLinkSource): string | null {
  if (!/^(?:\.{1,2}\/)/.test(href) || !/\.md$/i.test(href)) return null;
  const folder = folderOf(from);
  if (!folder) return null;
  const out = [...folder];
  for (const part of href.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return canonical(from.kind, out.join("/"));
}

function fromRc(href: string): string | "leave" | null {
  const match = RC_ARTICLE.exec(href.trim());
  if (!match) return null;
  const kind = (match[1] ?? "").toLowerCase();
  if (kind === "tn/help") return "leave";
  if (kind === "tw/dict") return canonical("tw", match[2] ?? "");
  return canonical("ta", match[2] ?? "");
}

function titleFor(
  path: string,
  label: string,
  titleOf?: (path: string) => string | undefined,
): string {
  const known = titleOf?.(path)?.trim();
  if (known) return known;
  const text = label.trim();
  if (text && !/^rc:\/\//i.test(text) && !text.includes("/")) return text;
  return resolveTitleFromPath(path) ?? path.split("/").pop() ?? path;
}

/**
 * Rewrite article links in `markdown`. The returned article is what the
 * MCP tools should show. `related` lists each rewritten article once.
 */
export function rewriteHelpsLinks(
  markdown: string,
  from: ArticleLinkSource,
  titleOf?: (path: string) => string | undefined,
): { article: string; related: ArticleLinkRef[] } {
  const related: ArticleLinkRef[] = [];
  const seen = new Set<string>();

  const remember = (path: string, label: string): void => {
    if (seen.has(path) || path === from.path.replace(/\.md$/i, "")) return;
    seen.add(path);
    related.push({ path, title: titleFor(path, label, titleOf) });
  };

  const article = markdown
    .replace(MD_LINK, (whole, label: string, href: string) => {
      const rc = fromRc(href);
      if (rc === "leave") return whole;
      const path = rc ?? fromRelative(href, from);
      if (!path) return whole;
      remember(path, label);
      return `[${label}](${path})`;
    })
    .replace(WIKI_LINK, (whole, href: string) => {
      const rc = fromRc(href);
      if (rc === "leave" || rc === null) return whole;
      remember(rc, "");
      return `[[${rc}]]`;
    });

  return { article, related };
}
