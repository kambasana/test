// Minimal Agent Client Protocol client: JSON-RPC 2.0, one JSON message per line over stdio.
// One AcpConnection = one adapter child process.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ADAPTER_DIR = join(ROOT, 'node_modules', '@agentclientprotocol', 'claude-agent-acp');
export const ADAPTER_ENTRY = join(ADAPTER_DIR, 'dist', 'index.js');

export function adapterInfo() {
  try {
    const pkg = JSON.parse(readFileSync(join(ADAPTER_DIR, 'package.json'), 'utf8'));
    return { adapter: pkg.name, version: pkg.version };
  } catch {
    return { adapter: '@agentclientprotocol/claude-agent-acp', version: null };
  }
}

/** Environment for the adapter: the host's, minus anything that would make the child think it is
 *  nested inside another Claude Code, with claude.ai connectors switched off. */
export function adapterEnv(base = process.env) {
  const env = { ...base };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SSE_PORT;
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
}

export class AcpConnection {
  /**
   * @param {object} o
   * @param {(method:string, params:any)=>Promise<any>} o.onRequest  agent → client requests
   * @param {(method:string, params:any)=>void} o.onNotification     agent → client notifications
   * @param {(line:string)=>void} [o.onStderr]
   * @param {string} [o.cwd]
   */
  constructor({ onRequest, onNotification, onStderr, cwd }) {
    this.onRequest = onRequest;
    this.onNotification = onNotification;
    this.onStderr = onStderr || (() => {});
    this.nextId = 1;
    this.pending = new Map();
    this.closed = false;
    this.child = spawn(process.execPath, [ADAPTER_ENTRY], {
      cwd: cwd || ROOT,
      env: adapterEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // own process group, so kill() also ends the Claude Code child
    });
    this.exited = new Promise((resolve) => {
      this.child.on('exit', (code, signal) => {
        this.closed = true;
        for (const { reject } of this.pending.values()) reject(new Error(`agent process ended (${signal || code})`));
        this.pending.clear();
        resolve({ code, signal });
      });
    });
    this.child.on('error', (err) => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
    this.child.stdin.on('error', () => {});
    createInterface({ input: this.child.stdout }).on('line', (line) => this.#onLine(line));
    createInterface({ input: this.child.stderr }).on('line', (line) => this.onStderr(line));
  }

  #send(msg) {
    if (this.closed) return;
    this.child.stdin.write(JSON.stringify(msg) + '\n');
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error('agent process is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this.#send({ jsonrpc: '2.0', method, params });
  }

  async #onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { this.onStderr(`[non-json stdout] ${line.slice(0, 300)}`); return; }
    if (msg && msg.method && msg.id !== undefined) {
      // A request from the agent.
      try {
        const result = await this.onRequest(msg.method, msg.params || {});
        this.#send({ jsonrpc: '2.0', id: msg.id, result: result ?? null });
      } catch (err) {
        this.#send({ jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: String(err.message || err) } });
      }
      return;
    }
    if (msg && msg.method) {
      try { this.onNotification(msg.method, msg.params || {}); } catch (err) { this.onStderr(`[notification handler] ${err.message}`); }
      return;
    }
    if (msg && msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        const e = new Error(`${p.method}: ${msg.error.message || 'error'}${msg.error.data ? ' ' + JSON.stringify(msg.error.data).slice(0, 500) : ''}`);
        e.code = msg.error.code;
        p.reject(e);
      } else p.resolve(msg.result);
    }
  }

  async kill() {
    if (this.closed) return;
    const pid = this.child.pid;
    try { this.child.stdin.end(); } catch {}
    const signal = (sig) => { try { process.kill(-pid, sig); } catch { try { this.child.kill(sig); } catch {} } };
    signal('SIGTERM');
    const t = setTimeout(() => signal('SIGKILL'), 2000);
    t.unref();
    await Promise.race([this.exited, new Promise((r) => setTimeout(r, 2500).unref())]);
    clearTimeout(t);
    signal('SIGKILL');
  }
}
