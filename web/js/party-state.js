// Portable party-item rules. Rendering, sound and transport only observe this state.
// A collision adapter receives a swept segment and returns its first trusted hit.
import { outdoorAreas } from './multiplayer/collision.js';
const finite = Number.isFinite;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const vec = a => Array.isArray(a) && a.length === 3 && a.every(n => finite(n) && Math.abs(n) < 1500);
const copy = value => structuredClone(value);
// Freeze detached presentation copies only; simulation objects remain writable.
function presentationCopy(value) {
  const result = copy(value);
  function freeze(object) {
    if (!object || typeof object !== 'object' || Object.isFrozen(object) || !Array.isArray(object) && Object.getPrototypeOf(object) !== Object.prototype) return;
    // Freeze before following children to stop cycles without an allocated Set.
    Object.freeze(object);
    for (const key in object) if (Object.hasOwn(object, key)) freeze(object[key]);
  }
  freeze(result); return result;
}
const kinds = new Set(['beer', 'energy', 'vape', 'hookah']);
export const isDrink = item => item?.kind === 'beer' || item?.kind === 'energy';
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
const positionOf = p => vec(p.position) ? p.position : [p.x, p.eyeY ?? (p.y || 0) + 1.45, p.z];
export function partyRules(spec = {}) {
  const source = spec.rules || {}, number = (key, fallback, min, max) => finite(source[key]) ? clamp(source[key], min, max) : fallback;
  return Object.freeze({ sips: Math.round(number('sips', 5, 1, 20)), sipSeconds: number('sipSeconds', 1.05, 0.5, 4),
    puffSeconds: number('puffSeconds', 2.5, 1, 8), reach: number('reach', 2.2, 0.5, 4), hoseLength: number('hoseLength', 2.5, 0.75, 5),
    throwSpeed: number('throwSpeed', 7, 2, 15), gravity: number('gravity', 9.8, 3, 20), respawnSeconds: number('respawnSeconds', 18, 3, 300), maxFlightSeconds: number('maxFlightSeconds', 5, 1, 10), giveReach: number('giveReach',1.85,.5,3), effectSeconds: number('effectSeconds',18,2,60), crushSeconds: number('crushSeconds',.65,.25,2), persistentDebris: source.persistentDebris !== false });
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
  let time = 0, serial = 0, fridgeOpen = false;
  const boosts = new Map();
  const itemCopies = new Map(), dirtyItems = new Set();
  let presentedItems = null, presentedBoosts = null;
  // Canonical item writes/replacements must invalidate their detached view.
  const touch = id => { dirtyItems.add(id); presentedItems = null; };
  for (const item of (Array.isArray(spec.items) ? spec.items : []).slice(0, 64)) {
    if (typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || !kinds.has(item.kind) || !vec(item.position) || manifest.has(item.id)) continue;
    manifest.set(item.id, { id: item.id, kind: item.kind, variant: item.variant ?? null, position: [...item.position] });
  }
  const fresh = base => ({ ...copy(base), owner: null, sips: 0, status: 'ready', action: null, flight: null, brokenAt: null, breakSerial: 0, crushed: false });
  const held = actorId => [...items.values()].find(item => item.owner === actorId) || null;
  function reset() { fridgeOpen = false; boosts.clear(); presentedBoosts = null; itemCopies.clear(); dirtyItems.clear();
    for (const base of manifest.values()) { items.set(base.id, fresh(base)); touch(base.id); } }
  reset();
  function release(actorId) {
    const item = held(actorId); if (!item) return;
    item.owner = null; item.status = item.crushed ? 'resting' : 'ready'; item.position = [...manifest.get(item.id).position]; item.flight = null; item.action = null;
    touch(item.id);
  }
  function breakItem(id, point, at = time) {
    const item = items.get(id);
    if (!item || !isDrink(item) || ['broken','resting'].includes(item.status)) return false;
    if (vec(point)) item.position = [...point];
    item.owner = null; item.status = item.kind === 'energy' ? 'resting' : 'broken'; item.flight = null; item.brokenAt = at; item.breakSerial = ++serial; item.action = null;
    touch(item.id);
    return true;
  }
  function canTake(player, id) {
    const item = items.get(id), position = positionOf(player);
    return !!player?.id && !!item && vec(position) && ['ready', 'resting'].includes(item.status) && !item.owner &&
      !(item.kind === 'energy' && item.status === 'ready' && !fridgeOpen) && distance(position, item.position) <= rules.reach;
  }
  function command(player, verb, id, direction) {
    const item = items.get(id), position = positionOf(player || {}), actorId = player?.id;
    const reject = error => ({ ok: false, error });
    if (verb === 'fridge') {
      if (typeof actorId !== 'string' || !vec(position) || !vec(spec.fridge?.position) || distance(position,spec.fridge.position)>rules.reach) return reject('fridge_out_of_reach');
      fridgeOpen = !fridgeOpen; return {ok:true,event:{kind:'fridge',actorId,at:time}};
    }
    if (typeof actorId !== 'string' || !actorId || !vec(position) || !item) return reject('invalid_item');
    if (verb === 'take') {
      if (!canTake(player, id)) return reject('item_unavailable');
      // Picking up a different object must never silently refill the old bottle.
      release(actorId); item.owner = actorId; item.status = 'held'; item.action = { kind: 'pickup', at: time, duration: 0.6, actorId };
    } else {
      if (item.owner !== actorId || item.status !== 'held') return reject('item_not_owned');
      if (verb === 'return') { release(actorId); return { ok: true, item: copy(item), event: { kind: 'return', actorId, itemId: id, at: time } }; }
      if (verb !== 'throw' && item.action && time < item.action.at + item.action.duration) return reject('item_busy');
      if (verb === 'sip') {
        if (!isDrink(item) || item.sips >= rules.sips || item.crushed) return reject('bottle_empty');
        item.sips++; item.action = { kind: 'sip', at: time, duration: rules.sipSeconds, actorId };
        if (item.kind === 'energy') { boosts.set(actorId,{actorId,variant:item.variant,at:time,until:time+rules.effectSeconds,strength:item.sips/rules.sips}); presentedBoosts = null; }
      } else if (verb === 'crush') {
        if (item.kind !== 'energy' || item.sips < rules.sips || item.crushed) return reject('cannot_crush');
        item.crushed=true;item.action={kind:'crush',at:time,duration:rules.crushSeconds,actorId};
      } else if (verb === 'puff') {
        if (!['vape', 'hookah'].includes(item.kind) || item.kind === 'hookah' && distance(position, manifest.get(id).position) > rules.hoseLength) return reject('hose_out_of_reach');
        item.action = { kind: 'puff', at: time, duration: rules.puffSeconds, actorId };
      } else if (verb === 'throw') {
        if (!isDrink(item) || !vec(direction) || Math.abs(Math.hypot(...direction) - 1) > 0.02) return reject('invalid_throw');
        const from = [...position];
        item.owner = null; item.status = 'flying'; item.position = from;
        item.action = { kind: 'throw', at: time, duration: 0.55, actorId };
        item.flight = { from: [...from], velocity: direction.map((n, i) => n * rules.throwSpeed + (i === 1 ? 1.2 : 0)), at: time };
      } else return reject('invalid_action');
    }
    touch(item.id);
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
      if (!rules.persistentDebris && ['broken','resting'].includes(item.status) && end - item.brokenAt >= rules.respawnSeconds) { items.set(item.id, fresh(manifest.get(item.id))); touch(item.id); continue; }
      if (item.status !== 'flying') continue;
      touch(item.id);
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
    for(const [id,boost] of boosts)if(boost.until<=time){boosts.delete(id);presentedBoosts=null;}
  }
  function transfer(actorId,targetId,id,players=[]) {
    const item=items.get(id),from=players.find(p=>p.id===actorId),to=players.find(p=>p.id===targetId);
    if(!item||item.owner!==actorId||item.status!=='held')return{ok:false,error:'item_not_owned'};
    if(!targetId||targetId===actorId||players.length&&(!from||!to||distance(positionOf(from),positionOf(to))>rules.giveReach))return{ok:false,error:'recipient_out_of_reach'};
    if(held(targetId))return{ok:false,error:'recipient_busy'};
    if(item.kind==='hookah'&&(!to||distance(positionOf(to),manifest.get(id).position)>rules.hoseLength))return{ok:false,error:'hose_out_of_reach'};
    if(item.action&&time<item.action.at+item.action.duration)return{ok:false,error:'item_busy'};
    item.owner=targetId;item.action={kind:'pickup',actorId:targetId,at:time,duration:.6};touch(item.id);return{ok:true,item:copy(item)};
  }
  function snapshot() { return { version: 1, time, fridgeOpen, boosts:[...boosts.values()].map(copy), items: [...items.values()].map(copy) }; }
  function restore(value) {
    if (!value || !finite(value.time) || value.time < 0 || !Array.isArray(value.items)) return false;
    const next = new Map(), owners = new Set();
    for (const saved of value.items) {
      const base = manifest.get(saved?.id);
      if (!base || next.has(base.id) || !vec(saved.position) || !['ready', 'held', 'flying', 'broken','resting'].includes(saved.status) ||
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
    itemCopies.clear(); dirtyItems.clear(); for (const id of items.keys()) touch(id); presentedBoosts = null;
    fridgeOpen=!!value.fridgeOpen;boosts.clear();for(const boost of (value.boosts||[]))if(typeof boost.actorId==='string'&&finite(boost.until)&&finite(boost.at)&&finite(boost.strength))boosts.set(boost.actorId,copy(boost));
    time = value.time; serial = Math.max(0, ...[...items.values()].map(item => finite(item.breakSerial) ? item.breakSerial : 0)); return true;
  }
  function setHome(id, position) {
    const base = manifest.get(id); if (!base || !vec(position)) return false;
    base.position = [...position]; const item = items.get(id);
    if (item.status === 'ready' || item.kind === 'hookah') { item.position = [...position]; touch(id); }
    return true;
  }
  const localPresentation = Object.freeze({ version: 1, get time() { return time; }, get fridgeOpen() { return fridgeOpen; },
    get boosts() { return presentedBoosts ??= Object.freeze([...boosts.values()].map(presentationCopy)); },
    get items() {
      if (!presentedItems) {
        const changed = [];
        for (const [id, item] of items) if (dirtyItems.has(id) || !itemCopies.has(id)) changed.push(item);
        // One clone for a moving cohort; keep generic restored fields/cycles
        // and retain existing detached records for every unchanged item.
        if (changed.length === 1) itemCopies.set(changed[0].id, presentationCopy(changed[0]));
        else if (changed.length > 1) for (const item of presentationCopy(changed)) itemCopies.set(item.id, item);
        presentedItems = Object.freeze([...items.keys()].map(id => itemCopies.get(id))); dirtyItems.clear();
      }
      return presentedItems;
    } });
  return { rules, canTake, command, step, snapshot, presentation: () => localPresentation, restore, release, reset, held, transfer, breakItem, setHome, status: id => items.get(id)?.status, setCollision(fn) { collision = typeof fn === 'function' ? fn : null; } };
}
