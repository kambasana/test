// The client-side permission policy for session/request_permission (SPEC §5).
// Order: (a) a path outside the workspace → reject; (b) write/edit inside out/ → allow once;
// (c) read inside the workspace → allow once; (d) web search when enabled → allow once;
// (e) everything else → reject.
import { isContained } from './paths.mjs';

export const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'KillBash', 'PowerShell', 'Monitor', 'TaskStop']);
export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
export const READ_TOOLS = new Set(['Read']);
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES_PER_JOB = 50;

/** Tool name from an ACP tool call (the adapter sends `name`, sometimes `_meta.claudeCode.toolName`). */
export function toolNameOf(toolCall = {}) {
  return toolCall.name || toolCall._meta?.claudeCode?.toolName || toolCall.rawInput?.tool_name || '';
}

/** Every path a tool call mentions. */
export function pathsOf(toolCall = {}) {
  const out = new Set();
  for (const l of Array.isArray(toolCall.locations) ? toolCall.locations : []) if (l && typeof l.path === 'string') out.add(l.path);
  const ri = toolCall.rawInput && typeof toolCall.rawInput === 'object' ? toolCall.rawInput : {};
  for (const k of ['file_path', 'path', 'notebook_path', 'filePath', 'directory', 'dir']) if (typeof ri[k] === 'string') out.add(ri[k]);
  for (const c of Array.isArray(toolCall.content) ? toolCall.content : []) if (c && c.type === 'diff' && typeof c.path === 'string') out.add(c.path);
  return [...out];
}

/**
 * @param {object} toolCall the ACP toolCall of the request
 * @param {object} ctx { workspace, outDir, canWrite, webSearch, kind?, fileCount?, existing?(path)=>bool }
 * @returns {{ decision: 'allow'|'reject', rule: string, reason: string, tool: string, kind: string, paths: string[] }}
 */
export function decidePermission(toolCall, ctx) {
  const tool = toolNameOf(toolCall);
  const kind = toolCall.kind || ctx.kind || 'other';
  const paths = pathsOf(toolCall);
  const result = (decision, rule, reason) => ({ decision, rule, reason, tool, kind, paths });

  if (SHELL_TOOLS.has(tool) || kind === 'execute') return result('reject', 'e', 'Shell commands are never allowed.');
  if (tool.startsWith('mcp__')) return result('reject', 'e', 'Connector and MCP tools are not allowed.');
  // (a)
  for (const p of paths) {
    if (!isContained(ctx.workspace, p)) return result('reject', 'a', `${p} is outside the job workspace.`);
  }
  // (b)
  if (WRITE_TOOLS.has(tool) || kind === 'edit' || kind === 'delete' || kind === 'move') {
    if (!ctx.canWrite) return result('reject', 'b', 'This step may not write files.');
    if (kind === 'delete' || kind === 'move') return result('reject', 'b', 'Deleting or moving files is not allowed.');
    if (paths.length === 0) return result('reject', 'b', 'A write must name its file.');
    for (const p of paths) if (!isContained(ctx.outDir, p)) return result('reject', 'b', `${p} is not inside out/.`);
    const content = toolCall.rawInput?.content;
    if (typeof content === 'string' && Buffer.byteLength(content) > MAX_FILE_BYTES) return result('reject', 'b', 'The file is larger than 512 KB.');
    if (typeof ctx.fileCount === 'number' && ctx.existing && paths.some((p) => !ctx.existing(p)) && ctx.fileCount >= MAX_FILES_PER_JOB) {
      return result('reject', 'b', `The job already has ${MAX_FILES_PER_JOB} files.`);
    }
    return result('allow', 'b', 'Write inside out/.');
  }
  // (c)
  if (READ_TOOLS.has(tool) || kind === 'read') {
    if (paths.length === 0) return result('reject', 'c', 'A read must name its file.');
    return result('allow', 'c', 'Read inside the workspace.');
  }
  // (d)
  if (tool === 'WebSearch') {
    return ctx.webSearch ? result('allow', 'd', 'Web search is switched on.') : result('reject', 'd', 'Web search is switched off.');
  }
  // (e)
  return result('reject', 'e', `The tool ${tool || kind} is not on the allowed list.`);
}

/** Turn a decision into an ACP RequestPermissionResponse using the offered options (never "always"). */
export function permissionResponse(decision, options = []) {
  const want = decision === 'allow' ? 'allow_once' : 'reject_once';
  const opt = options.find((o) => o.kind === want);
  if (opt) return { outcome: { outcome: 'selected', optionId: opt.optionId } };
  if (decision !== 'allow') {
    const rej = options.find((o) => o.kind === 'reject_always');
    if (rej) return { outcome: { outcome: 'selected', optionId: rej.optionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}
