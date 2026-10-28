import type { CallToolFn, HarnessEmit } from '$core/harness/ContextHarness.js';
import { formatDrillSystem } from '$core/harness/PassageAnnotator.js';
import type { LLMProvider } from '$core/rag/providers/LLMProvider.js';

export interface DrillChallenge {
	index: number;
	verse: string;
	phrase: string;
	noteText?: string;
	rawNoteText?: string;
	rawQuote?: string;
	category: string;
	sourceType?: 'tn' | 'tw';
	supportReference?: string;
	wordPath?: string;
	at?: string;
}

export interface ScholarDeps {
	callTool: CallToolFn;
	llm: LLMProvider;
}

function extractArticleText(result: unknown): string | null {
	if (!result || typeof result !== 'object') return null;
	const r = result as Record<string, unknown>;
	if (typeof r.article === 'string') return r.article;
	if (typeof r.content === 'string') return r.content;
	if (typeof r.text === 'string') return r.text;
	return null;
}

/**
 * Standalone phrase-drill runner — does NOT require ContextHarness instance.
 * Called by the /api/agent endpoint when action.type === 'drill_challenge'.
 * Also called by ContextHarness.handlePhraseDrill as a thin wrapper.
 */
export async function runPhraseDrill(
	challenge: DrillChallenge,
	language: string,
	deps: ScholarDeps,
	emit: Pick<HarnessEmit, 'status' | 'token'>
): Promise<{ response: string; citations: Array<{ path: string; title?: string }> }> {
	const { callTool, llm } = deps;

	emit.status('Fetching translation resources…');

	// Parallel-fetch TW article + TA principle
	const fetches: Array<Promise<unknown>> = [];
	const fetchLabels: string[] = [];

	if (challenge.wordPath) {
		const path = challenge.wordPath.startsWith('rc://')
			? challenge.wordPath.replace(/^rc:\/\/[^/]+\/tw\/dict\//, '')
			: challenge.wordPath;
		fetches.push(callTool('get_word_article', { path, language }).catch(() => null));
		fetchLabels.push('tw');
	}
	if (challenge.supportReference?.includes('ta/man')) {
		const taPath = challenge.supportReference
			.replace(/^rc:\/\/\*\/ta\/man\//, '')
			.replace(/^rc:\/\/[^/]+\/ta\/man\//, '');
		fetches.push(callTool('get_academy_article', { path: taPath, language }).catch(() => null));
		fetchLabels.push('ta');
	}

	const fetchResults = await Promise.allSettled(fetches);
	let twArticle = '';
	let taArticle = '';
	fetchResults.forEach((res, i) => {
		if (res.status !== 'fulfilled' || !res.value) return;
		const text = extractArticleText(res.value);
		if (fetchLabels[i] === 'tw') twArticle = text ?? '';
		else taArticle = text ?? '';
	});

	// Build context block
	const contextParts: string[] = [];
	contextParts.push(
		`PHRASE: "${challenge.phrase}" — verse ${challenge.verse}\nCATEGORY: ${challenge.category}`
	);
	if (challenge.rawNoteText) {
		const quoteLine = challenge.rawQuote
			? `\nOriginal-language quote: "${challenge.rawQuote}"`
			: '';
		contextParts.push(`TRANSLATION NOTE (verbatim):\n${challenge.rawNoteText}${quoteLine}`);
	} else if (challenge.noteText) {
		contextParts.push(`TRANSLATION NOTE SUMMARY:\n${challenge.noteText}`);
	}
	if (challenge.at) contextParts.push(`ALTERNATE TRANSLATION: "${challenge.at}"`);
	if (twArticle) contextParts.push(`TRANSLATION WORD DEFINITION:\n${twArticle.slice(0, 1200)}`);
	if (taArticle) contextParts.push(`TRANSLATION ACADEMY ARTICLE:\n${taArticle.slice(0, 1500)}`);

	emit.status('Generating explanation…');

	// Cast to Challenge shape expected by formatDrillSystem
	const challengeForFormat = {
		index: challenge.index,
		verse: challenge.verse,
		phrase: challenge.phrase,
		noteText: challenge.noteText ?? '',
		category: challenge.category as import('$core/harness/PassageAnnotator.js').ChallengeCategory,
		sourceType: challenge.sourceType as
			| import('$core/harness/PassageAnnotator.js').ChallengeSource
			| undefined,
		rawNoteText: challenge.rawNoteText,
		rawQuote: challenge.rawQuote,
		supportReference: challenge.supportReference,
		wordPath: challenge.wordPath,
		at: challenge.at
	};

	const systemPrompt = formatDrillSystem(
		challengeForFormat as import('$core/harness/PassageAnnotator.js').Challenge,
		language
	);
	const userMessage = contextParts.join('\n\n---\n\n');

	const responseText = await llm.generate([
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userMessage }
	]);

	const citations: Array<{ path: string; title?: string }> = [];
	if (challenge.wordPath) citations.push({ path: challenge.wordPath, title: challenge.phrase });
	if (challenge.supportReference) citations.push({ path: challenge.supportReference });

	return { response: responseText, citations };
}

/**
 * Explain a translation word (key term) — fetches article and generates a
 * plain-language explanation suitable for the workbench word panel.
 */
export async function runExplainWord(
	wordPath: string,
	term: string,
	language: string,
	deps: ScholarDeps,
	emit: Pick<HarnessEmit, 'status' | 'token'>
): Promise<{ response: string }> {
	const { callTool, llm } = deps;
	emit.status('Fetching word definition…');

	const path = wordPath.startsWith('rc://')
		? wordPath.replace(/^rc:\/\/[^/]+\/tw\/dict\//, '')
		: wordPath;
	const result = await callTool('get_word_article', { path, language }).catch(() => null);
	const article = extractArticleText(result);

	emit.status('Generating explanation…');
	const system = `You are a biblical translation scholar. Explain the term "${term}" concisely (80-120 words) for a translator. Focus on the biblical meaning, translation implications, and one example. Respond in ${language === 'en' ? 'English' : `the language with code "${language}"`}.`;
	const user = article
		? `TRANSLATION WORD ARTICLE:\n${article.slice(0, 1500)}`
		: `Explain the key biblical term: "${term}"`;

	const response = await llm.generate([
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	]);
	return { response };
}

/** Client-facing resource payload for scoped chat (mirrors studySession.ResourcePayload). */
export type ResourceChatPayload = {
	kind: 'challenge' | 'note' | 'word' | 'verse' | 'question' | 'article';
	challenge?: DrillChallenge;
	note?: {
		id: string;
		quote?: string;
		noteText: string;
		verse?: string;
		supportReference?: string;
	};
	word?: { term: string; path?: string; definition?: string; verse?: string; origWords?: string };
	verse?: { reference: string; text: string };
	question?: { id: string; question: string; response?: string; verse?: string };
	article?: { path: string; title?: string };
};

/** Scripture versions already loaded in the study UI (ULT / UST / original, etc.). */
export type ScriptureContext = {
	reference: string;
	versions: Array<{ label?: string; resourceType?: string; text: string }>;
};

function formatScriptureBlock(scripture: ScriptureContext | null | undefined): string {
	if (!scripture?.versions?.length) return '';
	const lines = scripture.versions
		.map((v) => {
			const label = v.label || v.resourceType || 'text';
			return `[${label}]\n${v.text}`;
		})
		.join('\n\n');
	return `PASSAGE (${scripture.reference}):\n${lines}`;
}

function taPathFromRef(supportRef: string): string {
	return supportRef.replace(/^rc:\/\/\*\/ta\/man\//, '').replace(/^rc:\/\/[^/]+\/ta\/man\//, '');
}

function twPathFromRef(wordPath: string): string {
	return wordPath.startsWith('rc://')
		? wordPath.replace(/^rc:\/\/[^/]+\/tw\/dict\//, '')
		: wordPath;
}

/** Fetch TW/TA articles; if the study language returns empty, retry with English. */
async function fetchLinkedArticles(
	wordPath: string | undefined,
	supportRef: string | undefined,
	language: string,
	callTool: CallToolFn
): Promise<{ twArticle: string; taArticle: string; taLanguage?: string }> {
	let twArticle = '';
	let taArticle = '';
	let taLanguage: string | undefined;

	if (wordPath) {
		const path = twPathFromRef(wordPath);
		const primary = await callTool('get_word_article', { path, language }).catch(() => null);
		twArticle = extractArticleText(primary) ?? '';
		if (!twArticle && language !== 'en') {
			const fallback = await callTool('get_word_article', { path, language: 'en' }).catch(
				() => null
			);
			twArticle = extractArticleText(fallback) ?? '';
		}
	}

	if (supportRef?.includes('ta/man') || supportRef?.includes('/ta/')) {
		const taPath = taPathFromRef(supportRef);
		const primary = await callTool('get_academy_article', { path: taPath, language }).catch(
			() => null
		);
		taArticle = extractArticleText(primary) ?? '';
		if (taArticle) {
			taLanguage = language;
		} else if (language !== 'en') {
			const fallback = await callTool('get_academy_article', {
				path: taPath,
				language: 'en'
			}).catch(() => null);
			taArticle = extractArticleText(fallback) ?? '';
			if (taArticle) taLanguage = 'en';
		}
	}

	return { twArticle, taArticle, taLanguage };
}

async function ensureScripture(
	scripture: ScriptureContext | null | undefined,
	language: string,
	callTool: CallToolFn
): Promise<ScriptureContext | null> {
	if (scripture?.versions?.length) return scripture;
	const reference = scripture?.reference?.trim();
	if (!reference) return scripture ?? null;
	try {
		const result = (await callTool('get_passage', { reference, language })) as {
			versions?: Array<{ resourceType?: string; role?: string; text?: string }>;
			reference?: string;
		} | null;
		const versions = (result?.versions ?? [])
			.filter((v) => typeof v.text === 'string' && v.text.length > 0)
			.map((v) => ({
				label: (v.resourceType ?? v.role ?? 'text').toUpperCase(),
				resourceType: v.resourceType,
				text: v.text as string
			}));
		if (versions.length === 0) return scripture ?? null;
		return { reference: result?.reference ?? reference, versions };
	} catch {
		return scripture ?? null;
	}
}

function buildResourceParts(
	resource: ResourceChatPayload,
	twArticle: string,
	taArticle: string
): string[] {
	const resourceParts: string[] = [];
	switch (resource.kind) {
		case 'challenge': {
			const c = resource.challenge;
			if (c) {
				resourceParts.push(
					`CHALLENGE #${c.index}: "${c.phrase}" — verse ${c.verse}\nCATEGORY: ${c.category}`
				);
				if (c.rawNoteText) {
					const quoteLine = c.rawQuote ? `\nOriginal-language quote: "${c.rawQuote}"` : '';
					resourceParts.push(`TRANSLATION NOTE (verbatim):\n${c.rawNoteText}${quoteLine}`);
				} else if (c.noteText) {
					resourceParts.push(`TRANSLATION NOTE:\n${c.noteText}`);
				}
				if (c.at) resourceParts.push(`ALTERNATE TRANSLATION: "${c.at}"`);
			}
			break;
		}
		case 'note': {
			const n = resource.note;
			if (n) {
				if (n.quote) resourceParts.push(`QUOTE: "${n.quote}"`);
				resourceParts.push(`TRANSLATION NOTE:\n${n.noteText}`);
				if (n.verse) resourceParts.push(`VERSE: ${n.verse}`);
			}
			break;
		}
		case 'word': {
			const w = resource.word;
			if (w) {
				resourceParts.push(`KEY TERM: ${w.term}`);
				if (w.origWords) resourceParts.push(`ORIGINAL-LANGUAGE WORDS: ${w.origWords}`);
				if (w.definition) resourceParts.push(`DEFINITION:\n${w.definition.slice(0, 1200)}`);
				if (w.verse) resourceParts.push(`VERSE: ${w.verse}`);
			}
			break;
		}
		case 'verse': {
			const v = resource.verse;
			if (v) {
				resourceParts.push(`REFERENCE: ${v.reference}`);
				resourceParts.push(`TEXT:\n${v.text}`);
			}
			break;
		}
		case 'question': {
			const q = resource.question;
			if (q) {
				resourceParts.push(`TRANSLATION QUESTION:\n${q.question}`);
				if (q.response) resourceParts.push(`EXPECTED RESPONSE:\n${q.response}`);
				if (q.verse) resourceParts.push(`VERSE: ${q.verse}`);
			}
			break;
		}
		case 'article': {
			const a = resource.article;
			if (a) {
				resourceParts.push(`TRANSLATION ACADEMY CONCEPT: ${a.title || a.path}\nPATH: ${a.path}`);
			}
			break;
		}
	}

	if (twArticle) resourceParts.push(`TRANSLATION WORD ARTICLE:\n${twArticle.slice(0, 1200)}`);
	if (taArticle) resourceParts.push(`TRANSLATION ACADEMY ARTICLE:\n${taArticle.slice(0, 1500)}`);
	return resourceParts;
}

function explainTaskForKind(kind: ResourceChatPayload['kind']): string {
	switch (kind) {
		case 'note':
			return (
				'Explain this translation note for a translator working on this passage. ' +
				'Ground your answer in the scripture text (literal, simplified, and original where provided). ' +
				'Use the Translation Academy article when present — quote its strategies faithfully. ' +
				'Show how the note applies to the quoted phrase in this verse and suggest concrete translation options.'
			);
		case 'word':
			return (
				'Explain this key biblical term as it is used in this specific verse. ' +
				'Ground your answer in the scripture text and the Translation Word article. ' +
				'Focus on meaning in context and practical translation implications.'
			);
		case 'challenge':
			return (
				'Explain this translation challenge for the selected phrase. ' +
				'Use the scripture text, the translation note, and any linked Translation Academy / Translation Word articles. ' +
				'Be practical and focused on how to render the phrase accurately.'
			);
		case 'question':
			return (
				'Help the translator think through this comprehension question for the passage. ' +
				'Ground your answer in the scripture text. Do not simply reveal the expected response — guide understanding.'
			);
		case 'verse':
			return (
				'Explain this verse for a translator. Ground your answer in the provided scripture versions ' +
				'and highlight translation-relevant issues.'
			);
		case 'article':
			return (
				'Teach this Translation Academy concept and show how to apply it to the current passage. ' +
				'Ground your answer in the fetched Translation Academy article — do not invent content from memory. ' +
				'If the article was only available in English, translate the explanation into the study language. ' +
				'Give concrete translation strategies the translator can use.'
			);
		default:
			return 'Explain the selected resource for a Bible translator, grounded in the scripture context.';
	}
}

/**
 * Initial Scholar explanation when the user clicks a resource in the side panel.
 * Grounds the answer in scripture versions + linked TA/TW articles.
 */
export type ExplainedArticle = {
	path: string;
	title?: string;
	markdown: string;
	language?: string;
};

export async function runExplainResource(
	resource: ResourceChatPayload,
	scripture: ScriptureContext | null | undefined,
	language: string,
	deps: ScholarDeps,
	emit: Pick<HarnessEmit, 'status' | 'token'>
): Promise<{
	response: string;
	citations: Array<{ path: string; title?: string }>;
	article?: ExplainedArticle;
}> {
	const { callTool, llm } = deps;

	emit.status('Gathering scripture and linked articles…');

	const resolvedScripture = await ensureScripture(scripture, language, callTool);

	const wordPath =
		resource.kind === 'challenge'
			? resource.challenge?.wordPath
			: resource.kind === 'word'
				? resource.word?.path
				: undefined;

	const supportRef =
		resource.kind === 'challenge'
			? resource.challenge?.supportReference
			: resource.kind === 'note'
				? resource.note?.supportReference
				: resource.kind === 'article'
					? resource.article?.path
					: undefined;

	const { twArticle, taArticle, taLanguage } = await fetchLinkedArticles(
		wordPath,
		supportRef,
		language,
		callTool
	);

	const scriptureBlock = formatScriptureBlock(resolvedScripture);
	const resourceParts = buildResourceParts(resource, twArticle, taArticle);
	const langLabel = language === 'en' ? 'English' : `the language with code "${language}"`;

	const systemPrompt = [
		`You are a biblical translation scholar (Scholar agent).`,
		explainTaskForKind(resource.kind),
		`Be concise (2–4 short paragraphs), practical, and cite which resource you are using (TN, TW, TA, ULT/UST).`,
		`Respond in ${langLabel}. Do not use markdown headers.`,
		'',
		scriptureBlock || 'PASSAGE: (not available)',
		'',
		'SELECTED RESOURCE:',
		resourceParts.join('\n\n') || '(no resource detail)'
	].join('\n');

	emit.status('Generating explanation…');
	const response = await llm.generate([
		{ role: 'system', content: systemPrompt },
		{
			role: 'user',
			content: 'Please explain this resource in the context of the passage above.'
		}
	]);

	const citations: Array<{ path: string; title?: string }> = [];
	if (wordPath) {
		citations.push({
			path: wordPath,
			title: resource.kind === 'word' ? resource.word?.term : resource.challenge?.phrase
		});
	}
	if (supportRef) {
		citations.push({
			path: supportRef,
			title: resource.kind === 'article' ? resource.article?.title : undefined
		});
	}

	let article: ExplainedArticle | undefined;
	if (resource.kind === 'article' && taArticle && supportRef) {
		article = {
			path: taPathFromRef(supportRef),
			title: resource.article?.title,
			markdown: taArticle,
			language: taLanguage
		};
	}

	return { response, citations, article };
}

/**
 * Answer a follow-up question about a selected resource, with prior thread
 * history and a compact global study context injected into the system prompt.
 */
export async function runResourceChat(
	resource: ResourceChatPayload,
	question: string,
	thread: Array<{ role: 'user' | 'assistant'; content: string }>,
	globalContext: string,
	language: string,
	deps: ScholarDeps,
	emit: Pick<HarnessEmit, 'status' | 'token'>,
	scripture?: ScriptureContext | null
): Promise<{ response: string }> {
	const { callTool, llm } = deps;

	emit.status('Gathering resource context…');

	const resolvedScripture = await ensureScripture(scripture, language, callTool);

	const wordPath =
		resource.kind === 'challenge'
			? resource.challenge?.wordPath
			: resource.kind === 'word'
				? resource.word?.path
				: undefined;

	const supportRef =
		resource.kind === 'challenge'
			? resource.challenge?.supportReference
			: resource.kind === 'note'
				? resource.note?.supportReference
				: resource.kind === 'article'
					? resource.article?.path
					: undefined;

	const { twArticle, taArticle } = await fetchLinkedArticles(
		wordPath,
		supportRef,
		language,
		callTool
	);

	const scriptureBlock = formatScriptureBlock(resolvedScripture);
	const resourceParts = buildResourceParts(resource, twArticle, taArticle);

	const langLabel = language === 'en' ? 'English' : `the language with code "${language}"`;
	const systemPrompt = [
		`You are a biblical translation scholar (Scholar agent). Answer the translator's follow-up question about the selected resource.`,
		`Be concise, practical, and focused on translation implications. Respond in ${langLabel}.`,
		'',
		scriptureBlock || 'PASSAGE: (not available)',
		'',
		'SELECTED RESOURCE:',
		resourceParts.join('\n\n') || '(no resource detail)',
		'',
		'STUDY CONTEXT (wider conversation / passage):',
		globalContext || '(none)'
	].join('\n');

	// Prior thread excluding the current question if it was already appended client-side
	const prior = thread.filter((m) => !(m.role === 'user' && m.content === question));
	const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
		{ role: 'system', content: systemPrompt },
		...prior.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
		{ role: 'user', content: question }
	];

	emit.status('Generating answer…');
	const response = await llm.generate(messages);
	return { response };
}
