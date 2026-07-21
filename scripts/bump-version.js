#!/usr/bin/env node
/**
 * Semver bump driven by Conventional Commits.
 *
 * Reads the latest `vX.Y.Z` git tag as the base, scans commits since that tag
 * (excluding merge commits) for Conventional Commits prefixes, and produces the
 * next version:
 *
 *   - `feat:`        → minor
 *   - `fix:`         → patch
 *   - `BREAKING CHANGE` footer or `type!:` → major
 *   - anything else  → patch (default for any release-worthy merge)
 *
 * Writes the new version back into package.json and emits GitHub Actions
 * outputs (`version=...`, `bump_type=...`) when run inside a workflow.
 *
 * Usage:
 *   node scripts/bump-version.js
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');

function exec(cmd) {
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}

function safeExec(cmd, fallback) {
  try {
    return exec(cmd);
  } catch {
    return fallback;
  }
}

function getLatestTag() {
  const tag = safeExec('git describe --tags --abbrev=0 --match="v*"', '');
  return tag || null;
}

function getCommitsSince(range) {
  const log = safeExec(
    `git log ${range} --no-merges --pretty=format:"%s"`,
    ''
  );
  return log.split('\n').filter(Boolean);
}

function detectBumpType(commits) {
  let hasBreaking = false;
  let hasFeat = false;

  const TYPE_RE = /^([a-z]+)(\([^)]+\))?!?:/;

  for (const subject of commits) {
    if (subject.includes('BREAKING CHANGE')) {
      hasBreaking = true;
    }
    const match = subject.match(TYPE_RE);
    if (!match) continue;
    if (match[1].endsWith('!')) hasBreaking = true;
    if (match[1] === 'feat') hasFeat = true;
  }

  if (hasBreaking) return 'major';
  if (hasFeat) return 'minor';
  return 'patch';
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writeGithubOutput(version, bumpType) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, `version=${version}\n`);
  fs.appendFileSync(out, `bump_type=${bumpType}\n`);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  const lastTag = getLatestTag();

  const baseVersion = lastTag ? lastTag.replace(/^v/, '') : '0.1.0';
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const commits = getCommitsSince(range);

  const bumpType = detectBumpType(commits);
  const newVersion = bumpVersion(baseVersion, bumpType);

  pkg.version = newVersion;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

  // eslint-disable-next-line no-console
  console.log(
    `bump-version: ${baseVersion} → ${newVersion} (${bumpType}) — ${commits.length} commit(s) since ${lastTag || 'no previous tag'}`
  );

  writeGithubOutput(newVersion, bumpType);
}

main();