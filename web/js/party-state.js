// Portable party-item rules. Rendering, sound and transport only observe this state.
// A collision adapter receives a swept segment and returns its first trusted hit.
import { outdoorAreas } from './multiplayer/collision.js';
const finite = Number.isFinite;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const vec = a => Array.isArray(a) && a.length === 3 && a.every(n => finite(n) && Math.abs(n) < 1500);
const copy = value => structuredClone(value);
const kinds = new Set(['beer', 'vape', 'hookah']);
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
const positionOf = p => vec(p.position) ? p.position : [p.x, p.eyeY ?? (p.y || 0) + 1.45, p.z];
export function partyRules(spec = {}) {
  const source = spec.rules || {}, number = (key, fallback, min, max) => finite(source[key]) ? clamp(source[key], min, max) : fallback;
  return Object.freeze({ sips: Math.round(number('sips', 5, 1, 20)), sipSeconds: number('sipSeconds', 1.05, 0.5, 4),
    puffSeconds: number('puffSeconds', 2.5, 1, 8), reach: number('reach', 2.2, 0.5, 4), hoseLength: number('hoseLength', 2.5, 0.75, 5),
    throwSpeed: number('throwSpeed', 7, 2, 15), gravity: number('gravity', 9.8, 3, 20), respawnSeconds: number('respawnSeconds', 18, 3, 300), maxFlightSeconds: number('maxFlightSeconds', 5, 1, 10) });
}
// The apartment and its balcony are above the actual outdoor ground. Shared
// authored floor coverage prevents an invisible y=0 plane outside the building.
export function createPartyGround({ plan, site } = {}) {
  const rectangles = Object.entries(plan?.rooms || {}).filter(([id]) => id !== 'shaft').flatMap(([, room]) => room.rects || []);
  if (plan?.balcony) rectangles.push(plan.balcony);
  if (plan?.openings) rectangles.push(...outdoorAreas(plan));
  const outdoorY = Number.isFinite(site?.floorY) ? -site.floorY : null;
  return (x, z) => rectangles.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) ? 0 : outdoorY;
}
export function createPartySimulation({ spec = {}, collision = null, floorAt = null } = {}) {
  const rules = partyRules(spec), manifest = new Map(), items = new Map();
  let time = 0, serial = 0;
  for (const item of (Array.isArray(spec.items) ? spec.items : []).slice(0, 64)) {
    if (typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || !kinds.has(item.kind) || !vec(item.position) || manifest.has(item.id)) continue;
    manifest.set(item.id, { id: item.id, kind: item.kind, position: [...item.position] });
  }
  const fresh = base => ({ ...copy(base), owner: null, sips: 0, status: 'ready', action: null, flight: null, brokenAt: null, breakSerial: 0 });
  const held = actorId => [...items.values()].find(item => item.owner === actorId) || null;
  function reset() { for (const base of manifest.values()) items.set(base.id, fresh(base)); }
  reset();
  function release(actorId) {
    const item = held(actorId); if (!item) return;
    item.owner = null; item.status = 'ready'; item.position = [...manifest.get(item.id).position]; item.flight = null; item.action = null;
  }
  function breakItem(id, point, at = time) {
    const item = items.get(id);
    if (!item || item.kind !== 'beer' || item.status === 'broken') return false;
    if (vec(point)) item.position = [...point];
    item.owner = null; item.status = 'broken'; item.flight = null; item.brokenAt = at; item.breakSerial = ++serial; item.action = null;
    return true;
  }
  function command(player, verb, id, direction) {
    const item = items.get(id), position = positionOf(player || {}), actorId = player?.id;
    const reject = error => ({ ok: false, error });
    if (typeof actorId !== 'string' || !actorId || !vec(position) || !item) return reject('invalid_item');
    if (verb === 'take') {
      if (item.status !== 'ready' || item.owner || distance(position, item.position) > rules.reach) return reject('item_unavailable');
      // Picking up a different object must never silently refill the old bottle.
      release(actorId); item.owner = actorId; item.status = 'held'; item.action = { kind: 'pickup', at: time, duration: 0.6, actorId };
    } else {
      if (item.owner !== actorId || item.status !== 'held') return reject('item_not_owned');
      if (verb === 'return') { release(actorId); return { ok: true, item: copy(item), event: { kind: 'return', actorId, itemId: id, at: time } }; }
      if (verb !== 'throw' && item.action && time < item.action.at + item.action.duration) return reject('item_busy');
      if (verb === 'sip') {
        if (item.kind !== 'beer' || item.sips >= rules.sips) return reject('bottle_empty');
        item.sips++; item.action = { kind: 'sip', at: time, duration: rules.sipSeconds, actorId };
      } else if (verb === 'puff') {
        if (!['vape', 'hookah'].includes(item.kind) || item.kind === 'hookah' && distance(position, manifest.get(id).position) > rules.hoseLength) return reject('hose_out_of_reach');
        item.action = { kind: 'puff', at: time, duration: rules.puffSeconds, actorId };
      } else if (verb === 'throw') {
        if (item.kind !== 'beer' || !vec(direction) || Math.abs(Math.hypot(...direction) - 1) > 0.02) return reject('invalid_throw');
        const from = [...position];
        item.owner = null; item.status = 'flying'; item.position = from;
        item.action = { kind: 'throw', at: time, duration: 0.55, actorId };
        item.flight = { from: [...from], velocity: direction.map((n, i) => n * rules.throwSpeed + (i === 1 ? 1.2 : 0)), at: time };
      } else return reject('invalid_action');
    }
    return { ok: true, item: copy(item), event: { kind: verb, actorId, itemId: id, at: time } };
  }
  function step(dt, players) {
    if (!finite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    const end = time + dt;
    for (const item of items.values()) {
      if (item.kind === 'hookah' && item.owner && Array.isArray(players)) {
        const player = players.find(p => p.id === item.owner);
        if (!player || distance(positionOf(player), manifest.get(item.id).position) > rules.hoseLength) release(item.owner);
      }
      if (item.status === 'broken' && end - item.brokenAt >= rules.respawnSeconds) { items.set(item.id, fresh(manifest.get(item.id))); continue; }
      if (item.status !== 'flying') continue;
      const flight = item.flight;
      const at = t => flight.from.map((n, i) => n + flight.velocity[i] * t - (i === 1 ? 0.5 * rules.gravity * t * t : 0));
      for (let cursor = time; cursor < end - 1e-9 && item.status === 'flying';) {
        const next = Math.min(end, cursor + 0.025), before = [...item.position], after = at(next - flight.at);
        const hit = collision?.(before, after, item);
        if (vec(hit?.point)) { breakItem(item.id, hit.point, next); }
        else {
          const ground = floorAt ? floorAt(after[0], after[2]) : collision ? null : 0;
          const floor = finite(ground) ? ground + 0.05 : -Infinity;
          if (before[1] >= floor && after[1] <= floor) {
            const k = clamp((before[1] - floor) / (before[1] - after[1]), 0, 1);
            breakItem(item.id, before.map((n, i) => n + (after[i] - n) * k), next);
          } else {
            item.position = after;
            // A missing surface cannot manufacture an aerial shatter. Expired
            // trajectories are recycled quietly to keep simulation bounded.
            if (next - flight.at > rules.maxFlightSeconds) { item.status = 'expired'; items.set(item.id, fresh(manifest.get(item.id))); }
          }
        }
        cursor = next;
      }
    }
    time = end;
  }
  function snapshot() { return { version: 1, time, items: [...items.values()].map(copy) }; }
  function restore(value) {
    if (!value || !finite(value.time) || value.time < 0 || !Array.isArray(value.items)) return false;
    const next = new Map(), owners = new Set();
    for (const saved of value.items) {
      const base = manifest.get(saved?.id);
      if (!base || next.has(base.id) || !vec(saved.position) || !['ready', 'held', 'flying', 'broken'].includes(saved.status) ||
        !Number.isInteger(saved.sips) || saved.sips < 0 || saved.sips > rules.sips || saved.owner != null && typeof saved.owner !== 'string' ||
        saved.status === 'held' && (!saved.owner || owners.has(saved.owner)) || saved.status !== 'held' && saved.owner != null ||
        saved.status === 'flying' && (!vec(saved.flight?.from) || !vec(saved.flight?.velocity) || !finite(saved.flight?.at)) ||
        saved.status === 'broken' && !finite(saved.brokenAt)) return false;
      if (saved.owner) owners.add(saved.owner);
      const state = { ...fresh(base), ...copy(saved), id: base.id, kind: base.kind };
      if (state.action && (!finite(state.action.at) || !finite(state.action.duration) || state.action.duration <= 0)) state.action = null;
      next.set(base.id, state);
    }
    for (const base of manifest.values()) if (!next.has(base.id)) next.set(base.id, fresh(base));
    items.clear(); for (const [id, item] of next) items.set(id, item);
    time = value.time; serial = Math.max(0, ...[...items.values()].map(item => finite(item.breakSerial) ? item.breakSerial : 0)); return true;
  }
  function setHome(id, position) {
    const base = manifest.get(id); if (!base || !vec(position)) return false;
    base.position = [...position]; const item = items.get(id);
    if (item.status === 'ready' || item.kind === 'hookah') item.position = [...position];
    return true;
  }
  return { rules, command, step, snapshot, restore, release, reset, held, breakItem, setHome, setCollision(fn) { collision = typeof fn === 'function' ? fn : null; } };
}
