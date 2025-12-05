#!/bin/bash
# Build and publish script for Translation Helps MCP Python SDK

set -e

echo "=========================================="
echo "Building Translation Helps MCP Python SDK"
echo "=========================================="

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf dist/ build/ *.egg-info 2>/dev/null || true

# Install build tools
echo "Installing build tools..."
py -m pip install build twine -q || python3 -m pip install build twine -q

# Build the package
echo "Building package..."
py -m build || python3 -m build

# Check the package
echo "Checking package..."
py -m twine check dist/* || python3 -m twine check dist/*

echo ""
echo "=========================================="
echo "✅ Build successful!"
echo "=========================================="
echo ""
echo "Package files created:"
ls -lh dist/
echo ""
echo "To publish to TestPyPI:"
echo "  py -m twine upload --repository testpypi dist/*"
echo ""
echo "To publish to PyPI:"
echo "  py -m twine upload dist/*"
echo ""
echo "Note: If you've configured .pypirc with your token, you won't be prompted."
echo "Get your token from: https://pypi.org/manage/account/token/"


