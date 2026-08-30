#!/usr/bin/env node
/**
 * Validate that every changeset file references only packages
 * that exist in the workspace.
 *
 * Exits 1 and lists invalid package names if any are found.
 *
 * The repo's vitest run only covers packages/*, so this script has no test
 * file; instead the package-line regex is self-tested on every invocation
 * (SELF_TEST below): both frontmatter quote styles must match and a
 * non-package line must not. The gate once validated nothing because its
 * regex only accepted double-quoted keys while the house frontmatter is
 * single-quoted — a failed self-check exits 1 so that can never pass
 * vacuously again.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const changesetDir = join(root, '.changeset');

// House changeset frontmatter uses single quotes; the changesets CLI writes
// double quotes. Accept both.
const PACKAGE_LINE = /^['"]([^'"]+)['"]:\s*(?:patch|minor|major)\s*$/;

// --- Self-test: keep the gate honest (see header) ---

const SELF_TEST = [
  ["'@proxitor/proxy-core': minor", true],
  ['"@proxitor/plugin-api": patch', true],
  ["'@proxitor/proxy-core': mionor", false],
  ['- "@proxitor/proxy-core": minor', false],
];

for (const [line, shouldMatch] of SELF_TEST) {
  if (PACKAGE_LINE.test(line) !== shouldMatch) {
    console.error(
      `❌ Self-test failed: package-line regex ${
        shouldMatch ? 'must match' : 'must reject'
      }: ${line}`,
    );
    process.exit(1);
  }
}

// --- Collect workspace package names ---

const workspacePackages = new Set();

const packagesDir = join(root, 'packages');
if (existsSync(packagesDir)) {
  for (const entry of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, entry, 'package.json');
    if (existsSync(pkgPath)) {
      workspacePackages.add(JSON.parse(readFileSync(pkgPath, 'utf8')).name);
    }
  }
}

// --- Parse changeset files ---

const changesetFiles = readdirSync(changesetDir).filter(
  f => f.endsWith('.md') && f !== 'README.md',
);

if (changesetFiles.length === 0) {
  console.log('✅ No changeset files found (nothing to validate)');
  process.exit(0);
}

const invalid = [];

for (const file of changesetFiles) {
  const content = readFileSync(join(changesetDir, file), 'utf8');
  const frontmatter = content.split('---').slice(1, 2)[0]?.trim();
  if (!frontmatter) continue;

  // Changeset frontmatter is YAML, package lines look like: "package-name": patch | minor | major
  for (const line of frontmatter.split('\n')) {
    const match = line.match(PACKAGE_LINE);
    if (match && !workspacePackages.has(match[1])) {
      invalid.push({ file, package: match[1] });
    }
  }
}

if (invalid.length > 0) {
  console.error('❌ Invalid package names in changeset files:');
  for (const { file, package: pkg } of invalid) {
    console.error(`   ${pkg} (in ${file})`);
  }
  console.error('');
  console.error(`   Valid packages: ${[...workspacePackages].join(', ')}`);
  process.exit(1);
}

console.log('✅ All changeset package names are valid');
