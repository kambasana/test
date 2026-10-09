// Shared test helpers (not a test file itself).
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function tempDir(prefix = 'eo-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Environment for an isolated office: its own data, work, deliverables, library copy and settings. */
export function isolatedEnv(extra = {}) {
  const dir = tempDir();
  cpSync(join(ROOT, 'library'), join(dir, 'library'), { recursive: true });
  return {
    dir,
    env: {
      EO_PORT: '0',
      EO_DATA: join(dir, 'data'),
      EO_WORK: join(dir, 'work'),
      EO_DELIVERABLES: join(dir, 'deliverables'),
      EO_LIBRARY: join(dir, 'library'),
      EO_SETTINGS: join(dir, 'settings.local.json'),
      ...extra,
    },
  };
}

/**
 * A stand-in for the ACP runner: answers like a well-behaved agent without calling Claude.
 * Records every call in `calls`.
 */
export function fakeRunner({ routeTo = 'capability', plan = null, failPieces = [], delayMs = 5 } = {}) {
  const calls = [];
  const fn = async (o) => {
    calls.push({ role: o.role, agent: o.agent.id, prompt: o.prompt });
    await new Promise((r) => setTimeout(r, delayMs));
    if (o.signal?.aborted) throw new Error('cancelled');
    if (o.role === 'route') return { text: JSON.stringify({ dept: routeTo, why: 'It is test-plan work for a defence product.' }), stopReason: 'end_turn', tools: [] };
    if (o.role === 'plan') {
      const pieces = plan ?? [
        { agent: 'mil-test-engineer', title: 'Test cases', text: 'Write the test cases.' },
        { agent: 'mil-req-analyst', title: 'Traceability table', text: 'Write the RTM.' },
        { agent: 'mil-writer', title: 'Plan text', text: 'Write the surrounding plan.' },
      ];
      return { text: '```json\n' + JSON.stringify({ pieces, why: 'Split by sub-team.' }) + '\n```', stopReason: 'end_turn', tools: [] };
    }
    const m = o.prompt.match(/exactly this file: (\S+)/);
    if (o.role === 'piece') {
      if (failPieces.includes(o.agent.id)) throw new Error('simulated failure');
      o.activity({ kind: 'read', text: 'library/military/test-plan-template.md' });
      mkdirSync(dirname(m[1]), { recursive: true });
      writeFileSync(m[1], `## Piece by ${o.agent.name}\n\nContent.\n`);
      return { text: `Wrote the piece for ${o.agent.name}.`, stopReason: 'end_turn', tools: ['Read', 'Write', 'Edit'] };
    }
    if (o.role === 'combine') {
      writeFileSync(m[1], '# Combined deliverable\n\n' + 'Body. '.repeat(100) + '\n\n## Notes used\n\n- shared/house-style.md\n\n## Assumptions\n\nNone\n');
      return { text: 'Combined the pieces.', stopReason: 'end_turn', tools: ['Read', 'Write', 'Edit'] };
    }
    throw new Error('unknown role');
  };
  fn.calls = calls;
  return fn;
}

export async function waitFor(pred, { timeoutMs = 5000, stepMs = 10 } = {}) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export { existsSync };
