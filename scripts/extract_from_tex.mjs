// Extract the survey's references and the subsections that discuss them.
// Usage: node scripts/extract_from_tex.mjs <manuscript-root> data/extracted.json
import fs from 'fs';
import path from 'path';

const SRC = process.argv[2];
const OUT = process.argv[3] || 'data/extracted.json';
const BS = '\\';

// ---------- BibTeX ----------
function parseBib(text) {
  const entries = {};
  let i = 0;
  while ((i = text.indexOf('@', i)) !== -1) {
    const m = /^@(\w+)\s*\{\s*([^,\s]+)\s*,/.exec(text.slice(i));
    if (!m) { i++; continue; }
    const type = m[1].toLowerCase();
    let j = i + m[0].length;
    let depth = 1;
    const start = j;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    entries[m[2]] = { key: m[2], type, fields: parseFields(text.slice(start, j - 1)) };
    i = j;
  }
  return entries;
}

function parseFields(body) {
  const f = {};
  let k = 0;
  while (k < body.length) {
    const m = /^\s*,?\s*([A-Za-z_]+)\s*=\s*/.exec(body.slice(k));
    if (!m) break;
    k += m[0].length;
    let val = '';
    if (body[k] === '{') {
      let d = 0;
      const s = k;
      for (; k < body.length; k++) {
        if (body[k] === '{') d++;
        else if (body[k] === '}') { d--; if (d === 0) { k++; break; } }
      }
      val = body.slice(s + 1, k - 1);
    } else if (body[k] === '"') {
      const e = body.indexOf('"', k + 1);
      val = body.slice(k + 1, e);
      k = e + 1;
    } else {
      const m2 = /^[^,]*/.exec(body.slice(k));
      val = m2[0].trim();
      k += m2[0].length;
    }
    f[m[1].toLowerCase()] = val.trim();
  }
  return f;
}

// ---------- LaTeX walk ----------
function stripComments(s) {
  return s
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '%' && (i === 0 || line[i - 1] !== BS)) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

function readTex(rel) {
  const p = path.join(SRC, rel.endsWith('.tex') ? rel : rel + '.tex');
  return fs.existsSync(p) ? stripComments(fs.readFileSync(p, 'utf8')) : '';
}

const INPUT_RE = /\\input\{([^}]+)\}/g;
// \SurveySignalsAtStart / \SurveySignalsAtEnd place Table IV (tab_signals) by layout.
const WALK_RE = /\\(section|subsection|subsubsection)\*?\{((?:[^{}]|\{[^{}]*\})*)\}|\\input\{([^}]+)\}|\\(?:cite|tabref|citep|citet)\{([^}]+)\}|\\(SurveySignalsAt(?:Start|End))\b/g;
let signalsDone = false;

const body = readTex('sections/body.tex');
const files = [...body.matchAll(INPUT_RE)].map((m) => m[1]);

const cites = [];
let order = 0;
const pos = { sec: '', sub: '', subsub: '', secNo: 0, subNo: 0 };

function walk(text, table = null) {
  const re = new RegExp(WALK_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    if (m[1] === 'section') { pos.sec = m[2]; pos.secNo++; pos.subNo = 0; pos.sub = ''; pos.subsub = ''; }
    else if (m[1] === 'subsection') { pos.sub = m[2]; pos.subNo++; pos.subsub = ''; }
    else if (m[1] === 'subsubsection') { pos.subsub = m[2]; }
    else if (m[3]) {
      const t = m[3];
      if (t.startsWith('tables/')) walk(readTex(t), path.basename(t));
      else if (t.startsWith('figures/') && fs.existsSync(path.join(SRC, t + '.tex'))) walk(readTex(t), path.basename(t));
    } else if (m[5]) {
      if (!signalsDone) { signalsDone = true; walk(readTex('tables/tab_signals'), 'tab_signals'); }
    } else if (m[4]) {
      for (const key of m[4].split(',').map((s) => s.trim()).filter(Boolean)) {
        cites.push({ key, secNo: pos.secNo, sec: pos.sec, subNo: pos.subNo, sub: pos.sub, subsub: pos.subsub, table, order: order++ });
      }
    }
  }
}
for (const f of files) walk(readTex(f));

// ---------- Figure captions ----------
function braced(text, open) {
  let d = 0;
  let k = open;
  for (; k < text.length; k++) {
    if (text[k] === '{') d++;
    else if (text[k] === '}') { d--; if (d === 0) break; }
  }
  return text.slice(open + 1, k);
}

const captions = {};
const FIG_RE = /\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}/g;
const GFX_RE = /(?:includegraphics(?:\[[^\]]*\])?\{|SurveyPortraitFigure\{|\\input\{)(figures\/[^}]+)\}/;
for (const f of files) {
  const t = readTex(f);
  for (const m of t.matchAll(FIG_RE)) {
    const blk = m[0];
    const g = GFX_RE.exec(blk);
    const capAt = blk.indexOf(BS + 'caption{');
    const cap = capAt >= 0 ? braced(blk, capAt + 8) : '';
    const lab = /\\label\{([^}]+)\}/.exec(blk);
    if (g) captions[path.basename(g[1]).replace(/\.pdf$/, '')] = { label: lab && lab[1], caption: cap, file: f };
  }
}

const bib = parseBib(fs.readFileSync(path.join(SRC, 'refs.bib'), 'utf8'));
const missing = [...new Set(cites.map((c) => c.key))].filter((k) => !bib[k]);
fs.writeFileSync(OUT, JSON.stringify({ bib, cites, captions, missing }, null, 1));
console.log('bib entries', Object.keys(bib).length, 'citations', cites.length,
  'unique cited', new Set(cites.map((c) => c.key)).size, 'missing', missing);
