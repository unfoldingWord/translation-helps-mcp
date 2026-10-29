import { Marked, type Tokens } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Strip hidden HTML comment markers (<!-- CHECKITEM:… -->, <!-- CHECK:… -->,
 * quiz/session footers, …) from chat-visible text. User bubbles render plain
 * text (no markdown pass), so without this the raw marker shows literally.
 */
export function stripHiddenMarkers(text: string): string {
	if (!text) return '';
	return text
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Human-readable label from the last path segment of an rc:// URI. */
export function rcLinkDisplayName(uri: string): string {
	const cleaned = uri.replace(/^rc:\/\//, '').replace(/\/+$/, '');
	const last = cleaned.split('/').filter(Boolean).pop() ?? uri;
	return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resource kind for chip styling: ta | tw | other. */
export function rcLinkKind(uri: string): 'ta' | 'tw' | 'other' {
	if (/\/ta\//i.test(uri)) return 'ta';
	if (/\/tw\//i.test(uri)) return 'tw';
	return 'other';
}

/**
 * Door43 TN markdown uses wiki-links like [[rc://…/ta/man/translate/figs-metaphor]].
 * Convert those (and relative [[…]]) into standard markdown links before parsing.
 */
export function preprocessDoor43Markdown(text: string): string {
	let out = text.replace(/\\n/g, '\n').replace(/<br\s*\/?>/gi, '\n');

	// [[rc://...]] → [Label](rc://...)
	out = out.replace(/\[\[(rc:\/\/[^\]]+)\]\]/gi, (_m, uri: string) => {
		const label = rcLinkDisplayName(uri);
		return `[${label}](${uri})`;
	});

	// Other wiki-links [[path]] → [path](path)
	out = out.replace(/\[\[([^\]\n]+)\]\]/g, (_m, inner: string) => {
		const target = inner.trim();
		if (!target || target.startsWith('rc://')) return _m;
		return `[${target}](${target})`;
	});

	return out;
}

/**
 * Door43 links that point inside Door43 (rc://… and relative paths like ../kt/love.md)
 * have no public URL. A link the page can open becomes a button whose `data-rc` holds the
 * address; the page's click handler opens the article. Any other one becomes its text.
 */
function renderInternalLink(href: string, label: string, follow: boolean): string {
	if (!follow) return `<span>${escapeHtml(label)}</span>`;
	const kind = rcLinkKind(href);
	const kindClass =
		kind === 'ta' ? 'rc-link--ta' : kind === 'tw' ? 'rc-link--tw' : 'rc-link--other';
	return (
		`<button type="button" class="rc-link ${kindClass}" ` +
		`title="Open ${escapeAttr(label)}" data-rc="${escapeAttr(href)}">${escapeHtml(label)}</button>`
	);
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
	return escapeHtml(s).replace(/'/g, '&#39;');
}

/** Which Door43 links of the text being parsed the page can open. Set only during `parse`. */
let canFollow: ((href: string) => boolean) | undefined;

const md = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		link({ href, title, text, tokens }: Tokens.Link): string {
			const url = href ?? '';
			if (/^https?:\/\//i.test(url)) {
				const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
				const inner = this.parser.parseInline(tokens);
				return `<a href="${escapeAttr(url)}"${titleAttr} target="_blank" rel="noopener noreferrer">${inner}</a>`;
			}
			// Everything else (rc://, ../kt/love.md, #, /…) has no address outside Door43.
			const label =
				text?.trim() && !text.trim().startsWith('rc://') ? text.trim() : rcLinkDisplayName(url);
			return renderInternalLink(url, label, !!canFollow?.(url));
		}
	}
});

/** The classes this file sets on links. Door43 content may not bring classes of its own. */
const OWN_CLASS = /^rc-link(--(ta|tw|other))?$/;

function keepOwnClasses(
	_node: Element,
	data: { attrName: string; attrValue: string; keepAttr: boolean }
) {
	if (data.attrName !== 'class') return;
	const kept = data.attrValue.split(/\s+/).filter((c) => OWN_CLASS.test(c));
	if (kept.length) data.attrValue = kept.join(' ');
	else data.keepAttr = false;
}

/**
 * Render markdown to sanitized HTML. Safe for {@html} usage.
 * `follow` says which Door43 links (rc://… or relative) the page can open: those become
 * buttons with `data-rc`, the others plain text. Without it, all of them are plain text.
 */
export function renderMarkdown(text: string, follow?: (href: string) => boolean): string {
	if (!text) return '';
	const normalized = preprocessDoor43Markdown(text);
	let raw: string;
	canFollow = follow;
	try {
		raw = md.parse(normalized) as string;
	} finally {
		canFollow = undefined;
	}
	DOMPurify.addHook('uponSanitizeAttribute', keepOwnClasses);
	try {
		return DOMPurify.sanitize(raw, {
			ALLOWED_TAGS: [
				'p',
				'br',
				'strong',
				'em',
				'b',
				'i',
				'ul',
				'ol',
				'li',
				'blockquote',
				'code',
				'pre',
				'h1',
				'h2',
				'h3',
				'h4',
				'h5',
				'h6',
				'a',
				'span',
				'button',
				'hr',
				'table',
				'thead',
				'tbody',
				'tr',
				'th',
				'td'
			],
			ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-rc', 'type', 'align'],
			ADD_ATTR: ['target']
		});
	} finally {
		DOMPurify.removeHook('uponSanitizeAttribute', keepOwnClasses);
	}
}
