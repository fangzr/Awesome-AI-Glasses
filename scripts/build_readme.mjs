// Build README.md and data/papers.json from the extracted references.
// Usage: node scripts/build_readme.mjs <manuscript-root>
// The manuscript root is needed to re-read the comparison tables.
import fs from 'fs';
import { delatex, firstAuthor, venue } from './latex_utils.mjs';
import { convertTable, toMarkdown } from './tex_tables.mjs';
import { CATEGORIES, HEADER, CHAPTERS, FOOTER, FIGURES } from './readme_content.mjs';

const SRC = process.argv[2];
const { bib, cites } = JSON.parse(fs.readFileSync('data/extracted.json', 'utf8'));
const links = fs.existsSync('data/links_cache.json') ? JSON.parse(fs.readFileSync('data/links_cache.json', 'utf8')) : {};
// Hand-verified links for references the resolver could not match.
const manual = fs.existsSync('data/manual_links.json') ? JSON.parse(fs.readFileSync('data/manual_links.json', 'utf8')) : {};

// ---------- per-reference record ----------
function record(key) {
  const e = bib[key];
  const f = e.fields;
  const L = links[key] || {};
  const M = manual[key] || {};
  const b = L.bib || {};
  const oa = L.openalex || {};
  const arxiv = M.arxiv || L.arxiv || b.arxiv || null;
  const arxivUrl = arxiv ? `https://arxiv.org/abs/${arxiv}` : null;
  const doi = M.doi || b.doi || oa.doi || L.crossref || null;
  // Publisher DOI first, then a bib URL; repository landing pages only as a last resort.
  let paper = null;
  if (doi && !/^10\.48550/i.test(doi)) paper = `https://doi.org/${doi}`;
  else if (M.url || b.url) paper = M.url || b.url;
  else if (!arxiv && oa.landing) paper = oa.landing;
  const hf = L.hf || {};
  const v = venue(e);
  const isPreprint = v === 'arXiv';
  return {
    key,
    title: delatex(f.title),
    // Vendors and organizations are kept whole ("Brilliant Labs", not "Labs").
    authors: (e.type === 'manual' || e.type === 'misc') && !/\sand\s|,/.test(f.author || '')
      ? delatex(f.author || '') : firstAuthor(f.author),
    venue: isPreprint && !arxiv ? 'Preprint' : v,
    year: (f.year || '').replace(/[^0-9]/g, '').slice(0, 4),
    type: e.type === 'manual' || e.type === 'misc' ? 'resource' : 'paper',
    url: (isPreprint && arxivUrl) || paper || arxivUrl,
    links: {
      paper,
      arxiv: arxivUrl,
      code: hf.github || null,
      project: hf.project && hf.project !== hf.github ? hf.project : null,
    },
  };
}

const byKey = new Map();
for (const c of cites) {
  if (!byKey.has(c.key)) byKey.set(c.key, []);
  byKey.get(c.key).push(c);
}
const records = Object.fromEntries([...byKey.keys()].map((k) => [k, record(k)]));

// ---------- placement: one home subsection per reference ----------
function slotOf(c) {
  if (c.table === 'tab_surveys') return 'surveys';
  if (c.table === 'tab_products') return 'products';
  if (c.table === 'tab_platforms') return '6.5';
  if (c.table === 'tab_signals') return '5.1';
  if (c.secNo === 1) return c.subNo === 2 ? 'surveys' : '1';
  if (c.secNo === 2 && c.subNo === 3) return `2.3:${c.subsub || 'intro'}`;
  if (c.secNo === 3 && c.subNo === 0) return '3.1';
  if (c.secNo === 4 && c.subNo === 0) return '4.1';
  if (c.secNo === 5 && c.subNo === 8) return '5.7';
  if (c.secNo === 6 && c.subNo === 6) return '6.3';
  if (c.secNo === 7 && c.subNo >= 3) return '7.3';
  if (c.secNo >= 8) return '8';
  return `${c.secNo}.${c.subNo}`;
}

// Body text outweighs tables; the introduction, open challenges and conclusion
// only decide placement for works cited nowhere else.
const home = {};
for (const [key, cs] of byKey) {
  const e = bib[key];
  const hasArxiv = links[key] && links[key].arxiv;
  if (e.type === 'manual' || (e.type === 'misc' && !hasArxiv)) {
    home[key] = cs.some((c) => c.table === 'tab_platforms') ? 'platforms-docs' : 'products';
    continue;
  }
  if (cs.some((c) => c.table === 'tab_surveys')) { home[key] = 'surveys'; continue; }
  const pick = (list) => {
    const score = new Map();
    for (const c of list) {
      const s = slotOf(c);
      const cur = score.get(s) || { n: 0, first: c.order };
      cur.n += c.table ? 0.5 : 1;
      score.set(s, cur);
    }
    return [...score.entries()].sort((x, y) => y[1].n - x[1].n || x[1].first - y[1].first)[0][0];
  };
  const main = cs.filter((c) => c.secNo >= 2 && c.secNo <= 7);
  home[key] = pick(main.length ? main : cs);
}

