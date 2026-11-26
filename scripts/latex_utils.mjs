// Small LaTeX-to-Markdown helpers shared by the README generator.

const ACCENTS = {
  '"a': 'ä', '"o': 'ö', '"u': 'ü', '"A': 'Ä', '"O': 'Ö', '"U': 'Ü', '"e': 'ë', '"i': 'ï',
  "'a": 'á', "'e": 'é', "'i": 'í', "'o": 'ó', "'u": 'ú', "'c": 'ć', "'n": 'ń', "'s": 'ś', "'y": 'ý', "'z": 'ź', "'E": 'É',
  '`a': 'à', '`e': 'è', '`o': 'ò', '`u': 'ù', '^a': 'â', '^e': 'ê', '^o': 'ô', '^i': 'î', '~n': 'ñ', '~a': 'ã', '~o': 'õ',
  'ca': 'ą', 'cc': 'ç', 'vc': 'č', 'vs': 'š', 'vz': 'ž', 'vr': 'ř', 'ss': 'ß', 'o': 'ø', 'l': 'ł', 'aa': 'å',
};

export function delatex(s = '') {
  let t = String(s);
  t = t.replace(/\s*\(?(?:Section|Sec\.|Table|Fig\.)~?\\ref\{[^}]*\}\)?/g, '').replace(/~?\\(?:ref|label)\{[^}]*\}/g, '');
  t = t.replace(/\\(["'`^~])\{?\\?([a-zA-Z])\}?/g, (m, a, c) => ACCENTS[a + c] || c);
  t = t.replace(/\\([cv])\{([a-zA-Z])\}/g, (m, a, c) => ACCENTS[a + c] || c);
  t = t.replace(/\{\\(ss|o|l|aa)\}/g, (m, a) => ACCENTS[a]);
  t = t.replace(/\\(?:textbf|textit|emph|textsc|texttt|mathrm|mathbf|text|textsf)\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '$2');
  t = t.replace(/\\url\{([^}]*)\}/g, '$1');
  t = t.replace(/\$>\$/g, '>').replace(/\$<\$/g, '<').replace(/\$\\sim\$/g, '~').replace(/\$\\times\$/g, '×');
  t = t.replace(/\$\\rightarrow\$/g, '→').replace(/\$\\leftrightarrow\$/g, '↔').replace(/\$\^\*\$/g, '*').replace(/\$\^\\dagger\$/g, '†');
  t = t.replace(/\$([^$]*)\$/g, (m, x) => x.replace(/\\[a-zA-Z]+/g, '').replace(/[{}^_]/g, ''));
  t = t.replace(/\\(?:newline|\\)/g, ' ').replace(/~/g, ' ').replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/\\_/g, '_');
  t = t.replace(/\\etal\b/g, 'et al.').replace(/\\textendash\b|--/g, '–').replace(/\\textemdash\b/g, '—');
  t = t.replace(/\\[a-zA-Z]+\*?/g, '').replace(/[{}]/g, '');
  return t.replace(/\s+/g, ' ').trim();
}

export function firstAuthor(authors = '') {
  const list = authors.split(/\s+and\s+/).map((a) => a.trim()).filter(Boolean);
  if (!list.length) return '';
  const a = delatex(list[0]);
  const last = a.includes(',') ? a.split(',')[0].trim() : a.split(/\s+/).slice(-1)[0];
  const isOrg = !a.includes(',') && a.split(/\s+/).length > 3;
  if (isOrg) return a;
  return list.length > 1 ? `${last} et al.` : last;
}

const JOURNALS = [
  [/IEEE Trans(?:actions)?\.? (?:on )?Pattern Anal/i, 'TPAMI'],
  [/Trans(?:actions)?\.? Mach(?:ine)?\.? Learn(?:ing)?\.? Res/i, 'TMLR'],
  [/Int(?:ernational)?\.? J(?:ournal)?\.? (?:of )?Comput(?:er)?\.? Vis/i, 'IJCV'],
  [/Interact\.? Mob\.? Wearable Ubiquitous/i, 'IMWUT'],
  [/Commun(?:ications)?\.? (?:of the )?ACM/i, 'CACM'],
  [/^Proc\.? IEEE$/i, 'Proc. IEEE'],
  [/IEEE Transactions on Mobile Computing|IEEE Trans\.? Mobile Comput/i, 'TMC'],
  [/IEEE\/ACM Transactions on Networking|IEEE\/ACM Trans\.? Netw/i, 'ToN'],
  [/IEEE Journal on Selected Areas in Communications|IEEE J\.? Sel\.? Areas Commun/i, 'JSAC'],
  [/IEEE Transactions on Network Science/i, 'TNSE'],
  [/IEEE Commun\.? Surveys/i, 'COMST'],
  [/IEEE Commun\.? Mag/i, 'IEEE Commun. Mag.'],
  [/IEEE Trans\.? Vis\.? Comput\.? Graph/i, 'TVCG'],
  [/IEEE Trans\.? Circuits Syst\.? Video/i, 'TCSVT'],
  [/IEEE Trans\.? Multimedia/i, 'TMM'],
  [/Trans\.? Assoc\.? Comput\.? Linguist/i, 'TACL'],
  [/Mach\.? Intell\.? Res/i, 'MIR'],
  [/Found(?:ations)?\.? (?:and )?Trends/i, 'FnT'],
  [/Distributed Computing Systems/i, 'ICDCS'],
  [/Advances in Neural Information Processing Systems/i, 'NeurIPS'],
  [/International Conference on Machine Learning/i, 'ICML'],
  [/Computer Vision -- ECCV/i, 'ECCV'],
  [/Proc\.? Nat\.? Acad/i, 'PNAS'],
  [/IEEE Int\.? Conf\.? Big Data/i, 'IEEE BigData'],
];

export function venue(entry) {
  const f = entry.fields;
  const raw = f.booktitle || f.journal || '';
  if (/arXiv/i.test(raw) || (!raw && /arXiv/i.test(f.note || f.howpublished || ''))) return 'arXiv';
  if (entry.type === 'manual' || entry.type === 'misc') {
    if (/github/i.test(f.howpublished || f.url || '')) return 'GitHub';
    return 'Web';
  }
  const paren = /\(([A-Za-z][A-Za-z0-9&\- ]{1,14})\)\s*(Datasets Benchmarks Track)?/.exec(raw);
  if (paren) return paren[1] + (paren[2] ? ' D&B' : '');
  if (/Findings.*EMNLP/i.test(raw)) return 'Findings of EMNLP';
  for (const [re, ab] of JOURNALS) if (re.test(raw)) return ab;
  return delatex(raw).replace(/^Proc(?:eedings)?\.? (?:of the )?/i, '');
}
