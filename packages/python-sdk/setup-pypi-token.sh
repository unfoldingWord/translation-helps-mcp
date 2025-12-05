#!/bin/bash
# Quick setup script for PyPI token configuration

echo "=========================================="
echo "PyPI Token Setup Helper"
echo "=========================================="
echo ""

# Check if .pypirc already exists
if [ -f ~/.pypirc ]; then
    echo "⚠️  ~/.pypirc already exists!"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

echo "Step 1: Get your PyPI token"
echo "  1. Go to: https://pypi.org/manage/account/token/"
echo "  2. Click 'Add API token'"
echo "  3. Give it a name (e.g., 'translation-helps-mcp')"
echo "  4. Copy the token (it starts with 'pypi-')"
echo ""
read -p "Press Enter when you have your token ready..."

echo ""
read -p "Enter your PyPI token (pypi-...): " PYPI_TOKEN

if [ -z "$PYPI_TOKEN" ]; then
    echo "❌ Token cannot be empty!"
    exit 1
fi

# Create .pypirc file
cat > ~/.pypirc << EOF
[pypi]
username = __token__
password = $PYPI_TOKEN

[testpypi]
username = __token__
password = $PYPI_TOKEN
EOF

# Set permissions (Linux/Mac)
if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "win32" ]]; then
    chmod 600 ~/.pypirc
fi

echo ""
echo "✅ Created ~/.pypirc"
echo ""
echo "Security:"
echo "  - Make sure ~/.pypirc is NOT in git"
echo "  - Add it to .gitignore if needed"
echo ""
echo "Test it:"
echo "  cd packages/python-sdk"
echo "  py -m build"
echo "  py -m twine upload dist/*"
echo ""

