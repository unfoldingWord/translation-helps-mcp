import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/** Render markdown to sanitized HTML. Safe for {@html} usage. */
export function renderMarkdown(text: string): string {
	if (!text) return '';
	const raw = marked.parse(text) as string;
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
			'span'
		],
		ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
		ADD_ATTR: ['target']
	});
}
