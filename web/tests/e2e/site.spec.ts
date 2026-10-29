import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// These tests drive the built site against local Workers (see playwright.config.ts). The
// Workers call the real Door43, so the first calls can take seconds: waits are generous, and
// no assertion is loosened to hide a slow or failing server.
//
// Paths are relative to the base URL (".../v2/"): "try", "docs/limits", and "" for the home page.

const SLOW = 60_000;

/** Open the Try page and wait until the page has connected to the server. */
async function openTry(page: Page, hash = '') {
	await page.goto(`try${hash}`);
	await expect(page.getByText(/Connected · \d+ tools/)).toBeVisible({ timeout: SLOW });
}

/** The answer area of a walk or of the Tools tab. */
const result = (page: Page) => page.locator('[data-result]');

/** The line over the answer: "<tool> · <size> · <ms>", shown once the server has answered. */
const answered = (page: Page, tool: string) =>
	expect(result(page).getByText(new RegExp(`${tool} · [\\d.]+ KB · \\d+ ms`))).toBeVisible({
		timeout: SLOW
	});

const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });

test('guided walk on John 3:16 reaches every step', async ({ page }) => {
	await openTry(page);
	const steps = page.getByRole('list', { name: 'Steps' });
	const current = steps.locator('[aria-current="step"]');

	// Pick a passage: the first step has no call; John 3:16 is the default passage.
	await expect(current).toContainText('Pick a passage');
	await expect(result(page).getByText('Now showing:')).toContainText('John 3:16');

	await next(page).click();
	await expect(current).toContainText('Text');
	await answered(page, 'get_passage');

	await next(page).click();
	await expect(current).toContainText('Context');
	await answered(page, 'get_passage_context');

	await next(page).click();
	await expect(current).toContainText('Map of helps');
	await answered(page, 'get_passage_index');

	// The map: at least one note button; pressing it opens that note on the Go deeper step.
	const notes = result(page)
		.locator('p', { hasText: /^Notes \(\d+\)$/ })
		.locator('xpath=following-sibling::ul[1]//button');
	await expect(notes.first()).toBeVisible();
	expect(await notes.count()).toBeGreaterThanOrEqual(1);
	await notes.first().click();
	await expect(current).toContainText('Go deeper');
	await expect(result(page).getByText(/^Note:/)).toBeVisible();
	await answered(page, 'get_note');

	await next(page).click();
	await expect(current).toContainText('Check');
	await answered(page, 'get_questions');
	// The last step has nothing after it.
	await expect(next(page)).toBeDisabled();
});

