// Pure shared rules. The solo adapter and host Worker use the same clock and commands.
import { courierPose, deliveryEase } from './courier-pose.js';
const clone = value => structuredClone(value);
function presentationCopy(value) {
  const result = clone(value), seen = new WeakSet();
  function freeze(object) {
    if (!object || typeof object !== 'object' || seen.has(object) || !Array.isArray(object) && Object.getPrototypeOf(object) !== Object.prototype) return;
    seen.add(object); for (const child of Object.values(object)) freeze(child); Object.freeze(object);
  }
  freeze(result); return result;
}
const finite3 = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
export function socialLocations(plan, spec) {
  const door = plan.openings.find(o => o.type === 'entry');
  const x = (door.x0 + door.x1) / 2, z = door.z0;
  return { door: door.id, delivery: [x, 0.01, z - spec.pizza.deliveryInset], courier: [x, 0, door.z1 + spec.courier.outside] };
}
export function createSocialSimulation({ spec, plan, blocked = () => false, validatePlacement = () => true, isEntryOpen = () => false }) {
  const rules = spec.rules, locations = socialLocations(plan, spec);
  let time = 0, nextDelivery = rules.firstDelivery, serial = 0, bell = 0, nextBell = 0;
  let courier = null, pizza = null, shower = { owner: null, until: 0 }, landingReserved = false, landingClearAt = 0;
  let radio = { station: 0, playing: false, volume: spec.radio.volume, since: 0, position: [...spec.radio.position], yaw: spec.radio.yaw || 0 };
  const cooldowns = new Map();
  const presented = new Map(), dirty = new Set();
  // In-place entity writes must invalidate; replacement identities are observed.
  const touch = key => dirty.add(key);
  function present(key, value) {
    if (!value) { presented.delete(key); dirty.delete(key); return value; }
    let cached = presented.get(key);
    if (!cached || cached.source !== value || dirty.has(key)) { cached = { source: value, copy: presentationCopy(value) }; presented.set(key, cached); dirty.delete(key); }
    return cached.copy;
  }
  const eye = player => [player.x, player.eyeY ?? (player.y || 0) + 1.68, player.z];
  const near = (player, position) => Math.hypot(...eye(player).map((v, i) => v - position[i])) <= rules.reach && !blocked(player, position);
  const setPhase = phase => { courier.phase = phase; courier.phaseAt = time; touch('courier'); };
  function startLeaving() { setPhase('leaving'); courier.leaving = time; courier.until = time + spec.courier.leaveSeconds; }
  const transferBusy = () => !!pizza?.owner && time < (pizza.transferUntil || 0);
  function courierWaiting() { setPhase(isEntryOpen() ? 'offering' : 'waiting'); courier.recipient = null; }
  function releaseItem(id) {
    if (pizza?.owner !== id) return;
    touch('pizza');
    if (transferBusy() && courier?.phase === 'handoff' && courier.recipient === id) {
      pizza.owner = null; pizza.location = 'courier'; pizza.transferUntil = 0; courierWaiting();
      pizza.position = courierPose(spec, locations, courier, time).box;
    } else { pizza.owner = null; pizza.location = 'placed'; pizza.transferUntil = 0; pizza.position = [...pizza.safePosition]; }
  }
  function release(id) {
    releaseItem(id);
    if (shower.owner === id) shower = { owner: null, until: 0 };
    cooldowns.delete(id);
  }
  function canTake(player, verb) {
    if (!player?.id || !pizza || pizza.owner || !near(player, pizza.position)) return false;
    if (verb === 'receive') return !player.seat && pizza.location === 'courier' && courier?.phase === 'offering' && isEntryOpen();
    return verb === 'take' && pizza.location !== 'courier' && !transferBusy();
  }
  function command(player, action) {
    if (!player?.id) return false;
    const verb = action.verb;
    // Commands are infrequent mutation boundaries; rejected commands may renew
    // a detached copy, but never expose or mutate a live simulation object.
    if (verb === 'radio' || verb === 'shower') touch(verb);
    else touch('pizza');
    if (verb === 'receive') touch('courier');
    if (verb === 'radio') {
      if (!radio.position || !near(player, radio.position)) return false;
      const { station, volume, playing } = action;
      if (station !== undefined && (!Number.isInteger(station) || !spec.radio.stations[station])) return false;
      if (volume !== undefined && (!Number.isFinite(volume) || volume < 0 || volume > 1)) return false;
      if (playing !== undefined && typeof playing !== 'boolean') return false;
      radio = { ...radio, ...(volume !== undefined ? { volume } : {}), ...(playing !== undefined ? { playing } : {}),
        ...(station !== undefined ? { station, since: station === radio.station ? radio.since : time } : {}) };
      return true;
    }
    if (verb === 'shower') {
      if (shower.owner === player.id) { shower = { owner: null, until: 0 }; return true; }
      if (shower.owner || !finite3(action.point) || !near(player, action.point) || !validatePlacement(action.point, 'shower')) return false;
      shower = { owner: player.id, until: time + rules.showerSeconds, point: [...action.point] }; return true;
    }
    if (!pizza) return false;
    if (verb === 'receive') {
      if (!canTake(player, verb)) return false;
      pizza.owner = player.id; pizza.location = 'held'; pizza.open = false; pizza.transferFrom = [...pizza.position]; pizza.transferAt = time; pizza.transferUntil = time + spec.courier.handoffSeconds;
      courier.recipient = player.id; setPhase('handoff'); return true;
    }
    if (pizza.location === 'courier' || transferBusy()) return false;
    if (verb === 'take') {
      if (!canTake(player, verb)) return false;
      pizza.owner = player.id; pizza.location = 'held'; pizza.open = false; pizza.safePosition = [...pizza.position];
      return true;
    }
    if (verb === 'place') {
      if (pizza.owner !== player.id || !finite3(action.point) || action.point[1] < 0 || action.point[1] > 1.65 ||
        !near(player, action.point)) return false;
      const support = validatePlacement(action.point, 'pizza'); if (!support) return false;
      pizza.owner = null; pizza.location = 'placed'; pizza.position = [...action.point]; pizza.safePosition = [...action.point]; pizza.support = support === true ? null : clone(support); return true;
    }
    if (verb === 'return') { if (pizza.owner !== player.id) return false; pizza.owner = null; pizza.location = 'placed'; pizza.position = [...pizza.safePosition]; return true; }
    if (!near(player, pizza.position) && pizza.owner !== player.id) return false;
    if (verb === 'open') { if (pizza.owner && pizza.owner !== player.id) return false; pizza.open = !pizza.open; return true; }
    if (verb === 'eat') {
      if (!pizza.open || pizza.owner || pizza.remaining <= 0 || time < (cooldowns.get(player.id) || 0)) return false;
      pizza.remaining--; cooldowns.set(player.id, time + rules.eatSeconds);
      pizza.eaters = [...pizza.eaters.filter(e => e.id !== player.id && time - e.at < rules.eatSeconds), { id: player.id, at: time }].slice(-10);
      if (!pizza.remaining) pizza.emptyAt = time;
      return true;
    }
    return false;
  }
  function step(dt, players = []) {
    time += Math.max(0, Math.min(dt, 0.1));
    if (!pizza && !courier && time >= nextDelivery) {
      courier = { arrived: time, phase: 'arriving', phaseAt: time, until: time + spec.courier.arriveSeconds + rules.courierWait, leaving: null, recipient: null };
      landingReserved = true;
      pizza = { id: ++serial, location: 'courier', owner: null, position: courierPose(spec, locations, courier, time).box, safePosition: [...locations.delivery], open: false, remaining: rules.slices, eaters: [], emptyAt: null, transferUntil: 0 };
      bell++; nextBell = time + rules.bellEvery;
    }
    if (courier) {
      const elapsed = time - courier.phaseAt;
      if (courier.phase === 'arriving' && elapsed >= spec.courier.arriveSeconds) courierWaiting();
      if (['offering', 'waiting'].includes(courier.phase)) {
        if ((courier.phase === 'offering') !== !!isEntryOpen()) courierWaiting();
        if (time >= courier.until) startLeaving();
        else if (time >= nextBell) { bell++; nextBell = time + rules.bellEvery; }
      } else if (courier.phase === 'handoff' && !transferBusy()) setPhase('thanks');
      else if (courier.phase === 'thanks' && elapsed >= spec.courier.thanksSeconds) startLeaving();
      else if (courier.phase === 'leaving' && elapsed >= spec.courier.leaveSeconds) {
        if (pizza?.location === 'courier') pizza = null;
        courier = null; nextDelivery = time + rules.deliveryEvery; landingClearAt = time + spec.courier.clearSeconds;
      }
    }
    if (courier && pizza?.location === 'courier') { pizza.position = courierPose(spec, locations, courier, time).box; touch('pizza'); }
    if (!courier && time >= landingClearAt && !isEntryOpen()) landingReserved = false;
    if (pizza?.owner) {
      touch('pizza');
      const owner = players.find(p => p.id === pizza.owner);
      if (!owner) release(pizza.owner);
      else {
        const held = [owner.x - Math.sin(owner.lookYaw ?? owner.yaw ?? 0) * 0.42, (owner.eyeY ?? 1.68) - 0.5, owner.z - Math.cos(owner.lookYaw ?? owner.yaw ?? 0) * 0.42];
        const t = transferBusy() ? deliveryEase((time - pizza.transferAt) / spec.courier.handoffSeconds) : 1;
        pizza.position = held.map((n, i) => t < 1 ? pizza.transferFrom[i] + (n - pizza.transferFrom[i]) * t : n);
      }
    }
    if (pizza?.emptyAt !== null && pizza && !pizza.owner && time - pizza.emptyAt > rules.emptySeconds) { pizza = null; nextDelivery = time + rules.deliveryEvery; }
    if (shower.owner && (time >= shower.until || !players.some(p => p.id === shower.owner && Math.hypot(p.x - shower.point[0], p.z - shower.point[2]) < rules.showerReach))) shower = { owner: null, until: 0 };
    for (const [id, until] of cooldowns) if (time > until + 5) cooldowns.delete(id);
  }
  const localPresentation = Object.freeze({ get time() { return time; }, get nextDelivery() { return nextDelivery; }, get serial() { return serial; },
    get bell() { return bell; }, get nextBell() { return nextBell; }, get courier() { return present('courier', courier); }, get pizza() { return present('pizza', pizza); },
    get shower() { return present('shower', shower); }, get radio() { return present('radio', radio); }, get landingReserved() { return landingReserved; },
    get landingClearAt() { return landingClearAt; }, get entryOpen() { return !!isEntryOpen(); } });
  return { step, canTake, command, release, releaseItem, presentation: () => localPresentation, heldBy: id => pizza?.owner === id, reservesLanding: () => landingReserved,
    transfer(from, to, id) {
      if (id !== 'pizza' || pizza?.owner !== from || !to || to === from || transferBusy()) return { ok: false };
      pizza.owner = to; pizza.open = false; touch('pizza'); return { ok: true };
    },
    reconcileSupport(lookup) {
      if (!pizza?.support) return;
      const before = pizza.support.bounds, after = lookup(pizza.support.id), margin = spec.pizza.size / 2 - 0.015;
      if (after && before.every((n, i) => Math.abs(n - after[i]) < 1e-6)) return;
      touch('pizza');
      const position = [...pizza.safePosition];
      if (after && after[3] - after[0] >= margin * 2 && after[5] - after[2] >= margin * 2) {
        position[0] = Math.max(after[0] + margin, Math.min(after[3] - margin, position[0] + (after[0] + after[3] - before[0] - before[3]) / 2));
        position[1] = after[4] + 0.008;
        position[2] = Math.max(after[2] + margin, Math.min(after[5] - margin, position[2] + (after[2] + after[5] - before[2] - before[5]) / 2));
        pizza.support.bounds = [...after];
      } else { position[1] = 0.008; pizza.support = null; }
      pizza.safePosition = position; if (!pizza.owner) pizza.position = [...position];
    },
    setRadioPose(pose) { const position = finite3(pose?.position) ? [...pose.position] : null; radio = { ...radio, position, yaw: Number.isFinite(pose?.yaw) ? pose.yaw : 0, playing: position ? radio.playing : false }; },
    snapshot: () => clone({ time, nextDelivery, serial, bell, nextBell, courier, pizza, shower, radio, landingReserved, landingClearAt, entryOpen: !!isEntryOpen() }),
    restore(value) { if (value) { ({ time, nextDelivery, serial, bell, nextBell = 0, courier, pizza, shower, radio, landingReserved = false, landingClearAt = 0 } = clone(value)); cooldowns.clear(); presented.clear(); dirty.clear(); } } };
}
