// Gera dist/stats.svg: commits em todos os repositórios a que o token tem acesso,
// públicos e privados, meus e de organizações, sem nomes de repositório privado.
// node scripts/stats.mjs  (GITHUB_TOKEN precisa de repo + read:org para ver os privados;
// na Action ele vem do segredo STATS_TOKEN)
import { mkdirSync, writeFileSync } from 'node:fs';

const USER = 'EduardoMG12';
const TOP = 7;
const COLORS = {
  TypeScript: '#3178c6', Go: '#00add8', Rust: '#dea584', Java: '#b07219', Python: '#3572a5',
  HTML: '#e34c26', Dart: '#00b4ab', CSS: '#663399', Shell: '#89e051', 'C++': '#f34b7d',
  JavaScript: '#f1e05a', PHP: '#4f5d95', C: '#555555', 'C#': '#178600', Kotlin: '#a97bff',
  'Jupyter Notebook': '#da5b0b', Dockerfile: '#384d54', SCSS: '#c6538c', Vue: '#41b883', Swift: '#f05138',
};
const color = name => COLORS[name] || '#6b7280';
// Linguagens que não dizem nada sobre o trabalho: marcação, estilo, notebooks gerados.
const IGNORE = new Set(['HTML', 'CSS', 'SCSS', 'Jupyter Notebook', 'Makefile', 'Procfile', 'Batchfile']);

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': USER, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, { retry202 = false } = {}) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url.startsWith('http') ? url : `https://api.github.com/${url}`, { headers });
    // As estatísticas de contribuidores são calculadas sob demanda: 202 até ficarem prontas.
    if (r.status === 202 && retry202) { await sleep(1500 * (i + 1)); continue; }
    if ([202, 204, 403, 404, 409, 451].includes(r.status)) return null;
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return { data: await r.json(), link: r.headers.get('link') };
  }
  return null;
}
async function all(url) {
  const out = [];
  for (let next = url; next;) {
    const r = await get(next);
    if (!r) break;
    out.push(...r.data);
    next = r.link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  return out;
}

// Repositórios: os meus, onde colaboro e os das organizações de que faço parte. Forks ficam de fora.
// Sem um token pessoal (o GITHUB_TOKEN das Actions não lista /user/repos), só os públicos.
let repos = await all('user/repos?per_page=100&affiliation=owner,collaborator,organization_member');
if (!repos.length) repos = await all(`users/${USER}/repos?per_page=100&type=owner`);
repos = repos.filter(r => !r.fork);
const withPrivate = repos.some(r => r.private);

const yearAgo = Date.now() / 1000 - 365 * 86400;
const byYear = {}, byLang = {}, owners = new Set();
let total = 0, lastYear = 0, touched = 0, orgs = 0;
// Em paralelo, poucos de cada vez: a API calcula as estatísticas sob demanda.
const queue = [...repos];
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let repo; (repo = queue.shift());) {
    const stats = await get(`repos/${repo.full_name}/stats/contributors`, { retry202: true });
    const me = Array.isArray(stats?.data) ? stats.data.find(c => c.author?.login === USER) : null;
    if (!me || !me.total) continue;
    touched++;
    total += me.total;
    if (repo.owner.type === 'Organization') { orgs += me.total; owners.add(repo.owner.login); }
    for (const w of me.weeks) {
      if (!w.c) continue;
      const y = new Date(w.w * 1000).getUTCFullYear();
      byYear[y] = (byYear[y] || 0) + w.c;
      if (w.w >= yearAgo) lastYear += w.c;
    }
    // Linguagens pesadas pelos meus commits: a fatia de cada linguagem no repo vezes os commits que fiz nele.
    const langs = (await get(`repos/${repo.full_name}/languages`))?.data || {};
    const kept = Object.entries(langs).filter(([l]) => !IGNORE.has(l));
    const sum = kept.reduce((a, [, n]) => a + n, 0);
    for (const [l, n] of kept) byLang[l] = (byLang[l] || 0) + (n / sum) * me.total;
  }
}));

const shares = totals => {
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([name, n]) => ({ name, pct: (n / sum) * 100 }));
  const other = 100 - top.reduce((a, l) => a + l.pct, 0);
  if (other > 0.05) top.push({ name: 'Other', pct: other });
  return top;
};
const fmt = n => Math.round(n).toLocaleString('en-US');

const W = 880, PAD = 32, inner = W - PAD * 2;
const out = [];
let y = 0;

out.push(`<text x="${PAD}" y="44" class="title">Engineering activity</text>`);
out.push(`<text x="${W - PAD}" y="44" class="sub" text-anchor="end">${withPrivate ? 'PUBLIC + PRIVATE REPOS, INCL. ORGANIZATIONS' : 'PUBLIC REPOS'}</text>`);

// Números
const tiles = [
  [fmt(total), 'commits', 'all time'],
  [fmt(lastYear), 'commits', 'last 12 months'],
  [fmt(touched), 'repositories', 'with my commits'],
  [fmt(owners.size), 'organizations', 'committed to'],
];
const COLS = 4, tileW = (inner - 12 * (COLS - 1)) / COLS;
y = 68;
tiles.forEach(([value, label, note], i) => {
  const x = PAD + i * (tileW + 12);
  out.push(`<rect x="${x}" y="${y}" width="${tileW}" height="98" rx="10" fill="#111c33" stroke="#1f2a44"/>`);
  out.push(`<text x="${x + 18}" y="${y + 40}" class="value">${value}</text>`);
  out.push(`<text x="${x + 18}" y="${y + 62}" class="label">${label}</text>`);
  out.push(`<text x="${x + 18}" y="${y + 82}" class="note">${note}</text>`);
});
y += 98;