// ---------- rendering helpers ----------
function badgeRow(r) {
  const parts = [];
  if (r.links.arxiv) {
    const id = r.links.arxiv.split('/').pop();
    parts.push(`[![arXiv](https://img.shields.io/badge/arXiv-${id}-b31b1b.svg?style=flat-square)](${r.links.arxiv})`);
  }
  if (r.links.code) {
    const m = /github\.com\/([^/]+\/[^/#?]+)/.exec(r.links.code);
    if (m) parts.push(`[![Star](https://img.shields.io/github/stars/${m[1].replace(/\.git$/, '')}.svg?style=social&label=Star)](${r.links.code})`);
    else parts.push(`[Code](${r.links.code})`);
  }
  if (r.links.project) parts.push(`[Project](${r.links.project})`);
  if (r.links.paper) parts.push(`[Paper](${r.links.paper})`);
  return parts.join(' ');
}

function titleCell(r) {
  const url = r.url;
  const t = url ? `[${r.title}](${url})` : r.title;
  return `**${t}**<br><sub>${r.authors}</sub>`;
}

// "paper" link for one-reference cells; short names when a cell lists several works.
function linkFor(key) {
  const r = records[key];
  const url = r && r.url;
  return url ? `[paper](${url})` : '';
}
function shortName(r) {
  const m = /^([^:]{2,30}):/.exec(r.title);
  return m ? m[1].trim() : r.authors || r.title.slice(0, 28);
}
function linkShort(key) {
  const r = records[key];
  if (!r) return '';
  return r.url ? `[${shortName(r)}](${r.url})` : shortName(r);
}

function paperTable(keys) {
  const rs = keys.map((k) => records[k])
    .sort((x, y) => (y.year || '0').localeCompare(x.year || '0') || x.title.localeCompare(y.title));
  const lines = ['| Paper | Venue | Links |', '| :-- | :--: | :-- |'];
  for (const r of rs) lines.push(`| ${titleCell(r)} | ${r.venue}${r.year ? ' ' + r.year : ''} | ${badgeRow(r)} |`);
  return lines.join('\n');
}

function resourceList(keys) {
  return keys.map((k) => records[k]).sort((x, y) => x.title.localeCompare(y.title)).map((r) => {
    const url = r.url;
    return `- ${url ? `[${r.title}](${url})` : r.title}${r.authors ? ` — ${r.authors}` : ''}${r.year ? ` (${r.year})` : ''}`;
  }).join('\n');
}

// ---------- comparison tables from the manuscript ----------
const T = (name, header, pick = null, align = null, lf = linkFor) => () =>
  toMarkdown(header, convertTable(SRC, name, lf), pick, align);
const srcLink = (k) => {
  const r = records[k];
  const url = r && r.url;
  return url ? `[[src]](${url})` : '';
};
const TABLES = {
  surveys: T('tab_surveys', ['Survey', 'First-person sensing', 'External memory', 'Persistent updates', 'Resource costs', 'Evaluation protocols', 'Organizing perspective', 'Link'], null,
    [':--', ':--:', ':--:', ':--:', ':--:', ':--:', ':--', ':--:']),
  products: T('tab_products', ['Product', 'Compute / AI', 'Documented assistance', 'Retained information', 'Sources'], [0, 3, 4, 5, 6], null, srcLink),
  memory: T('tab_memory', ['System', 'Year', 'Input', 'Memory organization', 'Write / update', 'Compute', 'Evaluation', 'Rule', 'Link']),
  signals: T('tab_signals', ['Signal', 'Wearable feedback', 'Cost / caveat', 'Examples'], null, null, linkShort),
  mechanisms: T('tab_mechanisms', ['Method / state', 'Supervision', 'Persistence / use', 'Operating cost', 'Failure to test', 'Examples'], null, null, linkShort),
  platforms: T('tab_platforms', ['Platform', 'Open scope', 'Sensing / execution', 'Memory / updates', 'Reported evidence', 'Link'], null, null, srcLink),
  datasets: T('tab_datasets', ['Dataset', 'Year', 'Capture', 'Reported scale', 'Same-person span', 'Task support', 'Link']),
  benchmarks: T('tab_benchmarks', ['Benchmark', 'FP', 'MS', 'Imp.', 'Main outcome', 'Reported scale', 'Link'], null,
    [':--', ':--:', ':--:', ':--:', ':--', ':--', ':--:']),
  roadmap: T('tab_roadmap', ['Direction', 'Binding problem', 'Useful test', 'Examples'], null, null, linkShort),
};

// ---------- assemble ----------
const plain = (t) => t.replace(/<a id="[^"]*"><\/a>/g, '');
const keysFor = (slot) => Object.keys(home).filter((k) => home[k] === slot);
// Works cited in a subsection's body text but listed under another subsection.
function alsoDiscussed(slots, listedHere) {
  const want = new Set(slots);
  const seen = new Set();
  const out = [];
  for (const c of cites) {
    if (c.table || !want.has(slotOf(c)) || listedHere.has(c.key) || seen.has(c.key)) continue;
    const r = records[c.key];
    if (!r || r.type !== 'paper') continue;
    seen.add(c.key);
    out.push(c.key);
  }
  return out;
}
const used = new Set();
const sections = [];
const toc = [];
const sectionOf = {};

for (const ch of CATEGORIES) {
  toc.push(`- [${plain(ch.title)}](#${ch.anchor})`);
  const parts = [`## ${ch.title}`, ''];
  if (ch.lead) parts.push(ch.lead, '');
  if (ch.figure) {
    const fg = FIGURES[ch.figure];
    parts.push(`<p align="center"><img src="assets/${fg.file}" width="${fg.width || '100%'}" alt="${fg.alt}"></p>`, '');
    parts.push(`<p align="center"><sub><b>${fg.label}.</b> ${fg.caption}</sub></p>`, '');
  }
  (ch.tableIds || []).forEach((id, i) => {
    const meta = (ch.tableMeta || [])[i] || {};
    const table = TABLES[id]();
    if (meta.anchor) toc.push(`  - [${plain(meta.title)}](#${meta.anchor})`);
    if (meta.collapsed) {
      parts.push(`### ${meta.title}`, '', meta.lead || '', '', '<details><summary>Show table</summary>', '', table, '', '</details>', '');
    } else {
      if (meta.title) parts.push(`### ${meta.title}`, '');
      if (meta.lead) parts.push(meta.lead, '');
      parts.push(table, '');
    }
  });
  for (const sub of ch.subs || []) {
    const ks = [].concat(...sub.slots.map(keysFor)).filter((k) => !used.has(k));
    ks.forEach((k) => { used.add(k); sectionOf[k] = { chapter: plain(ch.title).replace(/^\S+\s/, ''), section: plain(sub.title) }; });
    const also = sub.resources ? [] : alsoDiscussed(sub.alsoSlots || sub.slots, new Set(ks));
    if (!ks.length && !also.length) continue;
    toc.push(`  - [${plain(sub.title)}](#${sub.anchor})${ks.length ? ` (${ks.length})` : ''}`);
    parts.push(`### ${sub.title}`, '');
    if (sub.lead) parts.push(sub.lead, '');
    if (also.length) parts.push(`<sub>**${ks.length ? 'Also discussed here' : 'Discussed here (listed in other sections)'}:** ${also.map(linkShort).join(' · ')}</sub>`, '');
    if (ks.length) parts.push(sub.resources ? resourceList(ks) : paperTable(ks), '');
  }
  parts.push('<p align="right"><a href="#top">⬆ back to top</a></p>', '');
  sections.push(parts.join('\n'));
}

const unplaced = Object.keys(home).filter((k) => !used.has(k));
if (unplaced.length) console.warn('UNPLACED', unplaced.map((k) => `${k}:${home[k]}`).join(', '));

const all = Object.values(records);
const nRefs = all.length;
const nCode = all.filter((r) => r.links.code).length;
const md = [
  HEADER({ nRefs, nCode }),
  CHAPTERS,
  '## <a id="contents"></a>📑 Contents',
  '',
  '<details open><summary>Expand / collapse</summary>',
  '',
  toc.join('\n'),
  '',
  '</details>',
  '',
  ...sections,
  FOOTER,
].join('\n');
fs.writeFileSync('README.md', md.replace(/\n{3,}/g, '\n\n'));

const out = all.map((r) => ({ ...r, ...(sectionOf[r.key] || {}) })).sort((x, y) => x.key.localeCompare(y.key));
fs.writeFileSync('data/papers.json', JSON.stringify(out, null, 2) + '\n');
console.log('references', nRefs, 'papers', all.filter((r) => r.type === 'paper').length, 'with code', nCode,
  'with any link', all.filter((r) => r.links.paper || r.links.arxiv).length,
  'without link', all.filter((r) => !(r.links.paper || r.links.arxiv)).map((r) => r.key).join(','));
