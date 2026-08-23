#!/usr/bin/env node
/**
 * Validate that every changeset file references only packages
 * that exist in the workspace.
 *
 * Exits 1 and lists invalid package names if any are found.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const changesetDir = join(root, '.changeset');

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
    const match = line.match(/^"([^"]+)":\s*(?:patch|minor|major)\s*$/);
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