// Commits por ano (colunas) ao lado de organizações × projetos pessoais
y += 44;
const top = y;
out.push(`<text x="${PAD}" y="${y}" class="h">Commits per year</text>`);
const years = Object.keys(byYear).map(Number).sort();
const chartW = inner * 0.58, chartH = 96, base = y + 30 + chartH;
const max = Math.max(...years.map(k => byYear[k]));
const colW = chartW / years.length;
years.forEach((yr, i) => {
  const h = Math.max(2, (byYear[yr] / max) * chartH);
  const x = PAD + i * colW + colW * 0.18, w = colW * 0.64;
  out.push(`<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${i === years.length - 1 ? '#5b8cff' : '#2c4a8f'}"/>`);
  out.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(base - h - 7).toFixed(1)}" class="pct" text-anchor="middle">${fmt(byYear[yr])}</text>`);
  out.push(`<text x="${(x + w / 2).toFixed(1)}" y="${base + 18}" class="name" text-anchor="middle">${yr}</text>`);
});
const sx = PAD + chartW + 40, sw = inner - chartW - 40;
const orgPct = total ? (orgs / total) * 100 : 0;
out.push(`<text x="${sx}" y="${top}" class="h">Where the commits go</text>`);
const split = [['Organizations', orgPct, '#8b5cf6'], ['Personal projects', 100 - orgPct, '#22c3a6']];
out.push(`<clipPath id="split"><rect x="${sx}" y="${top + 22}" width="${sw}" height="10" rx="5"/></clipPath><g clip-path="url(#split)">`);
out.push(`<rect x="${sx}" y="${top + 22}" width="${(sw * orgPct / 100).toFixed(1)}" height="10" fill="${split[0][2]}"/>`);
out.push(`<rect x="${(sx + sw * orgPct / 100).toFixed(1)}" y="${top + 22}" width="${(sw * (1 - orgPct / 100)).toFixed(1)}" height="10" fill="${split[1][2]}"/></g>`);
split.forEach(([name, pct, c], i) => {
  const ly = top + 62 + i * 26;
  out.push(`<circle cx="${sx + 5}" cy="${ly - 5}" r="5" fill="${c}"/>`);
  out.push(`<text x="${sx + 17}" y="${ly}" class="name">${name}</text>`);
  out.push(`<text x="${sx + sw}" y="${ly}" class="pct" text-anchor="end">${pct.toFixed(1)}%</text>`);
});
y = base + 18;

// Linguagens pelos meus commits
y += 44;
out.push(`<text x="${PAD}" y="${y}" class="h">Languages I commit in</text>`);
out.push(`<text x="${W - PAD}" y="${y}" class="note" text-anchor="end">each repo's language mix, weighted by my commits to it</text>`);
y += 16;
const langs = shares(byLang);
out.push(`<clipPath id="langs"><rect x="${PAD}" y="${y}" width="${inner}" height="10" rx="5"/></clipPath><g clip-path="url(#langs)">`);
let x = PAD;
for (const l of langs) {
  const w = (l.pct / 100) * inner;
  out.push(`<rect x="${x.toFixed(2)}" y="${y}" width="${(w + 0.5).toFixed(2)}" height="10" fill="${color(l.name)}"/>`);
  x += w;
}
out.push('</g>');
y += 10;
const lcol = inner / 4;
langs.forEach((l, i) => {
  const lx = PAD + (i % 4) * lcol, ly = y + 30 + Math.floor(i / 4) * 26;
  out.push(`<circle cx="${lx + 5}" cy="${ly - 5}" r="5" fill="${color(l.name)}"/>`);
  out.push(`<text x="${lx + 17}" y="${ly}" class="name">${l.name}</text>`);
  out.push(`<text x="${lx + lcol - 28}" y="${ly}" class="pct" text-anchor="end">${l.pct.toFixed(1)}%</text>`);
});
y += 30 + (Math.ceil(langs.length / 4) - 1) * 26;
const H = y + 30;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Commit activity for ${USER} across public and private repositories, by year, by organization and by language">
<style>
  text { font-family: 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif; }
  .title { font-size: 19px; font-weight: 600; fill: #e6edf3; }
  .h { font-size: 14px; font-weight: 600; fill: #e6edf3; }
  .sub, .note { font-size: 11px; fill: #7d8590; letter-spacing: .04em; }
  .value { font-size: 26px; font-weight: 700; fill: #e6edf3; }
  .label { font-size: 13px; fill: #8b949e; }
  .name { font-size: 13px; fill: #c9d1d9; }
  .pct { font-size: 12px; fill: #8b949e; font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace; }
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" fill="#0b1324" stroke="#1f2a44"/>
${out.join('\n')}
</svg>
`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/stats.svg', svg);
console.log(`ok repos=${repos.length} touched=${touched} total=${total} lastYear=${lastYear} orgs=${owners.size} orgShare=${orgPct.toFixed(1)}%`);
console.log(Object.entries(byYear).map(([k, v]) => `${k}:${v}`).join(' '));
console.log(langs.map(l => `${l.name} ${l.pct.toFixed(1)}%`).join(', '));
