import DOMPurify from 'isomorphic-dompurify';
import { renderMarkdown as renderDoor43Markdown } from './renderMarkdown';

/**
 * Markdown from the server to safe HTML. `renderMarkdown.ts` parses it and turns Door43
 * links (rc://… and relative paths) into buttons when `follow` accepts them, or into plain
 * text; the result is sanitized here once more, so nothing the server sends can run script.
 * Only http(s) links stay links.
 */
export function renderMarkdown(md: string, follow?: (href: string) => boolean): string {
	if (!md) return '';
	return DOMPurify.sanitize(renderDoor43Markdown(md, follow), {
		ALLOWED_TAGS: [
			'h1',
			'h2',
			'h3',
			'h4',
			'h5',
			'h6',
			'p',
			'br',
			'hr',
			'ul',
			'ol',
			'li',
			'strong',
			'em',
			'b',
			'i',
			'a',
			'code',
			'pre',
			'blockquote',
			'span',
			'button',
			'table',
			'thead',
			'tbody',
			'tr',
			'th',
			'td'
		],
		ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-rc', 'type', 'align']
	});
}
