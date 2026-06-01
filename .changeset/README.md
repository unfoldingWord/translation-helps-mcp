# Changesets

This directory is managed by [Changesets](https://github.com/changesets/changesets).

## Workflow

1. Make your code changes.
2. Run `npm run changeset` to describe your change (major/minor/patch).
3. Commit the generated changeset file alongside your code.
4. When the PR is merged, the release PR is automatically opened by GitHub Actions.
5. Merging the release PR bumps versions, creates GitHub Releases, and publishes to npm/PyPI.
