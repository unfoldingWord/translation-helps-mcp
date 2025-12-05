@echo off
REM Build and publish script for Translation Helps MCP Python SDK

echo ==========================================
echo Building Translation Helps MCP Python SDK
echo ==========================================

REM Clean previous builds
echo Cleaning previous builds...
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build
for /d %%d in (*.egg-info) do rmdir /s /q %%d

REM Install build tools
echo Installing build tools...
py -m pip install build twine -q

REM Build the package
echo Building package...
py -m build

REM Check the package
echo Checking package...
py -m twine check dist/*

echo.
echo ==========================================
echo Build successful!
echo ==========================================
echo.
echo Package files created:
dir dist
echo.
echo To publish to TestPyPI:
echo   py -m twine upload --repository testpypi dist/*
echo.
echo To publish to PyPI:
echo   py -m twine upload dist/*
echo.
echo Note: If you've configured .pypirc with your token, you won't be prompted.
echo Get your token from: https://pypi.org/manage/account/token/

pause


