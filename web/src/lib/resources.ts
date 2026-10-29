/**
 * The unfoldingWord resources the server serves, in the order a translator meets them.
 * Plain TypeScript: the tests import it, and so do the home page and /docs/resources.
 * Every `door43` repository was checked to exist on 2026-10-28.
 */
export type ResourceId = 'ult' | 'ust' | 'tn' | 'tw' | 'twl' | 'tq' | 'ta' | 'obs';

export type Resource = {
	id: ResourceId;
	/** The short name translators use (ULT, UST, …). */
	short: string;
	name: string;
	summary: string;
	forWhom: string;
	/** The tool that returns it. */
	tool: string;
	door43: string;
};

const repo = (id: ResourceId) => `https://git.door43.org/unfoldingWord/en_${id}`;

export const RESOURCES: Resource[] = [
	{
		id: 'ult',
		short: 'ULT',
		name: 'unfoldingWord Literal Text',
		summary: 'An English Bible that stays close to the Hebrew and Greek word order and wording.',
		forWhom: 'Translators who need to see what the original says, form by form.',
		tool: 'get_passage',
		door43: repo('ult')
	},
	{
		id: 'ust',
		short: 'UST',
		name: 'unfoldingWord Simplified Text',
		summary: 'An English Bible that says the meaning plainly, with implied ideas made explicit.',
		forWhom: 'Translators who want the meaning of a verse in clear, natural words.',
		tool: 'get_passage',
		door43: repo('ust')
	},
	{
		id: 'tn',
		short: 'TN',
		name: 'Translation Notes',
		summary: 'Verse-by-verse notes on hard phrases, each tied to the words it explains.',
		forWhom: 'Translators and checkers working through a passage.',
		tool: 'get_note',
		door43: repo('tn')
	},
	{
		id: 'tw',
		short: 'TW',
		name: 'Translation Words',
		summary: 'Articles on key biblical terms: what each one means and how to translate it.',
		forWhom: 'Anyone deciding how to render a term like “love” or “covenant”.',
		tool: 'get_word_article',
		door43: repo('tw')
	},
	{
		id: 'twl',
		short: 'TWL',
		name: 'Translation Words Links',
		summary: 'Where each key term occurs in the text, linked to its Translation Words article.',
		forWhom: 'Translators who want every key term in a passage at a glance.',
		tool: 'get_passage_index',
		door43: repo('twl')
	},
	{
		id: 'tq',
		short: 'TQ',
		name: 'Translation Questions',
		summary: 'Questions with answers that check a draft says what the passage says.',
		forWhom: 'Checkers and community members testing a translation.',
		tool: 'get_questions',
		door43: repo('tq')
	},
	{
		id: 'ta',
		short: 'TA',
		name: 'Translation Academy',
		summary: 'Short lessons on how to translate: figures of speech, grammar, culture, checking.',
		forWhom: 'Translators learning the craft, and notes that point to a lesson.',
		tool: 'get_academy_article',
		door43: repo('ta')
	},
	{
		id: 'obs',
		short: 'OBS',
		name: 'Open Bible Stories',
		summary:
			'Fifty Bible stories, from Creation to Jesus’ return, with their own notes and questions.',
		forWhom: 'Teams starting with stories before, or alongside, the full Bible.',
		tool: 'get_obs_story',
		door43: repo('obs')
	}
];

/** The licence of every unfoldingWord resource. */
export const LICENCE = {
	name: 'CC BY-SA 4.0',
	href: 'https://creativecommons.org/licenses/by-sa/4.0/'
} as const;
