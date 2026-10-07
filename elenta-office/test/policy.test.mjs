import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decidePermission, permissionResponse, pathsOf } from '../server/policy.mjs';
import { sessionOptions, toolsForRole, unexpectedTools } from '../server/runner.mjs';
import { tempDir } from './helpers.mjs';

const ws = tempDir('eo-ws-');
const out = join(ws, 'out');
mkdirSync(out, { recursive: true });
mkdirSync(join(ws, 'library'), { recursive: true });
writeFileSync(join(ws, 'library', 'a.md'), '# A');
const ctx = { workspace: ws, outDir: out, canWrite: true, webSearch: false };
const call = (name, kind, path, extra = {}) => ({ toolCallId: 't', name, kind, title: `${name} ${path || ''}`, rawInput: path ? { file_path: path, ...extra } : extra, locations: path ? [{ path }] : [] });

test('(a) any path outside the workspace is refused, even for reads', () => {
  const d = decidePermission(call('Read', 'read', '/etc/passwd'), ctx);
  assert.equal(d.decision, 'reject');
  assert.equal(d.rule, 'a');
  assert.equal(decidePermission(call('Write', 'edit', join(ws, '..', 'x.md')), ctx).decision, 'reject');
  assert.equal(decidePermission(call('Read', 'read', join(ws, 'library', '..', '..', 'etc')), ctx).decision, 'reject');
});

test('(b) writes and edits are allowed only inside out/', () => {
  assert.equal(decidePermission(call('Write', 'edit', join(out, 'p1.md'), { content: 'x' }), ctx).decision, 'allow');
  assert.equal(decidePermission(call('Edit', 'edit', join(out, 'p1.md')), ctx).decision, 'allow');
  const lib = decidePermission(call('Write', 'edit', join(ws, 'library', 'a.md')), ctx);
  assert.equal(lib.decision, 'reject');
  assert.equal(lib.rule, 'b');
  assert.equal(decidePermission(call('Write', 'edit', join(out, 'p1.md')), { ...ctx, canWrite: false }).decision, 'reject');
  assert.equal(decidePermission(call('Write', 'edit', join(out, 'big.md'), { content: 'x'.repeat(512 * 1024 + 1) }), ctx).decision, 'reject');
  assert.equal(decidePermission(call('Write', 'edit', join(out, 'new.md'), { content: 'x' }), { ...ctx, fileCount: 50, existing: () => false }).decision, 'reject');
  assert.equal(decidePermission(call('Write', 'edit', join(out, 'old.md'), { content: 'x' }), { ...ctx, fileCount: 50, existing: () => true }).decision, 'allow');
  assert.equal(decidePermission({ name: 'Write', kind: 'edit', rawInput: {} }, ctx).decision, 'reject');
});

test('(c) reads inside the workspace are allowed', () => {
  const d = decidePermission(call('Read', 'read', join(ws, 'library', 'a.md')), ctx);
  assert.equal(d.decision, 'allow');
  assert.equal(d.rule, 'c');
});

test('(d) web search only when switched on', () => {
  const ws1 = { name: 'WebSearch', kind: 'fetch', title: 'search', rawInput: { query: 'x' } };
  assert.equal(decidePermission(ws1, ctx).decision, 'reject');
  assert.equal(decidePermission(ws1, { ...ctx, webSearch: true }).decision, 'allow');
});

test('(e) shells, MCP tools, fetches and unknown tools are refused', () => {
  for (const t of [
    { name: 'Bash', kind: 'execute', rawInput: { command: 'ls' } },
    { name: 'BashOutput', kind: 'other' },
    { name: 'KillShell', kind: 'other' },
    { name: 'mcp__github__get_me', kind: 'other' },
    { name: 'WebFetch', kind: 'fetch', rawInput: { url: 'https://example.com' } },
    { name: 'Glob', kind: 'search', rawInput: { pattern: '**' } },
    { name: 'Task', kind: 'think' },
    { kind: 'execute', title: 'run something' },
  ]) assert.equal(decidePermission(t, ctx).decision, 'reject', t.name || t.kind);
});

test('the response picks a one-time option and never an "always" option', () => {
  const options = [
    { optionId: 'allow-once', kind: 'allow_once' },
    { optionId: 'allow-always', kind: 'allow_always' },
    { optionId: 'reject', kind: 'reject_once' },
  ];
  assert.deepEqual(permissionResponse('allow', options), { outcome: { outcome: 'selected', optionId: 'allow-once' } });
  assert.deepEqual(permissionResponse('reject', options), { outcome: { outcome: 'selected', optionId: 'reject' } });
  assert.deepEqual(permissionResponse('allow', [{ optionId: 'a', kind: 'allow_always' }]), { outcome: { outcome: 'cancelled' } });
  assert.deepEqual(permissionResponse('reject', []), { outcome: { outcome: 'cancelled' } });
});

test('paths are collected from locations, raw input and diffs', () => {
  const p = pathsOf({ locations: [{ path: '/a' }], rawInput: { file_path: '/b', notebook_path: '/c' }, content: [{ type: 'diff', path: '/d' }] });
  assert.deepEqual(p.sort(), ['/a', '/b', '/c', '/d']);
});

test('session options never expose a shell and pre-approve nothing', () => {
  for (const role of ['route', 'plan', 'piece', 'combine']) {
    for (const web of [false, true]) {
      const o = sessionOptions(role, { webSearch: web });
      for (const shell of ['Bash', 'BashOutput', 'KillShell', 'PowerShell']) {
        assert.ok(!o.tools.includes(shell));
        assert.ok(o.disallowedTools.includes(shell));
      }
      for (const t of ['Glob', 'Grep', 'NotebookEdit', 'Task', 'WebFetch']) assert.ok(o.disallowedTools.includes(t));
      assert.deepEqual(o.allowedTools, []);
      assert.deepEqual(o.settingSources, []);
      assert.equal(o.tools.includes('WebSearch'), role === 'piece' && web);
    }
  }
  assert.deepEqual(toolsForRole('route'), []);
  assert.deepEqual(toolsForRole('plan'), []);
  assert.deepEqual(toolsForRole('combine'), ['Read', 'Write', 'Edit']);
  assert.deepEqual(unexpectedTools(['Read', 'Bash'], ['Read', 'Write']), ['Bash']);
});
