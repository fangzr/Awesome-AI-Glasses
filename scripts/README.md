# Scripts

The paper tables in the main README are generated from the survey's LaTeX sources.

```bash
# 1. Extract references, citation placement, and figure captions
node scripts/extract_from_tex.mjs <manuscript-root> data/extracted.json
# 2. Resolve paper / arXiv / code / project links (cached in data/links_cache.json)
node scripts/resolve_links.mjs data/extracted.json data/links_cache.json
# 3. Build README.md and data/papers.json
node scripts/build_readme.mjs <manuscript-root>
```

Each reference is placed once, under the subsection whose body text cites it most often.
Code links come from the paper's Hugging Face page when one is listed. Hand-written prose
lives in `scripts/readme_content.mjs`.
