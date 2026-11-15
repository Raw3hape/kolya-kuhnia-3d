// Сборка статики для хостинга (Vercel): web/ -> dist/, index.html оборачивается каркасом tools/skeleton.html
// (тем же, что добавляет локальный tools/serve.py). Запуск: node tools/build_static.mjs
// Без сервера кнопки «Снимок PNG» и «Модель GLB» не пишут в exports/, а скачивают файл в браузере.
//
// Версии ассетов: для каждой папки внутри textures/ и models/ — короткий хеш её файлов. Карта { папка: хеш }
// ложится в index.html (<script type="application/json" id="asset-versions">), загрузчики дописывают ?v=<хеш>
// (web/js/loading.js assetUrl), а vercel.json отдаёт такие адреса с кешем на год: поменялся файл — поменялся адрес.
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web'), dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
cpSync(web, dist, { recursive: true, filter: src => !src.endsWith('.DS_Store') });

const versions = {};
function hashDirs(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const h = createHash('sha1');
  let files = 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) hashDirs(p);
    else { h.update(e.name).update('\0').update(readFileSync(p)); files++; }
  }
  if (files) versions[relative(dist, dir).split('\\').join('/')] = h.digest('hex').slice(0, 10);
}
for (const d of ['textures', 'models']) hashDirs(join(dist, d));

const skeleton = readFileSync(join(root, 'tools', 'skeleton.html'), 'utf8').trim();
const body = readFileSync(join(web, 'index.html'), 'utf8');
const map = `<script type="application/json" id="asset-versions">${JSON.stringify(versions)}</script>\n`;
writeFileSync(join(dist, 'index.html'), skeleton + map + body + '</html>');
console.log(`dist/ ready, ${Object.keys(versions).length} asset folders versioned`);
