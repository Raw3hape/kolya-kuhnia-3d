// Сборка статики для хостинга (Vercel): web/ -> dist/, index.html оборачивается каркасом tools/skeleton.html
// (тем же, что добавляет локальный tools/serve.py). Запуск: node tools/build_static.mjs
// Без сервера кнопки «Снимок PNG» и «Модель GLB» не пишут в exports/, а скачивают файл в браузере.
//
// Что сборка добавляет в dist/index.html (локально, через serve.py, этого нет — приложение работает и без):
// 1. Версии ассетов: для каждой папки внутри textures/ и models/ — короткий хеш её файлов и средний размер файла (КБ).
//    Карта { папка: "хеш/КБ" } — <script type="application/json" id="asset-versions">; загрузчики дописывают ?v=<хеш>
//    (web/js/loading.js assetUrl), а vercel.json отдаёт такие адреса с кешем на год: поменялся файл — поменялся адрес.
//    Размер — вес файла в полосе загрузки (loading.js weightOf).
// 2. Мелкие данные текстур прямо в странице (id="asset-index", loading.js assetIndex): textures/sizes.json и все
//    textures/**/meta.json — вместо полутора десятков запросов до первого кадра.
// 3. Подсказки браузеру, что качать сразу, а не по цепочке: <link rel="modulepreload"> на весь граф модулей
//    (свои js/ и локальный three — обход import от js/main.js, адреса через import map страницы) и
//    <link rel="preload" as="fetch"> на все spec/**/*.json. Без них модули и спеки шли волнами по 5–7 круговых задержек.
//    Модули с CDN обходятся по сети; нет сети — их зависимости второго уровня просто не попадут в список.
// 4. js/*.js сжимаются esbuild (каждый файл отдельно, модули и импорты те же; комментарии — в web/, не в dist/):
//    программа ≈400 → 250 КБ по сети. Нет esbuild (npm install не делали) — файлы идут как есть.
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web'), dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
cpSync(web, dist, { recursive: true, filter: src => !src.endsWith('.DS_Store') });

// ---------- 1. версии и размеры ----------
const BINARY = /\.(jpe?g|png|webp|glb|hdr)$/i;
const versions = {};
function hashDirs(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const h = createHash('sha1');
  let files = 0, bin = 0, binBytes = 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { hashDirs(p); continue; }
    const data = readFileSync(p);
    h.update(e.name).update('\0').update(data); files++;
    if (BINARY.test(e.name) && e.name !== 'thumb.jpg') { bin++; binBytes += data.length; }   // миниатюры в 3D не грузятся
  }
  if (files) versions[relative(dist, dir).split('\\').join('/')] = h.digest('hex').slice(0, 10) + (bin ? `/${Math.max(1, Math.round(binBytes / bin / 1024))}` : '');
}
for (const d of ['textures', 'models']) hashDirs(join(dist, d));

// ---------- 2. sizes.json и meta.json текстур ----------
const meta = {};
(function metas(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) metas(p);
    else if (e.name === 'meta.json') {
      try { meta[relative(join(dist, 'textures'), dir).split('\\').join('/')] = JSON.parse(readFileSync(p, 'utf8')); } catch { /* битый — грузится сам */ }
    }
  }
})(join(dist, 'textures'));
let sizes = null;
try { sizes = JSON.parse(readFileSync(join(dist, 'textures', 'sizes.json'), 'utf8')); } catch { /* нет — materials.js спросит сам */ }
const index = { ...(sizes ? { sizes } : {}), meta };

// ---------- 3. подсказки: граф модулей и спеки ----------
const body = readFileSync(join(web, 'index.html'), 'utf8');
const importMap = (() => {
  const m = body.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  try { return m ? JSON.parse(m[1]).imports || {} : {}; } catch { return {}; }
})();
function resolveSpec(spec, base) {
  if (spec.includes('${')) return null;   // шаблон в строке (исходник воркера в render.js), не импорт
  if (/^(\.{0,2}\/|https?:)/.test(spec)) return new URL(spec, base).href;
  if (importMap[spec]) return importMap[spec];
  const pre = Object.keys(importMap).filter(k => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return pre ? importMap[pre] + spec.slice(pre.length) : null;
}
// Статические import/export … from '…' и import '…' (динамический import(…) не трогаем: он нарочно ленивый)
const IMPORT_RE = /(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?['"]([^'"\n]+)['"]/g;
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const SITE = 'https://site.invalid/';
async function source(url) {
  if (url.startsWith(SITE)) {
    const f = join(web, decodeURIComponent(url.slice(SITE.length)));
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}
const graph = [];
const seen = new Set();
async function crawl(url) {
  if (seen.has(url)) return;
  seen.add(url);
  const src = await source(url);
  if (src == null) return;
  graph.push(url);
  const deps = [...stripComments(src).matchAll(IMPORT_RE)].map(m => resolveSpec(m[1], url)).filter(Boolean);
  await Promise.all(deps.map(crawl));
}
await crawl(SITE + 'js/main.js');
const modules = graph.filter(u => u !== SITE + 'js/main.js').map(u => (u.startsWith(SITE) ? u.slice(SITE.length) : u));
const specs = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) specs.push(relative(web, p).split('\\').join('/'));
  }
})(join(web, 'spec'));
const hints = [
  ...modules.map(u => `<link rel="modulepreload" href="${u}"${u.startsWith('http') ? ' crossorigin' : ''}>`),
  ...specs.map(u => `<link rel="preload" as="fetch" href="${u}" crossorigin>`),
].join('\n') + '\n';

// ---------- 4. сжатие модулей ----------
let minified = 0;
try {
  const { transform } = await import('esbuild');
  for (const f of readdirSync(join(dist, 'js'), { recursive: true }).filter(n => n.endsWith('.js'))) {
    const p = join(dist, 'js', f);
    const { code } = await transform(readFileSync(p, 'utf8'), { loader: 'js', format: 'esm', minify: true, legalComments: 'none', target: 'es2022' });
    writeFileSync(p, code); minified++;
  }
} catch (e) { console.warn(`js не сжаты: ${e.message?.split('\n')[0]}`); }

// ---------- страница ----------
const skeleton = readFileSync(join(root, 'tools', 'skeleton.html'), 'utf8').trim();
const data = `<script type="application/json" id="asset-versions">${JSON.stringify(versions)}</script>\n`
  + `<script type="application/json" id="asset-index">${JSON.stringify(index)}</script>\n`;
// Подсказки — сразу после import map (она в начале index.html): браузер узнаёт о модулях до разбора остального,
// а import map уже стоит (модуль до неё сломал бы разрешение 'three')
const mapEnd = body.search(/<script type="importmap">/) < 0 ? -1 : body.indexOf('</script>', body.search(/<script type="importmap">/)) + '</script>'.length;
const page = mapEnd < 0 ? body + hints : body.slice(0, mapEnd) + '\n' + hints + body.slice(mapEnd);
writeFileSync(join(dist, 'index.html'), skeleton + data + page + '</html>');
console.log(`dist/ ready: ${Object.keys(versions).length} asset folders versioned, ${Object.keys(meta).length} texture metas inlined, `
  + `${modules.length} modules + ${specs.length} specs preloaded, ${minified} js minified`);
