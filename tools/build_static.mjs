// Сборка статики для хостинга (Vercel): web/ -> dist/, index.html оборачивается каркасом tools/skeleton.html
// (тем же, что добавляет локальный tools/serve.py). Запуск: node tools/build_static.mjs
// Без сервера кнопки «Снимок PNG» и «Модель GLB» не пишут в exports/, а скачивают файл в браузере.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web'), dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
cpSync(web, dist, { recursive: true, filter: src => !src.endsWith('.DS_Store') });
const skeleton = readFileSync(join(root, 'tools', 'skeleton.html'), 'utf8').trim();
const body = readFileSync(join(web, 'index.html'), 'utf8');
writeFileSync(join(dist, 'index.html'), skeleton + body + '</html>');
console.log('dist/ ready');
