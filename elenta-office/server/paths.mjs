// Path containment. Every path an agent names is checked lexically (no "..", no NUL) and then
// against the real path of the deepest existing ancestor, so a symlink cannot lead outside.
import { realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, basename, join } from 'node:path';

export class PathError extends Error {
  constructor(message) { super(message); this.code = -32602; }
}

export function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && rel.split(sep)[0] !== '..');
}

function realOrNearest(p) {
  // Real path of p, or of its deepest existing ancestor joined with the missing tail.
  let cur = p;
  const tail = [];
  for (;;) {
    if (existsSync(cur)) {
      return join(realpathSync(cur), ...tail);
    }
    const parent = dirname(cur);
    if (parent === cur) return p;
    tail.unshift(basename(cur));
    cur = parent;
  }
}

/**
 * Resolve `p` (absolute, or relative to `root`) and require it to stay inside `root`.
 * Throws PathError otherwise. Returns the real absolute path.
 */
export function containedPath(root, p) {
  if (typeof p !== 'string' || p.length === 0) throw new PathError('A path is required.');
  if (p.includes('\0')) throw new PathError('The path contains a NUL byte.');
  if (p.split(/[\\/]+/).includes('..')) throw new PathError('The path may not contain "..".');
  const rootReal = existsSync(root) ? realpathSync(root) : resolve(root);
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  // Lexical check against both the given root and its real path (handles roots behind symlinks).
  if (!isInside(resolve(root), abs) && !isInside(rootReal, abs)) throw new PathError(`The path ${p} is outside the allowed folder.`);
  const real = realOrNearest(abs);
  if (!isInside(rootReal, real)) throw new PathError(`The path ${p} leads outside the allowed folder.`);
  return real;
}

export function isContained(root, p) {
  try { containedPath(root, p); return true; } catch { return false; }
}
