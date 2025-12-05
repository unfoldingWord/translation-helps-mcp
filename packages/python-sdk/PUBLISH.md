# Publishing to PyPI

This guide explains how to publish the Translation Helps MCP Python SDK to PyPI.

## Prerequisites

1. **PyPI Account**: Create an account at https://pypi.org/account/register/
2. **TestPyPI Account** (optional, for testing): https://test.pypi.org/account/register/
3. **API Token**: Generate an API token at https://pypi.org/manage/account/token/
4. **Configure Token**: See [SETUP_PYPI_TOKEN.md](./SETUP_PYPI_TOKEN.md) to set up automatic authentication

## Pre-Publication Checklist

- [x] Package name is available on PyPI
- [x] Version number is set correctly in `pyproject.toml`
- [x] README.md is complete and accurate
- [x] LICENSE file is included
- [x] All dependencies are specified in `pyproject.toml`
- [x] Package structure is correct
- [x] Tests pass (run `python test_sdk_comprehensive.py`)

## Building the Package

1. **Install build tools:**

   ```bash
   py -m pip install build twine
   ```

2. **Clean previous builds:**

   ```bash
   rm -rf dist/ build/ *.egg-info
   ```

3. **Build the package:**

   ```bash
   py -m build
   ```

   This creates:
   - `dist/translation-helps-mcp-client-1.0.0.tar.gz` (source distribution)
   - `dist/translation_helps_mcp_client-1.0.0-py3-none-any.whl` (wheel)

## Testing the Build

1. **Check the package:**

   ```bash
   py -m twine check dist/*
   ```

2. **Test install locally:**

   ```bash
   py -m pip install dist/translation_helps_mcp_client-1.0.0-py3-none-any.whl
   py -c "from translation_helps import TranslationHelpsClient; print('✅ Package works!')"
   ```

3. **Test on TestPyPI (recommended):**

   ```bash
   py -m twine upload --repository testpypi dist/*
   ```

   Then test install:

   ```bash
   py -m pip install --index-url https://test.pypi.org/simple/ translation-helps-mcp-client
   ```

## Publishing to PyPI

1. **Configure PyPI Token (One-Time Setup):**

   See [SETUP_PYPI_TOKEN.md](./SETUP_PYPI_TOKEN.md) for detailed instructions on setting up your token so you don't have to enter it every time.

   **Quick setup:**

   ```bash
   # Create ~/.pypirc with your token
   cat > ~/.pypirc << 'EOF'
   [pypi]
   username = __token__
   password = pypi-YourActualTokenHere
   EOF
   ```

2. **Upload to PyPI:**

   ```bash
   py -m twine upload dist/*
   ```

   If you've configured `.pypirc`, you won't be prompted for credentials!

   You'll be prompted for:
   - Username: `__token__`
   - Password: Your PyPI API token

3. **Verify publication:**
   - Check https://pypi.org/project/translation-helps-mcp-client/
   - Test installation: `pip install translation-helps-mcp-client`

## Version Management

When updating the package:

1. Update version in `pyproject.toml`:

   ```toml
   version = "1.0.1"  # or "1.1.0", "2.0.0", etc.
   ```

2. Update version in `translation_helps/__init__.py`:

   ```python
   __version__ = "1.0.1"
   ```

3. Rebuild and upload:
   ```bash
   python -m build
   twine upload dist/*
   ```

## Troubleshooting

- **"Package already exists"**: Version number must be incremented
- **"Invalid credentials"**: Check your API token
- **"Build failed"**: Check that all required files are present (README.md, LICENSE, etc.)

## Post-Publication

- [ ] Update documentation with PyPI installation instructions
- [ ] Announce the release
- [ ] Monitor for issues and feedback
