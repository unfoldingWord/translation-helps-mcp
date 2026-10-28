# Chat

The study chat that used to be the `/chat` page of the Translation Helps website. It lives here as the seed of a separate product. It is **not built, tested, linted, or deployed** from this repository: the root `tsconfig.json`, `vitest.config.ts`, `eslint`, `prettier` and the `web/` SvelteKit app all leave `chat/` alone. The website's `/chat` route only answers a `308` redirect to `/try`.

## What it does

- Chat with OpenAI models through two agents: a **scholar** (looks up scripture, notes, words, questions and Academy articles with the Translation Helps tools) and a **checker** (checks a draft against the source).
- **Context quizzes** and **phrase drills** that teach the passage before translating.
- A **draft workspace** where the translator writes and revises a draft next to the sources.
- A **checking checklist** for the draft.
- A trace view (`web/src/routes/(system)/debug`) that shows the events of one chat turn.

## Layout

The files keep the paths they had in the website, under `chat/web/src/`:

- `routes/chat/` (page), `routes/api/chat/` and `routes/api/agent/` (streaming endpoints), `routes/api/languages/`, `routes/(system)/debug/`
- `lib/components/{chat,ui,debug}/`, `lib/stores/`
- `lib/server/{agents,skillChat.ts,traceEvents.ts,i18n.ts}`

Tests that import these files live in `chat/tests/unit/`. The tests of `src/core/harness/*` (quiz, coach, pacing, panel state and so on) stay in the root `tests/unit/`, because they test code in `src/`, which stays.

## Dependencies outside `chat/`

The moved code still imports these, so it only builds if they are available at the same paths as in the website:

- `src/core/harness/*`, and the other `$core/*` modules it uses (`$core` is `src/core`): `src/core/checklist`, `src/core/drafts`, `src/core/rag/providers`.
- `web/src/lib/renderMarkdown.ts` (and its `isomorphic-dompurify` setup in `web/vite.config.ts`).
- `web/src/lib/paths.ts` (`withBase`) and `web/src/lib/server/runTool.ts` (in-process tool calls).
- `@translation-helps/door43` (`packages/door43`).
- The Worker's `/v2/api/tool` endpoint, for tool calls that do not run in process.
- SvelteKit `$env/dynamic/private` for the OpenAI key.

To run the chat again, copy `chat/web/src/` back over `web/src/`, or build it as its own SvelteKit app that provides the aliases above.
