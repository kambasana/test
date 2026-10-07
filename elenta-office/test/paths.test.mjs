import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { containedPath, isContained, isInside } from '../server/paths.mjs';
import { tempDir } from './helpers.mjs';

const root = tempDir('eo-root-');
const outside = tempDir('eo-outside-');
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out', 'ok.md'), 'ok');
writeFileSync(join(outside, 'secret.md'), 'secret');
symlinkSync(outside, join(root, 'out', 'escape'));
symlinkSync(join(outside, 'secret.md'), join(root, 'out', 'link.md'));

test('paths inside the root resolve, including files that do not exist yet', () => {
  assert.ok(containedPath(root, 'out/ok.md').endsWith('/out/ok.md'));
  assert.ok(containedPath(root, join(root, 'out', 'new', 'deep.md')).endsWith('/out/new/deep.md'));
  assert.ok(isContained(root, root));
});

test('"..", NUL and absolute paths elsewhere are refused', () => {
  assert.throws(() => containedPath(root, '../x'));
  assert.throws(() => containedPath(root, 'out/../../x'));
  assert.throws(() => containedPath(root, root + '/out/../out/ok.md'), /"\.\."/);
  assert.throws(() => containedPath(root, 'out/a\0b'));
  assert.throws(() => containedPath(root, '/etc/passwd'));
  assert.throws(() => containedPath(root, ''));
  assert.throws(() => containedPath(root, root + '-sibling/x'));
});

test('symlinks that lead outside are refused (directory and file links)', () => {
  assert.equal(isContained(root, join(root, 'out', 'escape', 'secret.md')), false);
  assert.equal(isContained(root, join(root, 'out', 'escape', 'new.md')), false);
  assert.equal(isContained(root, join(root, 'out', 'link.md')), false);
});

test('isInside is purely lexical and handles prefixes correctly', () => {
  assert.ok(isInside('/a/b', '/a/b/c'));
  assert.ok(!isInside('/a/b', '/a/bc'));
  assert.ok(!isInside('/a/b', '/a'));
});
