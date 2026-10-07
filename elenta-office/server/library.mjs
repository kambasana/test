// The notes library (SPEC §3): index, reading, lessons and the per-job copy.
import { readdirSync, readFileSync, statSync, lstatSync, mkdirSync, copyFileSync, existsSync, appendFileSync, watch } from 'node:fs';
import { join, relative, sep, posix, dirname } from 'node:path';
import { containedPath } from './paths.mjs';
import { isoDay } from './util.mjs';

const MAX_NOTE_BYTES = 256 * 1024;

function titleOf(text, file) {
  const m = text.match(/^#\s+(.+?)\s*#*\s*$/m);
  return m ? m[1].trim() : file.replace(/\.md$/i, '');
}

export function buildIndex(root) {
  const entries = [];
  if (!existsSync(root)) return entries;
  const walk = (dir) => {
    let names;
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      let st;
      try { st = lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) continue; // never follow links out of the library
      if (st.isDirectory()) { walk(full); continue; }
      if (!st.isFile() || !/\.md$/i.test(name) || st.size > MAX_NOTE_BYTES) continue;
      const rel = relative(root, full).split(sep).join(posix.sep);
      const text = readFileSync(full, 'utf8');
      const parts = rel.split('/');
      const body = text.replace(/^#\s+.*$/m, '').replace(/\s+/g, ' ').trim();
      entries.push({
        path: rel,
        title: titleOf(text, name),
        folder: parts.length > 1 ? parts[0] : '',
        excerpt: body.slice(0, 200),
        bytes: st.size,
        updatedAt: st.mtime.toISOString(),
      });
    }
  };
  walk(root);
  return entries;
}

/** Which index entries a department may read: shared notes, its own folder, its own lessons. */
export function notesForDept(index, deptKey) {
  return index.filter((e) =>
    e.folder === '' || e.folder === 'shared' || e.folder === deptKey || e.path === `lessons/${deptKey}.md`);
}

export class Library {
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.onChange = onChange || (() => {});
    this.index = [];
    this.rebuild();
  }

  rebuild() {
    this.index = buildIndex(this.root);
    return this.index;
  }

  watch() {
    if (!existsSync(this.root)) return;
    let timer = null;
    try {
      this.watcher = watch(this.root, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => { this.rebuild(); this.onChange(this.index); }, 250);
        timer.unref?.();
      });
      this.watcher.on('error', () => {});
      this.watcher.unref?.();
    } catch { /* watching is a convenience */ }
  }

  close() { try { this.watcher?.close(); } catch {} }

  readNote(relPath) {
    if (typeof relPath !== 'string' || !/\.md$/i.test(relPath)) throw new Error('Only Markdown notes (.md) can be read.');
    const full = containedPath(this.root, relPath);
    const st = statSync(full);
    if (!st.isFile()) throw new Error('That note does not exist.');
    if (st.size > MAX_NOTE_BYTES) throw new Error('That note is too large.');
    return readFileSync(full, 'utf8');
  }

  lessonsText(deptKey) {
    const p = join(this.root, 'lessons', `${deptKey}.md`);
    try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
  }

  addLesson(dept, note, jobTitle) {
    const dir = join(this.root, 'lessons');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${dept.key}.md`);
    if (!existsSync(file)) appendFileSync(file, `# Lessons for ${dept.name}\n\nNotes the owner left when rejecting work. Read them before you start.\n`);
    const clean = String(note).replace(/\r/g, '').trim();
    appendFileSync(file, `\n## ${isoDay()} — ${String(jobTitle).replace(/\s+/g, ' ').slice(0, 100)}\n\n${clean}\n`);
    this.rebuild();
    return `lessons/${dept.key}.md`;
  }

  /** Copy the notes a department may read into `<workspace>/library/`. Returns the copied entries. */
  copyForDept(deptKey, workspace) {
    const allowed = notesForDept(this.rebuild(), deptKey);
    const dest = join(workspace, 'library');
    mkdirSync(dest, { recursive: true });
    for (const e of allowed) {
      const src = containedPath(this.root, e.path);
      const to = join(dest, ...e.path.split('/'));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(src, to);
    }
    return allowed;
  }
}
