# Setting Up PyPI Token for Automatic Authentication

This guide shows you how to configure your PyPI token so you don't have to enter it every time you publish.

## Option 1: `.pypirc` File (Recommended) ⭐

This is the simplest and most reliable method.

### Step 1: Get Your PyPI Token

1. Go to https://pypi.org/manage/account/token/
2. Click "Add API token"
3. Give it a name (e.g., "translation-helps-mcp")
4. Copy the token (it starts with `pypi-`)

### Step 2: Create `.pypirc` File

**On Windows (Git Bash):**

```bash
# Create the file in your home directory
cat > ~/.pypirc << 'EOF'
[pypi]
username = __token__
password = pypi-YourActualTokenHere

[testpypi]
username = __token__
password = pypi-YourTestPyPITokenHere
EOF
```

**On Windows (PowerShell):**

```powershell
# Create the file
$content = @"
[pypi]
username = __token__
password = pypi-YourActualTokenHere

[testpypi]
username = __token__
password = pypi-YourTestPyPITokenHere
"@
$content | Out-File -FilePath "$env:USERPROFILE\.pypirc" -Encoding utf8
```

**On Linux/Mac:**

```bash
cat > ~/.pypirc << 'EOF'
[pypi]
username = __token__
password = pypi-YourActualTokenHere

[testpypi]
username = __token__
password = pypi-YourTestPyPITokenHere
EOF
```

### Step 3: Replace the Token

Open `~/.pypirc` (or `%USERPROFILE%\.pypirc` on Windows) and replace `pypi-YourActualTokenHere` with your actual token.

### Step 4: Secure the File

**On Windows:**

```bash
# Make sure it's not tracked by git (if in a repo)
echo ".pypirc" >> ~/.gitignore
```

**On Linux/Mac:**

```bash
chmod 600 ~/.pypirc
```

### Step 5: Test It

```bash
cd packages/python-sdk
py -m twine upload dist/*
# Should NOT prompt for username/password!
```

## Option 2: Environment Variables

Set these in your shell profile:

**Windows (Git Bash) - Add to `~/.bashrc`:**

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=pypi-YourActualTokenHere
```

**Windows (PowerShell) - Add to profile:**

```powershell
$env:TWINE_USERNAME = "__token__"
$env:TWINE_PASSWORD = "pypi-YourActualTokenHere"
```

**Linux/Mac - Add to `~/.bashrc` or `~/.zshrc`:**

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=pypi-YourActualTokenHere
```

## Option 3: Keyring (Most Secure)

This stores your token in your system's secure credential store.

### Install Keyring:

```bash
py -m pip install keyring
```

### Store Your Token:

```bash
py -m keyring set https://upload.pypi.org/legacy/ __token__
# Enter your token when prompted
```

### Use Normally:

```bash
py -m twine upload dist/*
# Token is automatically retrieved from keyring
```

## Verification

After setup, test with:

```bash
cd packages/python-sdk
py -m build
py -m twine check dist/*
py -m twine upload dist/*  # Should not prompt for credentials!
```

## Troubleshooting

### Token Not Working?

- Make sure the token starts with `pypi-`
- Check that `username = __token__` (with double underscores)
- Verify the token hasn't expired (create a new one if needed)

### File Not Found?

- On Windows, the file should be at `C:\Users\YourUsername\.pypirc`
- On Linux/Mac, it should be at `~/.pypirc`
- Make sure there's no file extension (not `.pypirc.txt`)

### Still Being Prompted?

- Check file permissions: `chmod 600 ~/.pypirc` (Linux/Mac)
- Verify the file format is correct (no extra spaces, correct sections)
- Try using keyring instead (Option 3)

## Security Notes

⚠️ **IMPORTANT:**

- Never commit `.pypirc` to git
- Add it to `.gitignore` if it's in a repository
- Don't share your token with anyone
- Rotate your token if it's compromised

## Quick Reference

```bash
# Build
py -m build

# Check
py -m twine check dist/*

# Upload to PyPI
py -m twine upload dist/*

# Upload to TestPyPI
py -m twine upload --repository testpypi dist/*
```
