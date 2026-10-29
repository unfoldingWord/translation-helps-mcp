// Not prerendered: a static asset would bypass the /v2 redirect in hooks.server.ts
export const prerender = false;

export function load() {
	return {
		title: 'Building the Foundation for Real-Time Bible RAG',
		description:
			"We're systematically replacing traditional RAG layers, starting with the data access foundation. Concrete lookups solved. Semantic search coming next.",
		ogImage: '/api-manifesto-og.png'
	};
}
