/** The docs pages, in the order of the side menu. Paths are site paths: components add the base path. */
export const DOCS_PAGES = [
	{
		href: '/docs/resources',
		label: 'Resources',
		summary: 'The eight resources the server serves: what each is, who it is for, where it lives.'
	},
	{
		href: '/docs/workflow',
		label: 'Workflow',
		summary: 'The order an assistant works through a passage, and why it saves tokens.'
	},
	{
		href: '/docs/api',
		label: 'REST API',
		summary: 'The same data over plain HTTP: every endpoint, its parameters and an example answer.'
	},
	{
		href: '/docs/sdks',
		label: 'SDKs',
		summary: 'The JavaScript and Python clients, and the library packages.'
	},
	{
		href: '/docs/languages',
		label: 'Languages',
		summary: 'How a language is found, what it has, and what a language pack is.'
	},
	{
		href: '/docs/limits',
		label: 'Limits and errors',
		summary: 'The rate limit, soft failures, error codes and what the answers carry.'
	}
] as const;
