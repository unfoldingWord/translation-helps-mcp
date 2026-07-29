import type { LLMProvider } from '$core/rag/providers/LLMProvider.js';
import type { HarnessEmit } from '$core/harness/ContextHarness.js';
import {
	draftCheckCoachInstructions,
	stripCoachScaffoldLabels
} from '$core/harness/coachPedagogy.js';

export interface CheckerNote {
	id: string;
	quote?: string;
	noteText: string;
	verse?: string;
}
export interface CheckerQuestion {
	id: string;
	question: string;
	response?: string;
	verse?: string;
}

export interface CheckDeps {
	llm: LLMProvider;
}

/**
 * Ask source-grounded CANA check questions for a passage.
 * Does not receive or evaluate receptor-language draft text.
 */
export async function runDraftCheck(
	_draft: string,
	reference: string,
	language: string,
	tnNotes: CheckerNote[],
	tqQuestions: CheckerQuestion[],
	deps: CheckDeps,
	emit: Pick<HarnessEmit, 'status' | 'token'>
): Promise<{ response: string }> {
	const { llm } = deps;
	emit.status('Preparing check questions…');

	const noteBlock = tnNotes
		.slice(0, 8)
		.map((n) => `- "${n.quote ?? '?'}": ${n.noteText}`)
		.join('\n');
	const questionBlock = tqQuestions
		.slice(0, 6)
		.map((q) => `- Q: ${q.question}${q.response ? `\n  Expected: ${q.response}` : ''}`)
		.join('\n');

	const system = [
		`You are Ezer — a Bible translation consultant.`,
		`Your job is to ask CANA consultant questions (Consistent, Accurate, Natural, Clear) about source items — not to read, rewrite, or grade receptor-language wording.`,
		draftCheckCoachInstructions(language),
		`Language lock: Always reply in the source/conversation language (${language}). Target/receptor language is metadata only — never switch into it, and never praise or evaluate target wording the user volunteers.`,
		`Use the Translation Notes and comprehension questions below as the only grounding for probe questions.`,
		`Use everyday words a beginner understands. ALWAYS paraphrase TN jargon (never stick on "abstract noun" / "passive form"). If they don't understand a term, explain it simply — never require linguistic or theological jargon.`,
		`Keep the whole reply short (≈150 words). Ask exactly ONE focused CANA probe about a specific source item — the sequence continues across turns. Never ask "How did you translate X?"; ask what the word they chose means in their language.`,
		`When the translator validates a note or question, append a hidden marker using the exact id: <!-- CHECK:note:<id> --> or <!-- CHECK:tq:<id> -->.`
	].join('\n');

	const user = [
		`PASSAGE: ${reference}`,
		`The translator is ready for check questions. Their receptor draft stays in their workspace — you do not have it and must not ask them to paste it.`,
		noteBlock ? `TRANSLATION NOTES (key challenges):\n${noteBlock}` : '',
		questionBlock ? `COMPREHENSION QUESTIONS (optional probes):\n${questionBlock}` : '',
		`Consult now. Acknowledge → ask what felt hard → ONE meaning-based CANA probe on a source item from the notes (more probes come on later turns).`
	]
		.filter(Boolean)
		.join('\n\n---\n\n');

	const response = await llm.generate([
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	]);
	return { response: stripCoachScaffoldLabels(response) };
}
