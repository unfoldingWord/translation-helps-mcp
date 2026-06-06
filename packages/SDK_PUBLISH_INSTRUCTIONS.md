# SDK Publish Instructions — v2

> For the full guide see [PUBLISHING_GUIDE.md](PUBLISHING_GUIDE.md).

## Quick Publish

### JavaScript SDK (npm)

```bash
cd packages/js-sdk
npm run build
npm publish --access public
```

### Python SDK (PyPI)

```bash
cd packages/python-sdk
pip install build twine
python -m build
python -m twine upload dist/*
```

## Required Tokens

- `NPM_TOKEN` — npm automation token (classic)
- `PYPI_TOKEN` — PyPI API token (`pypi-...`)

Set as GitHub secrets in Settings → Secrets → Actions.

## Version Management

Versions are managed by Changesets. Run `npm run changeset` to create a changeset,
then merge the auto-created Release PR to publish both SDKs simultaneously.
