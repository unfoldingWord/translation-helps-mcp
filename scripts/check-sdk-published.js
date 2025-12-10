#!/usr/bin/env node
/**
 * Pre-commit hook to check if SDK packages have unpublished changes
 *
 * This script checks if local SDK packages have changes that haven't been
 * published to npm. It warns if:
 * 1. The local version is newer than the published version
 * 2. There are uncommitted changes in SDK packages
 * 3. The package has been modified but not published
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const SDK_PACKAGES = [
  { path: "packages/js-sdk", name: "@translation-helps/mcp-client" },
  // Add more SDK packages here if needed
];

function getLocalVersion(packagePath) {
  const packageJsonPath = join(rootDir, packagePath, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  return packageJson.version;
}

function getPublishedVersion(packageName) {
  try {
    const result = execSync(`npm view ${packageName} version`, {
      encoding: "utf-8",
      cwd: rootDir,
      stdio: "pipe",
    });
    return result.trim();
  } catch (error) {
    // Package might not exist on npm yet
    return null;
  }
}

function hasUncommittedChanges(packagePath) {
  try {
    const result = execSync(`git status --porcelain ${packagePath}`, {
      encoding: "utf-8",
      cwd: rootDir,
      stdio: "pipe",
    });
    return result.trim().length > 0;
  } catch (error) {
    return false;
  }
}

function hasUnpushedCommits(packagePath) {
  try {
    // Check if there are commits in the package directory that aren't pushed
    const result = execSync(
      `git log origin/main..HEAD --oneline -- ${packagePath}`,
      { encoding: "utf-8", cwd: rootDir, stdio: "pipe" },
    );
    return result.trim().length > 0;
  } catch (error) {
    // If origin/main doesn't exist or other error, assume no unpushed commits
    return false;
  }
}

function compareVersions(local, published) {
  if (!published) return "new"; // Package doesn't exist on npm

  const localParts = local.split(".").map(Number);
  const publishedParts = published.split(".").map(Number);

  for (let i = 0; i < Math.max(localParts.length, publishedParts.length); i++) {
    const localPart = localParts[i] || 0;
    const publishedPart = publishedParts[i] || 0;

    if (localPart > publishedPart) return "newer";
    if (localPart < publishedPart) return "older";
  }

  return "same";
}

function main() {
  let hasWarnings = false;
  const warnings = [];

  for (const pkg of SDK_PACKAGES) {
    const localVersion = getLocalVersion(pkg.path);
    const publishedVersion = getPublishedVersion(pkg.name);
    const uncommitted = hasUncommittedChanges(pkg.path);
    const unpushed = hasUnpushedCommits(pkg.path);
    const versionComparison = compareVersions(localVersion, publishedVersion);

    // Check for issues
    if (versionComparison === "newer") {
      warnings.push(
        `⚠️  ${pkg.name}: Local version (${localVersion}) is newer than published (${publishedVersion || "not published"})`,
      );
      hasWarnings = true;
    }

    if (uncommitted) {
      warnings.push(`⚠️  ${pkg.name}: Has uncommitted changes in ${pkg.path}`);
      hasWarnings = true;
    }

    if (unpushed && versionComparison !== "older") {
      warnings.push(
        `⚠️  ${pkg.name}: Has unpushed commits that may contain unpublished changes`,
      );
      hasWarnings = true;
    }
  }

  if (hasWarnings) {
    console.error("\n❌ SDK Package Publishing Check Failed\n");
    warnings.forEach((warning) => console.error(warning));
    console.error("\n📦 Before committing, ensure SDK packages are published:");
    console.error("   1. Update version in packages/js-sdk/package.json");
    console.error("   2. Build: cd packages/js-sdk && npm run build");
    console.error("   3. Publish: cd packages/js-sdk && npm publish");
    console.error("   4. Update UI dependency: cd ui && npm install");
    console.error(
      "\n💡 To skip this check (not recommended): git commit --no-verify\n",
    );
    process.exit(1);
  } else {
    console.log("✅ All SDK packages are up to date with npm");
  }
}

main();
