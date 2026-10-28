import type { Call } from './guided';

export type ObsStepId = 'story' | 'notes' | 'questions';

/** The three OBS tools, in the order a translator uses them: read the story, then its helps. */
export const OBS_STEPS: { id: ObsStepId; title: string; tool: string }[] = [
	{ id: 'story', title: 'Story', tool: 'get_obs_story' },
	{ id: 'notes', title: 'Translation notes', tool: 'get_obs_notes' },
	{ id: 'questions', title: 'Check questions', tool: 'get_obs_questions' }
];

/** Open Bible Stories has fifty stories. */
export const OBS_STORIES = 50;

/**
 * The call a step makes. All three tools take the same `reference`: "5" is the whole of
 * story 5 and "5:3" is its third frame.
 */
export function obsCall(step: ObsStepId, lang: string, story: number, frame?: number): Call {
	const tool = OBS_STEPS.find((s) => s.id === step)!.tool;
	const hasFrame = typeof frame === 'number' && Number.isInteger(frame) && frame >= 1;
	return { tool, args: { reference: hasFrame ? `${story}:${frame}` : `${story}`, language: lang } };
}
