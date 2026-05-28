Milestones & Branch Plan — Translation-Helps Rewrite

Purpose
A concise reference for implementing the rewrite: milestones, branch strategy, commits, PRs, release flow, and quick git commands.

Milestones (small, testable deliveries)

- Milestone 1 — Scaffolding (proof of concept)
  - Deliverables: `RagService` dev scaffold (in-memory index), `rag_query` MCP tool stub, `feature/rewrite-rag-scaffold` PR
  - Exit criteria: unit tests for `rag_query` contract, docs updated

- Milestone 2 — Indexing & Storage
  - Deliverables: indexer worker, chunking/parsing, embedding pipeline, vector DB adapter
  - Exit criteria: end-to-end index of 1 sample project and vector queries returning results

- Milestone 3 — Retrieval & Skill
  - Deliverables: RAG retrieval handler (filters + ANN + rerank), Skill primitives, bundle assembly with provenance
  - Exit criteria: `skill/compose_help` endpoint returns generated response with citations for sample passage

- Milestone 4 — Caching & Deployment
  - Deliverables: bundle caching and warmers, cache invalidation, staging deployment (hybrid), feature-flag rollout
  - Exit criteria: P95 latency target met in staging for warmed bundles

- Milestone 5 — QA & Cutover
  - Deliverables: regression tests, grounding QA, monitoring dashboards, cutover checklist
  - Exit criteria: verified grounding precision and safe rollback plan

Branching strategy

- Branches
  - `main` = production-stable
  - `develop` = integration (optional)
  - Feature branches: `feature/<area>-<short>` (e.g., `feature/rag-scaffold`, `feature/indexer-usfm`)
  - Hotfixes: `hotfix/<issue>`
  - Release branches: `release/vX.Y.Z` (optional)

- Rules
  - One feature per branch. Keep PRs <500 changed lines when possible.
  - Rebase onto `develop`/`main` before merging to keep history linear.

Commit conventions

- Use conventional commits to enable clear changelogs:
  - `feat(<scope>): description` — new feature
  - `fix(<scope>): description` — bug fix
  - `docs(<scope>): description` — docs only
  - `test(<scope>): description` — tests
  - `chore(<scope>): description` — infra

- Examples:
  - `feat(rag): add rag_query MCP tool (dev stub)`
  - `feat(skill): implement fetchPassageWithNotes bundle assembly`

Pull request workflow

- PR checklist (required in description):
  - What changed and why
  - Link to relevant docs in `docs/rewrite-plan/`
  - Tests added/updated and how to run them
  - How to validate locally (short steps)
  - Impact on existing MCP behavior and migration notes

- Review rules:
  - At least one reviewer, prefer an architect for major changes
  - Approve only when tests pass and contract checks succeed
  - Squash merge or maintain linear history per repo policy

CI / validation

- Each PR must run:
  - Linting (`npm run lint`)
  - Unit tests (`npm test`)
  - Contract/schema validation tests for `rag_query` and `get_bundle`
- Optional: run lightweight integration using `RagServiceDev` and sample dataset in CI matrix

Release & cutover

- Use feature flags for progressive rollout:
  - `feature.rag.enabled` toggles new RAG skill endpoints
  - Start with internal clients, then beta users, then public
- Cutover PR must include:
  - Backfill/warm scripts executed in staging
  - Monitoring dashboard links
  - Rollback steps and old-MCP route fallback

Hotfix & rollback

- For critical issues on `main`, create `hotfix/<desc>` branch, run tests, create PR, and merge to `main`, then cherry-pick/merge to `develop`.
- Rollback: revert the cutover PR or flip feature flag to route to old MCP.

Quick Git commands

Create feature branch:

```bash
git checkout -b feature/rag-scaffold
# make changes
git add .
git commit -m "feat(rag): scaffold RagService (dev)"
git push -u origin feature/rag-scaffold
```

Rebase onto main (before merging):

```bash
git fetch origin
git checkout feature/rag-scaffold
git rebase origin/main
# resolve conflicts, then
git push --force-with-lease
```

Create PR (GitHub CLI):

```bash
gh pr create --title "feat(rag): scaffold RagService" --body "See docs/rewrite-plan/MILESTONES_BRANCH_PLAN.md for context" --base develop
```

PR Template (suggestion)

- Summary: One-line summary
- Related docs: link to `docs/rewrite-plan/<file>`
- Testing: how to run unit/integration tests locally
- Migration impact: yes/no (describe)
- Rollout plan: feature flags, dependencies

PR Review checklist

- [ ] Tests pass
- [ ] Contract/schema validation passed
- [ ] Docs updated if API changes
- [ ] No sensitive keys or credentials

Next steps

1. Create branch `feature/rewrite-rag-scaffold` and commit the doc and minimal stubs.
2. Open PR and request architecture review.
3. After PR merge, start `feature/rewrite-indexer` and follow milestone 2.

Notes

- Keep PRs scoped to a single milestone when possible so reviews focus on small changes.
- Maintain `docs/rewrite-plan/` as the authoritative source; point PRs to specific doc sections for architecture decisions.

Generated: 2026-05-26
