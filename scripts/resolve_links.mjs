// Resolve paper, arXiv, code and project links for every extracted reference.
// Sources, in order: BibTeX fields; Hugging Face paper search (arXiv ID);
// arXiv API title search; Crossref (publisher DOI); Hugging Face paper page
// (GitHub repository and project page). OpenAlex results from earlier runs are kept.
// Each source is cached per entry in data/links_cache.json, so reruns only query
// what is still missing.
// Usage: node scripts/resolve_links.mjs [data/extracted.json] [data/links_cache.json]
import fs from 'fs';

const IN = process.argv[2] || 'data/extracted.json';
const CACHE = process.argv[3] || 'data/links_cache.json';
const { bib, cites } = JSON.parse(fs.readFileSync(IN, 'utf8'));
const manual = fs.existsSync('data/manual_links.json') ? JSON.parse(fs.readFileSync('data/manual_links.json', 'utf8')) : {};
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'awesome-list-link-resolver/1.0' };

function cleanTitle(t) {
  return t
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
    .replace(/\\["'`^~=.]\{?([a-zA-Z])\}?/g, '$1')
    .replace(/\\&/g, '&')
    .replace(/---?/g, '-')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const norm = (s) => cleanTitle(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function similar(a, b) {
  const A = new Set(norm(a).split(' '));
  const B = new Set(norm(b).split(' '));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size, 1);
}

async function get(url, as = 'json') {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (r.status === 429) { await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) { await sleep(1500); continue; }
      return as === 'json' ? await r.json() : await r.text();
    } catch { await sleep(1500); }
  }
  return null;
}

function fromBib(f) {
  const s = Object.values(f).join(' ');
  const ax = /arXiv[:\s]*([0-9]{4}\.[0-9]{4,5})/i.exec(s) || /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})/i.exec(s);
  const urlField = f.url || (/\\url\{([^}]+)\}/.exec(f.howpublished || '') || /\\url\{([^}]+)\}/.exec(f.note || '') || /\\href\{([^}]+)\}/.exec(f.howpublished || '') || [])[1];
  const bare = /(https?:\/\/[^\s}]+)/.exec(f.howpublished || f.note || '');
  return { arxiv: ax ? ax[1] : null, doi: f.doi || null, url: urlField || (bare ? bare[1] : null) };
}

async function hfSearch(title) {
  const j = await get(`https://huggingface.co/api/papers/search?q=${encodeURIComponent(cleanTitle(title))}`);
  if (!Array.isArray(j)) return null;
  for (const it of j.slice(0, 5)) {
    const p = it.paper || it;
    if (p && p.id && p.title && similar(title, p.title) >= 0.9) return p.id;
  }
  return null;
}

async function arxivSearch(title) {
  const t = cleanTitle(title).replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const xml = await get(`https://export.arxiv.org/api/query?search_query=ti:%22${encodeURIComponent(t)}%22&max_results=3`, 'text');
  if (!xml) return null;
  for (const e of xml.split('<entry>').slice(1)) {
    const id = /<id>https?:\/\/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5})/.exec(e);
    const tt = /<title>([\s\S]*?)<\/title>/.exec(e);
    if (id && tt && similar(title, tt[1]) >= 0.9) return id[1];
  }
  return null;
}

async function crossref(title, year) {
  const q = encodeURIComponent(cleanTitle(title));
  const j = await get(`https://api.crossref.org/works?query.bibliographic=${q}&rows=5&select=DOI,title,issued,type`);
  const items = j && j.message && j.message.items;
  if (!items) return null;
  for (const it of items) {
    const t = (it.title || [])[0];
    const y = it.issued && it.issued['date-parts'] && it.issued['date-parts'][0][0];
    if (!t || /^10\.48550/.test(it.DOI) || it.type === 'posted-content') continue;
    if (similar(title, t) >= 0.92 && (!year || !y || Math.abs(Number(year) - y) <= 1)) return it.DOI;
  }
  return null;
}

async function hfPaper(id) {
  const j = await get(`https://huggingface.co/api/papers/${id}`);
  if (!j) return { github: null, project: null };
  return { github: j.githubRepo || null, stars: j.githubStars || null, project: j.projectPage || null };
}

const isPreprintVenue = (f) => /arXiv/i.test(f.journal || f.booktitle || '') || (!f.journal && !f.booktitle);
const keys = [...new Set(cites.map((c) => c.key))];
let n = 0;
for (const key of keys) {
  n++;
  const e = bib[key];
  if (!e) continue;
  const f = e.fields;
  const rec = cache[key] || {};
  rec.bib = fromBib(f);
  const isDoc = e.type === 'manual' || (e.type === 'misc' && !rec.bib.arxiv && rec.bib.url);
  if (!isDoc) {
    let arxiv = (manual[key] && manual[key].arxiv) || rec.bib.arxiv || (rec.openalex && rec.openalex.arxiv) || rec.hfSearch || rec.arxivSearch || null;
    if (!arxiv && rec.hfSearch === undefined) { rec.hfSearch = await hfSearch(f.title); arxiv = rec.hfSearch; await sleep(200); }
    if (!arxiv && rec.arxivSearch === undefined) { rec.arxivSearch = await arxivSearch(f.title); arxiv = rec.arxivSearch; await sleep(3100); }
    rec.arxiv = arxiv || null;
    const hasDoi = rec.bib.doi || (rec.openalex && rec.openalex.doi);
    if (!hasDoi && !isPreprintVenue(f) && rec.crossref === undefined) { rec.crossref = await crossref(f.title, f.year); await sleep(200); }
    if (rec.arxiv && (!rec.hf || rec.hfFor !== rec.arxiv)) { rec.hf = await hfPaper(rec.arxiv); rec.hfFor = rec.arxiv; await sleep(200); }
  }
  delete rec.done;
  cache[key] = rec;
  if (n % 10 === 0) {
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
    console.log(`${n}/${keys.length}`);
  }
}
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
const vals = keys.map((k) => cache[k]).filter(Boolean);
console.log('done', vals.length, 'arxiv', vals.filter((v) => v.arxiv).length,
  'github', vals.filter((v) => v.hf && v.hf.github).length,
  'doi', vals.filter((v) => v.bib.doi || (v.openalex && v.openalex.doi) || v.crossref).length);
