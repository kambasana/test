// A small Markdown renderer that builds DOM nodes directly (no HTML strings).
// Supports headings, paragraphs, lists, block quotes, fenced code, pipe
// tables, rules, and inline bold / italic / code. Links are shown as text.
import { h } from './dom.js';

function inline(text) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (m[1]) out.push(h('code', null, s.slice(1, -1)));
    else if (m[2]) out.push(h('strong', null, inline(s.slice(2, -2))));
    else if (m[3] || m[4]) out.push(h('em', null, inline(s.slice(1, -1))));
    else if (m[5]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(s);
      out.push(h('span', { class: 'md-link', title: mm[2] }, mm[1]));
    }
    last = m.index + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function renderMarkdown(src) {
  const root = h('div', { class: 'md' });
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^```/.exec(line))) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      root.appendChild(h('pre', null, h('code', null, buf.join('\n'))));
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      const level = Math.min(6, m[1].length + 1); // the dialog owns h1/h2
      root.appendChild(h(`h${Math.max(3, level)}`, null, inline(m[2])));
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { root.appendChild(h('hr')); i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      const aligns = cells(lines[i + 1]).map((c) => (/^:?-+:$/.test(c) ? (c.startsWith(':') ? 'center' : 'right') : 'left'));
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      root.appendChild(h('div', { class: 'md-table' }, h('table', null,
        h('thead', null, h('tr', null, head.map((c, j) => h('th', { style: { textAlign: aligns[j] || 'left' } }, inline(c))))),
        h('tbody', null, rows.map((r) => h('tr', null, head.map((_, j) => h('td', { style: { textAlign: aligns[j] || 'left' } }, inline(r[j] || '')))))))));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      root.appendChild(h('blockquote', null, inline(buf.join(' '))));
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const list = h(ordered ? 'ol' : 'ul');
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        list.appendChild(h('li', null, inline(item)));
      }
      root.appendChild(list);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*\||\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    const p = h('p');
    buf.forEach((b, j) => {
      const hard = / {2}$/.test(b);
      p.append(...inline(b.trim()));
      if (j < buf.length - 1) p.append(hard ? h('br') : ' ');
    });
    root.appendChild(p);
  }
  return root;
}
