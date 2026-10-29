/** One place for the site's name and the links every page uses. Plain TypeScript: no framework imports. */
export const SITE = {
	name: 'Translation Helps MCP',
	tagline: "unfoldingWord's translation helps for any AI assistant.",
	repo: 'https://github.com/unfoldingWord/translation-helps-mcp',
	door43: 'https://git.door43.org/unfoldingWord'
} as const;

/**
 * The REST API Worker (`translation-helps-api-v2`), the address production's `API_BASE_URL` names in wrangler.toml.
 * Its routes are under `/api/v1`. Staging reaches the same Worker through a service binding.
 */
export const API = {
	origin: 'https://translation-helps-api-v2.unfoldingword.workers.dev',
	basePath: '/api/v1'
} as const;

/**
 * How to install the 2.0 SDKs. They are not on npm or PyPI yet (the packages there under
 * the same names are the 1.x clients), so both install from the `v2` branch of the repository.
 */
export const SDK_INSTALL = {
	js: [
		'# The 2.0 client is not on npm yet: build it from the repository.',
		`git clone --branch v2 ${SITE.repo}.git`,
		'cd translation-helps-mcp && npm install',
		'npm run build --workspace packages/js-sdk',
		'',
		'# Then, in your project:',
		'npm install ../translation-helps-mcp/packages/js-sdk'
	].join('\n'),
	python: [
		'# The 2.0 client is not on PyPI yet: install it from the repository.',
		`pip install "git+${SITE.repo}.git@v2#subdirectory=packages/python-sdk"`
	].join('\n')
} as const;

/** Main navigation. Paths are site paths: the components add the base path. */
export const nav = [
	{ href: '/try', label: 'Try' },
	{ href: '/connect', label: 'Connect' },
	{ href: '/tools', label: 'Tools' },
	{ href: '/docs', label: 'Docs' }
] as const;

/** Footer links. A path starting with "/" is on this site; anything else is external. */
export const footerNav = [
	{ href: '/status', label: 'Status' },
	{ href: '/metrics', label: 'Metrics' },
	{ href: SITE.repo, label: 'GitHub' },
	{ href: SITE.door43, label: 'Door43' }
] as const;

/** The MCP endpoint of the site being viewed (a preview shows its own). */
export function endpointFor(origin: string): string {
	return `${origin.replace(/\/$/, '')}/v2/mcp`;
}
