// Чистая логика таблицы рекордов охоты (без сети): проверка результата, слияние «лучший на имя», ограничение частоты.
// Её зовёт api/scores.js; файл с «_» Vercel не публикует как функцию. Границы правдоподобия выводятся из web/spec/hunt.json
// (раунд, очки видов, множители), имя чистит та же cleanName, что и в браузере (web/js/hunt.js).
import { createRequire } from 'node:module';
import { cleanName } from '../web/js/hunt.js';

export const spec = createRequire(import.meta.url)('../web/spec/hunt.json');

const Sc = spec.score;
// Самое дорогое попадание: самый ценный зверь × в голову × дальний выстрел × полная серия × на бегу
const maxPerKill = Math.max(Math.max(...Object.values(spec.species).map(s => s.points))
  * Math.max(Sc.head, Sc.heart) * Sc.distance.max * Sc.combo.max * Sc.running,
  ...Object.values(spec.events?.types ?? {}).map(s => s.points));
export const LIMITS = {
  top: spec.leaderboard.online,                                  // сколько строк хранить и отдавать
  nameMax: spec.leaderboard.nameMax,
  kills: Math.ceil(spec.round * Sc.maxKillsPerSecond),           // за раунд spec.round секунд
  score: Math.ceil(Math.ceil(spec.round * Sc.maxKillsPerSecond) * maxPerKill),
  perKill: maxPerKill,
  level: 1000,
  shots: spec.round * 30,                                        // с запасом над скорострельностью любого оружия
  body: 2048,                                                    // байт в запросе
  gapMs: 10_000,                                                 // не чаще раза в 10 с с одного адреса
  ipKeepMs: 10 * 60_000,                                         // сколько помнить адреса
};

const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// -> { entry } | { error }  (error — по-русски, его показывает карточка итога)
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'пустой запрос' };
  const name = cleanName(body.name, LIMITS.nameMax);
  if (!name) return { error: 'нужно имя' };
  if (typeof body.name !== 'string' || body.name.length > 200) return { error: 'слишком длинное имя' };
  const { score, kills } = body;
  const level = body.level ?? 1, boars = body.boars ?? null, birds = body.birds ?? null, shots = body.shots ?? null;
  if (!int(kills, 1, LIMITS.kills)) return { error: 'странное число зверей' };
  if (!int(score, 5, LIMITS.score) || score % 5) return { error: 'странный счёт' };
  if (score > kills * LIMITS.perKill) return { error: 'счёт не сходится с числом зверей' };
  if (!int(level, 1, LIMITS.level)) return { error: 'странный уровень' };
  const targets = body.targets ?? 0;
  if (boars !== null && birds !== null && (!int(boars, 0, kills) || !int(birds, 0, kills) || !int(targets, 0, kills) || boars + birds + targets !== kills)) return { error: 'звери не сходятся' };
  if (shots !== null && shots !== 0 && (!int(shots, kills, LIMITS.shots))) return { error: 'выстрелы не сходятся' };
  if (body.round != null && body.round !== spec.round) return { error: 'другая длина охоты' };
  return { entry: { name, score, kills, level, date: new Date().toISOString().slice(0, 10) } };
}

// Лучший результат на имя (без учёта регистра), по убыванию, не больше LIMITS.top -> { top, rank, best }
export function merge(top, entry) {
  const key = entry.name.toLocaleLowerCase('ru');
  const list = (Array.isArray(top) ? top : []).filter(e => e && typeof e.name === 'string');
  const i = list.findIndex(e => e.name.toLocaleLowerCase('ru') === key);
  if (i >= 0 && list[i].score >= entry.score) return { top: list, rank: i + 1, best: list[i].score, improved: false };
  if (i >= 0) list.splice(i, 1);
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
  list.length = Math.min(list.length, LIMITS.top);
  const r = list.indexOf(entry);
  return { top: list, rank: r >= 0 ? r + 1 : null, best: entry.score, improved: true };
}

// Частота с одного адреса: ips — { хэш: время последней записи } внутри того же JSON. -> true, если можно
export function allow(ips, key, now = Date.now()) {
  for (const k of Object.keys(ips)) if (now - ips[k] > LIMITS.ipKeepMs) delete ips[k];
  if (key in ips && now - ips[key] < LIMITS.gapMs) return false;
  ips[key] = now;
  return true;
}
