/** SSR stub — isomorphic-dompurify's browser build needs `window` (Workers have none). */
export default {
	sanitize(html: string): string {
		return html;
	},
	addHook(): void {},
	removeHook(): void {}
};
