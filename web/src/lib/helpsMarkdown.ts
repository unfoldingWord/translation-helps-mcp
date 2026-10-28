/**
 * Parts of tool answers written as markdown, shared by the home page (`home/anatomy.ts`)
 * and the Try page (`try/rendered.ts`). Plain TypeScript: the tests import it.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * `get_questions` and `get_obs_questions`: each question in bold, then its answer.
 * With `reference`, the question starts with the verse or frame it is about ("1:1 · …").
 * "" when there are no questions with text.
 */
export function questionsAsMarkdown(
	questions: unknown,
	{ reference = false }: { reference?: boolean } = {}
): string {
	if (!Array.isArray(questions)) return '';
	return questions
		.filter(isRecord)
		.filter((q) => str(q.question))
		.map((q) => {
			const at = reference ? str(q.reference) : '';
			const head = at ? `${at} · ${str(q.question)}` : str(q.question);
			return `**${head}**\n\n${str(q.response)}`.trim();
		})
		.join('\n\n');
}