test('a language without ULT shows the not-available answer and continues', async ({ page }) => {
	await openTry(page);
	const lang = page.locator('#g-lang');
	// The picker lists the languages the server knows, es-419 among them.
	await expect(lang.locator('option[value="es-419"]')).toHaveCount(1, { timeout: SLOW });
	await lang.selectOption('es-419');
	await page.getByRole('button', { name: 'Show', exact: true }).click();

	await expect(lang).toHaveValue('es-419');
	const steps = page.getByRole('list', { name: 'Steps' });
	await expect(steps.locator('[aria-current="step"]')).toContainText('Text');
	// An answer, not a failure: the callout says what is missing, and there is no retry button.
	const notice = result(page).getByRole('note');
	await expect(notice).toBeVisible({ timeout: SLOW });
	await expect(notice).toContainText('es-419');
	await expect(result(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);

	// The walk continues with the next step.
	await next(page).click();
	await expect(steps.locator('[aria-current="step"]')).toContainText('Context');
	// The server answers the context step for es-419 (it lists what exists, 0 notes): wait for
	// that answer first, then check that nothing failed.
	await answered(page, 'get_passage_context');
	await expect(result(page).getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('a tool runs from the Tools tab', async ({ page }) => {
	await openTry(page);
	await page.getByRole('tab', { name: 'Tools' }).click();

	// Pick the tool in the list, then run its ready example.
	await page.getByRole('button', { name: 'list_languages', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'list_languages' })).toBeVisible();
	await page.getByRole('button', { name: 'All languages', exact: true }).click();
	await answered(page, 'list_languages');
	await expect(
		result(page)
			.getByText(/English/)
			.first()
	).toBeVisible();
});

test('a broken shared link opens the guided tab', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const tab = (name: string) => page.getByRole('tab', { name, exact: true });

	// A valid link opens the tab it names, so the hash is read at all.
	const tools = Buffer.from(JSON.stringify({ tab: 'tools' })).toString('base64url');
	await openTry(page, `#${tools}`);
	await expect(tab('Tools')).toHaveAttribute('aria-selected', 'true');
	await expect(tab('Guided walk')).toHaveAttribute('aria-selected', 'false');

	// A broken one falls back to the guided walk.
	await page.goto('about:blank');
	await openTry(page, '#not-a-state');
	await expect(tab('Guided walk')).toHaveAttribute('aria-selected', 'true');
	await expect(tab('Tools')).toHaveAttribute('aria-selected', 'false');
	await expect(page.getByRole('list', { name: 'Steps' })).toBeVisible();
	expect(errors).toEqual([]);
});

test('the home page calls the MCP server only when a part is chosen', async ({ page }) => {
	const calls: { method?: string; tool?: string }[] = [];
	page.on('request', (req) => {
		if (!/\/mcp\/?$/.test(new URL(req.url()).pathname)) return;
		let body: { method?: string; params?: { name?: string } } = {};
		try {
			body = JSON.parse(req.postData() ?? '{}');
		} catch {
			// Not JSON-RPC: still a request to /mcp, so it is counted.
		}
		calls.push(
			body.params?.name ? { method: body.method, tool: body.params.name } : { method: body.method }
		);
	});

	await page.goto('');
	await page.waitForLoadState('networkidle');
	await expect(page.getByText(/Saved answer ·/)).toBeVisible();
	await expect(page.getByText('Translation note', { exact: true })).toBeVisible();
	expect(calls).toEqual([]);

	await page.getByRole('button', { name: /Key terms/ }).click();
	await expect(page.getByText(/Live from the server/)).toBeVisible({ timeout: SLOW });
	expect(calls).toEqual([
		{ method: 'initialize' },
		{ method: 'notifications/initialized' },
		{ method: 'tools/call', tool: 'get_word_article' }
	]);
});

test('the home hero shows one note at a time, and rotates unless paused', async ({ page }) => {
	// Run from web/ (npm run test:e2e): the saved answers the hero shows.
	const hero = JSON.parse(readFileSync('src/lib/home/snapshot.json', 'utf8')).hero as {
		notes: { aligned: string }[];
	};
	const figure = page.locator('figure').filter({ has: page.getByText('Translation note') });
	const dots = figure.getByRole('group', { name: 'Notes on this verse' }).getByRole('button');
	const marked = figure.locator('mark[data-mark="translation"]');
	const note = figure.locator('[data-slide="current"]');
	const pressed = async () => {
		for (let i = 0; i < (await dots.count()); i++)
			if ((await dots.nth(i).getAttribute('aria-pressed')) === 'true') return i;
		return -1;
	};

	await page.goto('');
	await expect(dots).toHaveCount(hero.notes.length);
	await expect(dots.first()).toHaveAttribute('aria-pressed', 'true');
	await expect(marked).toHaveText(hero.notes[0].aligned);
	await expect(note).toContainText(hero.notes[0].aligned);
	await expect(figure.getByRole('list', { name: /What the server returns/ })).toContainText(
		/\d+ notes\s*·\s*\d+ key terms?\s*·\s*\d+ questions?\s*·\s*\d+ Academy topics?/
	);

	// Left alone, it moves to the next note: the marked phrase and the note change together.
	await expect(dots.nth(1)).toHaveAttribute('aria-pressed', 'true', { timeout: 12_000 });
	await expect(marked).toHaveText(hero.notes[1].aligned);
	await expect(note).toContainText(hero.notes[1].aligned);

	// A dot shows its note. Under the pointer, it stays there.
	await dots.nth(3).click();
	await expect(marked).toHaveText(hero.notes[3].aligned);
	await page.waitForTimeout(9_000);
	expect(await pressed()).toBe(3);

	// With reduced motion it does not move on its own.
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('');
	await page.mouse.move(0, 0);
	await expect(dots.first()).toHaveAttribute('aria-pressed', 'true');
	await page.waitForTimeout(9_000);
	expect(await pressed()).toBe(0);
});

test('/chat, /playground and /rag redirect to /try', async ({ page, request }) => {
	for (const old of ['chat', 'playground', 'rag']) {
		const res = await request.get(old, { maxRedirects: 0 });
		expect(res.status(), old).toBe(308);
		expect(res.headers()['location'], old).toMatch(/\/v2\/try$/);

		await page.goto(old);
		await expect(page).toHaveURL(/\/v2\/try$/);
		await expect(page.getByRole('heading', { name: 'Try it' })).toBeVisible();
	}
});

test('the old doc pages redirect to their new places', async ({ page, request }) => {
	for (const [old, to, heading] of [
		['docs/library', /\/v2\/docs\/sdks$/, 'SDKs'],
		['docs/mcp', /\/v2\/connect$/, 'Connect your assistant']
	] as const) {
		const res = await request.get(old, { maxRedirects: 0 });
		expect(res.status(), old).toBe(308);
		expect(res.headers()['location'], old).toMatch(to);

		await page.goto(old);
		await expect(page).toHaveURL(to);
		await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
	}
});

test('the OBS walk shows story 1', async ({ page }) => {
	await openTry(page);
	await page.getByRole('tab', { name: 'OBS', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Story', exact: true })).toBeVisible();
	await expect(page.locator('#o-story')).toHaveValue('1');
	await answered(page, 'get_obs_story');
	// The server's title for story 1 joins the line once the story has answered.
	await expect(result(page).getByText(/Story 1\s*·\s*\S/)).toBeVisible();

	// The Rendered view reads as a story: frame text, not JSON.
	await expect(result(page).getByText(/This is how God made everything/)).toBeVisible();
	await expect(result(page).getByText('"frames"')).toHaveCount(0);
	await expect(result(page).getByRole('link', { name: 'unfoldingWord® OBS' })).toHaveAttribute(
		'href',
		'https://git.door43.org/unfoldingWord/en_obs'
	);

	await next(page).click();
	await expect(page.getByRole('heading', { name: 'Translation notes' })).toBeVisible();
	await answered(page, 'get_obs_notes');
});

test('a link inside a word article opens the linked article', async ({ page }) => {
	const love = Buffer.from(
		JSON.stringify({
			tab: 'guided',
			lang: 'en',
			ref: 'John 3:16',
			step: 'deeper',
			open: { kind: 'word', key: 'bible/kt/love' }
		})
	).toString('base64url');
	await openTry(page, `#${love}`);
	await answered(page, 'get_word_article');
	// The source line credits Translation Words and links the licence.
	await expect(result(page).getByRole('link', { name: 'unfoldingWord® TW' })).toHaveAttribute(
		'href',
		'https://git.door43.org/unfoldingWord/en_tw'
	);
	await expect(result(page).getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute(
		'href',
		'https://creativecommons.org/licenses/by-sa/4.0/'
	);
	// "See also: covenant" is ../kt/covenant.md in the article: it opens that word article.
	await result(page).getByRole('button', { name: 'covenant', exact: true }).click();
	await expect(result(page).getByText('Key term: bible/kt/covenant')).toBeVisible();
	await expect(result(page).getByRole('heading', { name: 'covenant', exact: true })).toBeVisible({
		timeout: SLOW
	});
	// No link inside Door43 content is a dead "#" link.
	await expect(result(page).locator('a[href="#"]')).toHaveCount(0);
});

test('the Check step reads as questions and answers', async ({ page }) => {
	const check = Buffer.from(
		JSON.stringify({ tab: 'guided', lang: 'en', ref: 'John 3:16', step: 'check' })
	).toString('base64url');
	await openTry(page, `#${check}`);
	await answered(page, 'get_questions');
	await expect(result(page).locator('.prose strong').first()).toContainText('?');
	await expect(result(page).getByText('"questions"')).toHaveCount(0);
});

/**
 * Elements that stick out of the right edge of a phone screen. `body` hides horizontal overflow
 * (overflow-x: hidden), so scrollWidth alone cannot show it. Elements inside a box that scrolls
 * on its own (a code block, a table wrapper) and visually hidden ones are not counted.
 */
async function wideElements(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const vw = window.innerWidth;
		const found: string[] = [];
		for (const el of Array.from(document.body.querySelectorAll('*'))) {
			const r = el.getBoundingClientRect();
			if (r.right <= vw + 1) continue;
			// Visually hidden: no size, 1px (sr-only), or not rendered.
			if (r.width <= 1 || r.height <= 1) continue;
			const own = getComputedStyle(el);
			if (own.visibility === 'hidden' || own.display === 'none') continue;
			let scrolls = false;
			for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
				const ox = getComputedStyle(a).overflowX;
				if (ox === 'auto' || ox === 'scroll') {
					scrolls = true;
					break;
				}
			}
			if (scrolls) continue;
			const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
			found.push(
				`<${el.tagName.toLowerCase()} class="${cls}"> right=${Math.round(r.right)} "${(el.textContent ?? '').trim().slice(0, 40)}"`
			);
		}
		return found.slice(0, 8);
	});
}

const PHONE_PAGES = [
	'',
	'try',
	'connect',
	'tools',
	'docs',
	'docs/resources',
	'docs/workflow',
	'docs/api',
	'docs/sdks',
	'docs/languages',
	'docs/limits',
	'status',
	'metrics'
];

test('no horizontal scroll at phone width', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 800 });
	for (const path of PHONE_PAGES) {
		await page.goto(path);
		await page.waitForLoadState('load');
		if (path === 'try') {
			await expect(page.getByText(/Connected · \d+ tools/)).toBeVisible({ timeout: SLOW });
		}
		// Let the page fetch what it shows (status, metrics, language lists) before measuring.
		await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
		const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		expect(scrollWidth, `${path || 'home'}: page scroll width`).toBeLessThanOrEqual(375);
		expect(await wideElements(page), `${path || 'home'}: elements wider than the screen`).toEqual(
			[]
		);
	}
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('on a phone, choosing a guided step brings its result into view', async ({ page }) => {
		await openTry(page);
		// On a phone the step list is a select above the answer.
		await expect(page.locator('#g-step')).toBeVisible();
		await page.locator('#g-step').selectOption('context');
		await answered(page, 'get_passage_context');
		// The page scrolls to the answer (smoothly), which then sits near the top of the screen.
		await expect
			.poll(async () => (await result(page).boundingBox())?.y ?? -1, { timeout: 10_000 })
			.toBeLessThan(844 / 2);
		expect((await result(page).boundingBox())!.y).toBeGreaterThanOrEqual(0);
		await expect(result(page).getByRole('heading', { name: 'Context' })).toBeInViewport();
	});
});
