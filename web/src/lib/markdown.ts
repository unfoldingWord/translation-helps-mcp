import DOMPurify from 'isomorphic-dompurify';
import { renderMarkdown as renderDoor43Markdown } from './renderMarkdown';

/**
 * Markdown from the server to HTML for `{@html}`. `renderMarkdown.ts` parses it and turns
 * Door43 links (rc://… and relative paths) into buttons when `follow` accepts them, or into
 * plain text, and DOMPurify sanitizes the result there and once more here.
 *
 * The sanitizing happens only in the browser. In SSR and prerendering DOMPurify is a stub
 * that returns its input (`dompurify-ssr-stub.ts`, aliased in `vite.config.ts`), so the
 * output is not safe there. So `Markdown.svelte` must be shown only in the browser: the home
 * page waits for mount, and `ResultViewer` has nothing to show until a call made in the
 * browser has answered. In the browser, HTML that the
 * markdown carries is filtered to the tags and attributes below, so it can run no script,
 * but an `<a href>` written as HTML in the markdown stays a link with its own address.
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
