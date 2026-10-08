import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterEnv } from '../server/acp.mjs';

test('agent env: only allow-listed variables reach the agent', () => {
  const env = adapterEnv({ PATH: '/bin', HOME: '/h', HTTPS_PROXY: 'p', LC_ALL: 'C', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c',
    CLAUDECODE: '1', EO_SECRET: 's', DATABASE_URL: 'pg://x', GITHUB_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 'a', BUZZ_PRIVATE_KEY: 'nsec' }, []);
  for (const k of ['PATH', 'HOME', 'HTTPS_PROXY', 'LC_ALL', 'ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR']) assert.ok(k in env, k);
  for (const k of ['CLAUDECODE', 'EO_SECRET', 'DATABASE_URL', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'BUZZ_PRIVATE_KEY']) assert.ok(!(k in env), k);
  assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
});
test('agent env: an operator can allow an extra name', () => {
  assert.equal(adapterEnv({ MY_VAR: 'x' }, ['MY_VAR']).MY_VAR, 'x');
});
