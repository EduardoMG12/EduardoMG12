// Gera dist/stats.svg: números do último ano, linguagens por volume de código e commits por linguagem.
// node scripts/stats.mjs  (precisa de GITHUB_TOKEN para a API GraphQL)
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

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': USER, Authorization: `Bearer ${process.env.GITHUB_TOKEN}` };
const rest = async url => {
  const r = await fetch(`https://api.github.com/${url}`, { headers });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
const graphql = async query => {
  const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
};

// Linguagens: bytes somados de todos os repositórios públicos que não são fork.
const repos = (await rest(`users/${USER}/repos?per_page=100&type=owner`)).filter(r => !r.fork && !r.archived);
const bytes = {};
for (const r of repos) {
  for (const [lang, n] of Object.entries(await rest(`repos/${USER}/${r.name}/languages`))) bytes[lang] = (bytes[lang] || 0) + n;
}

// Últimos 12 meses: contribuições e commits públicos agrupados pela linguagem principal do repositório.
const { user } = await graphql(`{
  user(login: "${USER}") {
    contributionsCollection {
      totalCommitContributions restrictedContributionsCount totalPullRequestContributions
      contributionCalendar { totalContributions }
      commitContributionsByRepository(maxRepositories: 100) {
        repository { primaryLanguage { name } }
        contributions { totalCount }
      }
    }
  }
}`);
const cc = user.contributionsCollection;
const commits = {};
for (const { repository, contributions } of cc.commitContributionsByRepository) {
  const lang = repository.primaryLanguage?.name;
  if (lang) commits[lang] = (commits[lang] || 0) + contributions.totalCount;
}

const shares = totals => {
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([name, n]) => ({ name, pct: (n / sum) * 100 }));
  const other = 100 - top.reduce((a, l) => a + l.pct, 0);
  if (other > 0.05) top.push({ name: 'Other', pct: other });
  return top;
};
const fmt = n => n.toLocaleString('en-US');

const W = 880, PAD = 32, COLS = 4;
const inner = W - PAD * 2;
let y = 0;
const out = [];

// Cabeçalho
out.push(`<text x="${PAD}" y="44" class="title">GitHub activity</text>`);
out.push(`<text x="${W - PAD}" y="44" class="sub" text-anchor="end">LAST 12 MONTHS · UPDATED DAILY</text>`);

// Números
const stats = [
  [fmt(cc.contributionCalendar.totalContributions), 'contributions', 'incl. private work'],
  [fmt(cc.totalCommitContributions), 'public commits', ''],
  [fmt(cc.totalPullRequestContributions), 'pull requests', ''],
  [fmt(repos.length), 'public repos', 'original, no forks'],
];
const tileW = (inner - 12 * (COLS - 1)) / COLS;
y = 68;
stats.forEach(([value, label, note], i) => {
  const x = PAD + i * (tileW + 12);
  out.push(`<rect x="${x}" y="${y}" width="${tileW}" height="98" rx="10" fill="#111c33" stroke="#1f2a44"/>`);
  out.push(`<text x="${x + 18}" y="${y + 40}" class="value">${value}</text>`);
  out.push(`<text x="${x + 18}" y="${y + 62}" class="label">${label}</text>`);
  if (note) out.push(`<text x="${x + 18}" y="${y + 82}" class="note">${note}</text>`);
});
y += 98;

// Barra empilhada + legenda
const section = (title, note, langs) => {
  y += 44;
  out.push(`<text x="${PAD}" y="${y}" class="h">${title}</text>`);
  out.push(`<text x="${W - PAD}" y="${y}" class="note" text-anchor="end">${note}</text>`);
  y += 16;
  const id = `c${y}`;
  out.push(`<clipPath id="${id}"><rect x="${PAD}" y="${y}" width="${inner}" height="10" rx="5"/></clipPath><g clip-path="url(#${id})">`);
  let x = PAD;
  for (const l of langs) {
    const w = (l.pct / 100) * inner;
    out.push(`<rect x="${x.toFixed(2)}" y="${y}" width="${(w + 0.5).toFixed(2)}" height="10" fill="${color(l.name)}"/>`);
    x += w;
  }
  out.push('</g>');
  y += 10;
  const colW = inner / COLS;
  langs.forEach((l, i) => {
    const lx = PAD + (i % COLS) * colW, ly = y + 30 + Math.floor(i / COLS) * 26;
    out.push(`<circle cx="${lx + 5}" cy="${ly - 5}" r="5" fill="${color(l.name)}"/>`);
    out.push(`<text x="${lx + 17}" y="${ly}" class="name">${l.name}</text>`);
    out.push(`<text x="${lx + colW - 28}" y="${ly}" class="pct" text-anchor="end">${l.pct.toFixed(1)}%</text>`);
  });
  y += 30 + (Math.ceil(langs.length / COLS) - 1) * 26;
};
section('Languages by code', 'bytes across public repos', shares(bytes));
section('Commits by language', 'public commits, by repo language', shares(commits));
const H = y + 30;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub activity and language breakdown for ${USER}">
<style>
  text { font-family: 'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif; }
  .title { font-size: 19px; font-weight: 600; fill: #e6edf3; }
  .h { font-size: 14px; font-weight: 600; fill: #e6edf3; }
  .sub, .note { font-size: 11px; fill: #7d8590; letter-spacing: .06em; }
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
console.log('ok', stats.map(s => `${s[1]}=${s[0]}`).join(' '));
