// Convert the survey's LaTeX comparison tables into Markdown tables.
import fs from 'fs';
import path from 'path';
import { delatex } from './latex_utils.mjs';

const BS = '\\';

function stripComments(s) {
  return s.split('\n').map((line) => {
    for (let i = 0; i < line.length; i++) if (line[i] === '%' && (i === 0 || line[i - 1] !== BS)) return line.slice(0, i);
    return line;
  }).join('\n');
}

// Remove \name{...} including nested braces (all of its brace groups when n > 1).
function dropMacro(s, name, nArgs = 1) {
  let out = s;
  let at;
  while ((at = out.indexOf(BS + name + '{')) !== -1) {
    let k = at + name.length + 1;
    for (let a = 0; a < nArgs; a++) {
      while (out[k] === ' ') k++;
      if (out[k] !== '{') break;
      let d = 0;
      for (; k < out.length; k++) {
        if (out[k] === '{') d++;
        else if (out[k] === '}') { d--; if (d === 0) { k++; break; } }
      }
    }
    out = out.slice(0, at) + out.slice(k);
  }
  return out;
}

function args(s, name, n) {
  const at = s.indexOf(BS + name + '{');
  if (at < 0) return null;
  const res = [];
  let k = at + name.length + 1;
  for (let a = 0; a < n; a++) {
    if (s[k] !== '{') break;
    let d = 0;
    const st = k;
    for (; k < s.length; k++) {
      if (s[k] === '{') d++;
      else if (s[k] === '}') { d--; if (d === 0) { k++; break; } }
    }
    res.push(s.slice(st + 1, k - 1));
  }
  return res;
}

function splitCells(row) {
  const cells = [];
  let d = 0;
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '{') d++;
    if (ch === '}') d--;
    if (ch === '&' && d === 0 && row[i - 1] !== BS) { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function tableBody(tex) {
  const a = tex.indexOf(BS + 'midrule');
  const b = tex.lastIndexOf(BS + 'bottomrule');
  return tex.slice(a + (BS + 'midrule').length, b);
}

function rows(body) {
  return body
    .split(/\\\\(?:\[[^\]]*\])?\*?\s*(?:\n|$)/)
    .map((r) => r.replace(/\\midrule/g, '').trim())
    .filter(Boolean);
}

const SYMBOLS = [
  [/\\FullCov\b/g, '●'], [/\\PartCov\b/g, '◐'], [/\\NoCov\b/g, '○'],
  [/\\cfull\b/g, '●'], [/\\chalf\b/g, '◐'], [/\\cnone\b/g, '○'],
];

export function convertTable(src, name, linkFor, opts = {}) {
  const tex = stripComments(fs.readFileSync(path.join(src, 'tables', name + '.tex'), 'utf8'));
  let body = tableBody(tex);
  for (const [re, sym] of SYMBOLS) body = body.replace(re, sym);
  body = dropMacro(body, 'platformlogo');
  const out = [];
  for (let r of rows(body)) {
    const g = args(r, 'tablegroup', 2);
    if (g) {
      out.push({ group: delatex(g[1].replace(/\s*\(Section[^)]*\)/, '')) });
      r = dropMacro(r, 'tablegroup', 2).trim();
      if (!r) continue;
    }
    if (/\\prodgroup\{/.test(r)) {
      const pg = args(r, 'prodgroup', 1);
      out.push({ group: delatex(pg[0]) });
      r = dropMacro(r, 'prodgroup').trim();
      if (!r) continue;
    }
    const cells = splitCells(r).map((c) => {
      let t = c;
      const se = args(t, 'surveyentry', 3);
      if (se) t = `${se[0]} (${se[2]})`;
      const pn = args(t, 'prodname', 3);
      if (pn) t = `${pn[0]} ${pn[1]}`;
      // A row whose brand is shown only as a logo (e.g. XREAL One Pro).
      const logo = /product_logos\/([a-z]+)\./.exec(t);
      if (!pn && logo) {
        t = dropMacro(dropMacro(t, 'raisebox', 2), 'hspace*').replace(/^\s*\\newline\s*/, '');
        t = `${logo[1].toUpperCase()} ${t}`;
      }
      t = t.replace(/\\newline/g, ' · ');
      const refs = [];
      t = t.replace(/\\tabref\{([^}]*)\}/g, (m, ks) => {
        refs.push(ks.split(',').map((k) => linkFor(k.trim())).filter(Boolean).join(', '));
        return `REFTOKEN${refs.length - 1}X`;
      });
      return delatex(t).replace(/\|/g, '/').replace(/REFTOKEN(\d+)X/g, (m, i) => refs[Number(i)]);
    });
    out.push({ cells });
  }
  return out;
}

export function toMarkdown(header, data, pick = null, align = null) {
  const sel = (cells) => (pick ? pick.map((i) => cells[i] ?? '') : cells);
  const lines = [`| ${header.join(' | ')} |`, `| ${(align || header.map(() => ':--')).join(' | ')} |`];
  for (const r of data) {
    if (r.group) lines.push(`| **${r.group}** |${' |'.repeat(header.length - 1)}`);
    else lines.push(`| ${sel(r.cells).join(' | ')} |`);
  }
  return lines.join('\n');
}
