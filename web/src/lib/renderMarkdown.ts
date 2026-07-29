import { marked, type Tokens } from 'marked';
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
 * Door43 rc:// links (TA/TW/TN cross-references) don't resolve to any stable
 * public URL, so we render them as in-app buttons instead of dead external
 * links. A delegated click handler (see TranslationNoteCard) reads `data-rc`
 * and asks the assistant to explain that specific article/term in chat —
 * this mirrors how tc-study treats rc:// links as internal navigation.
 */
function renderRcAnchor(href: string, text: string): string {
	const kind = rcLinkKind(href);
	const label = text?.trim() && !text.startsWith('rc://') ? text.trim() : rcLinkDisplayName(href);
	const kindClass =
		kind === 'ta' ? 'rc-link--ta' : kind === 'tw' ? 'rc-link--tw' : 'rc-link--other';
	return (
		`<button type="button" class="rc-link ${kindClass}" ` +
		`title="${escapeAttr(href)}" data-rc="${escapeAttr(href)}">${escapeHtml(label)}</button>`
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

const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }: Tokens.Link): string => {
	const url = href ?? '';
	if (url.startsWith('rc://')) {
		return renderRcAnchor(url, text);
	}
	const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
	const safe = url.startsWith('http') || url.startsWith('/') || url.startsWith('#') ? url : '#';
	return `<a href="${escapeAttr(safe)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({
	gfm: true,
	breaks: false,
	renderer
});

/** Render markdown to sanitized HTML. Safe for {@html} usage. */
export function renderMarkdown(text: string): string {
	if (!text) return '';
	const normalized = preprocessDoor43Markdown(text);
	const raw = marked.parse(normalized) as string;
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
			'hr'
		],
		ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-rc', 'type'],
		ADD_ATTR: ['target']
	});
}
