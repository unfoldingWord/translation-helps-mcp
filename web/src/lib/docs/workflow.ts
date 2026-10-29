/**
 * The order the server recommends (src/mcp/instructions.ts), one step per stage, with a call you can run in Try.
 * Plain TypeScript: the tests check that every call matches the tool's schema.
 * One passage throughout, Titus 1:1; the article paths are examples, a real run takes them from the index.
 */
export type WorkflowCall = {
	tool: string;
	args: Record<string, unknown>;
	/** What this call fetches, in a few words. */
	label: string;
};

export type WorkflowStep = {
	id: string;
	title: string;
	text: string;
	calls: WorkflowCall[];
};

const passage = { reference: 'Titus 1:1', language: 'en' };

export const WORKFLOW: WorkflowStep[] = [
	{
		id: 'passage',
		title: 'Read the passage',
		text: 'Start with the text itself: the literal and the simplified English, and the Greek or Hebrew under them. This call is cheap, so an assistant can repeat it any time it needs to read the verse again.',
		calls: [{ tool: 'get_passage', args: passage, label: 'The text of Titus 1:1' }]
	},
	{
		id: 'context',
		title: 'Get the background',
		text: 'Ask once per passage for the book and chapter introductions, and for which resources exist in this language. It does not repeat the verse.',
		calls: [{ tool: 'get_passage_context', args: passage, label: 'Introductions for Titus 1' }]
	},
	{
		id: 'index',
		title: 'Survey the helps',
		text: 'The index lists every note and key term for the passage, with the Greek words it is about and a pointer to the full text. It carries no note or article bodies.',
		calls: [{ tool: 'get_passage_index', args: passage, label: 'The helps map of Titus 1:1' }]
	},
	{
		id: 'helps',
		title: 'Open the helps that matter',
		text: 'Pick from the index. A note comes by its id, a Translation Academy lesson or a key term by the path the index gave. Search finds an article when no note points to it.',
		calls: [
			{ tool: 'get_note', args: passage, label: 'The notes on Titus 1:1' },
			{
				tool: 'get_academy_article',
				args: { path: 'translate/figs-metaphor', language: 'en' },
				label: 'A Translation Academy lesson'
			},
			{
				tool: 'get_word_article',
				args: { path: 'bible/kt/god', language: 'en' },
				label: 'A key term article'
			}
		]
	},
	{
		id: 'questions',
		title: 'Check the draft',
		text: 'When a translation draft exists, the questions test that it says what the passage says. An empty list means there are none for this language yet; that is not an error.',
		calls: [{ tool: 'get_questions', args: passage, label: 'Questions on Titus 1:1' }]
	}
];

/** Why the order saves tokens, for the page. */
export const WHY_INDEX =
	'Notes and articles are the long part of the answer. The index is short: it names every note and key term and says which words each one explains, but holds none of the text. The assistant reads that list, chooses what the translator needs, and fetches only those items. Fetching everything for a passage would put pages of text into the conversation that nobody asked for.';
