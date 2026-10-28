import DOMPurify from 'isomorphic-dompurify';
import { renderMarkdown as renderDoor43Markdown } from './renderMarkdown';

/**
 * Markdown from the server to safe HTML. `renderMarkdown.ts` parses it and
 * turns Door43 rc:// links into buttons; the result is sanitized here once more,
 * so nothing the server sends can run script. Links keep their DOMPurify-safe
 * schemes (renderMarkdown.ts already turns anything but http(s), #, and / into #).
 */
export function renderMarkdown(md: string): string {
	if (!md) return '';
	return DOMPurify.sanitize(renderDoor43Markdown(md), {
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
		ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class', 'data-rc', 'type']
	});
}
