// Общая таблица рекордов охоты (web/js/hunt.js, spec/hunt.json leaderboard.url = "/api/scores").
//   GET  -> { top: [{ name, score, kills, level, date }] }  до 100 строк; кэш CDN 20 с (бережём квоту Vercel Hobby)
//   POST { name, score, kills, boars, birds, shots, level, round } -> { ok, rank, best, top } | { error } (400/413/429/503)
// Хранилище: приватный Vercel Blob (стор kolya-kuhnia-hunt), один файл hunt/leaderboard.json
//   { v: 1, top: [...], ips: { хэш адреса: время } }; запись с ifMatch (etag) — две записи разом не затрут друг друга.
// Токен BLOB_READ_WRITE_TOKEN берётся из окружения Vercel; в ответы и журнал не попадает.
import { get, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { validate, merge, allow, LIMITS } from './_scores-core.js';

const PATH = 'hunt/leaderboard.json';
const memory = new Map();   // быстрый отсев повторов в пределах одного экземпляра функции

async function read() {
  const r = await get(PATH, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return { data: { v: 1, top: [], ips: {} }, etag: null };
  const data = JSON.parse(await new Response(r.stream).text());
  return { data: { v: 1, top: [], ips: {}, ...data }, etag: r.blob.etag };
}
async function write(data, etag) {
  await put(PATH, JSON.stringify(data), {
    access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
    cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : {}),
  });
}
const publicTop = top => top.map(({ name, score, kills, level, date }) => ({ name, score, kills, level, date }));
const ipKey = req => {
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
  return createHash('sha256').update(`hunt|${ip}`).digest('hex').slice(0, 16);
};
const send = (res, code, body, cache = 'no-store') => {
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(code).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return send(res, 503, { error: 'таблица не подключена' });
  try {
    if (req.method === 'GET') {
      const { data } = await read();
      return send(res, 200, { top: publicTop(data.top) }, 'public, max-age=0, s-maxage=20, stale-while-revalidate=60');
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'только GET и POST' }); }
    if (Number(req.headers['content-length'] || 0) > LIMITS.body) return send(res, 413, { error: 'слишком большой запрос' });
    let body = req.body;
    if (typeof body === 'string') {
      if (body.length > LIMITS.body) return send(res, 413, { error: 'слишком большой запрос' });
      try { body = JSON.parse(body); } catch { return send(res, 400, { error: 'не JSON' }); }
    }
    const v = validate(body);
    if (v.error) return send(res, 400, { error: v.error });
    const key = ipKey(req), now = Date.now();
    if (now - (memory.get(key) || 0) < LIMITS.gapMs) return send(res, 429, { error: 'не так часто' });
    memory.set(key, now);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, etag } = await read();
      if (!allow(data.ips, key, now)) return send(res, 429, { error: 'не так часто' });
      const m = merge(data.top, v.entry);
      data.top = m.top;
      try {
        await write(data, etag);
        return send(res, 200, { ok: true, rank: m.rank, best: m.best, top: publicTop(m.top) });
      } catch (err) {
        if (err?.name !== 'BlobPreconditionFailedError' && !/precondition/i.test(err?.message || '')) throw err;   // кто-то записал раньше — перечитать
      }
    }
    return send(res, 503, { error: 'таблица занята, попробуйте ещё раз' });
  } catch (err) {
    console.error('hunt scores:', err?.name || 'error');
    return send(res, 503, { error: 'таблица недоступна' });
  }
}
