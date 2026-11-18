import { serviceEntrance } from '../service-level-entrance.js';
import { createServiceLevel } from '../service-level-simulation.js';
// Transport-independent room authority. Only the creator runs this module.
// No renderer, DOM, account, remote database or client-supplied scores.
import { NETWORK_RULES as R, WEAPON_RULES, EXTERNAL_TARGET_RULES, refillMagazine } from './rules.js';
import { WALK, buildColliders, moveCircle, findFree, roomOf, isFree } from './collision.js';
import { createHuntSimulation } from './hunt-simulation.js';
import { makeAvatarAction } from './action-contract.js';
import { createPartySimulation, createPartyGround } from '../party-state.js';
import { createSocialSimulation } from '../social-state.js';
import { createRCSimulation } from '../rc-state.js';

const finite = Number.isFinite;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const vec = a => Array.isArray(a) && a.length === 3 && a.every(finite);
const plain = a => a && typeof a === 'object' && !Array.isArray(a);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const token = () => [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, '0')).join('');
const nameOf = n => String(n || '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}<>]/gu, '').trim().slice(0, 24) || 'Гость';
const copy = o => structuredClone(o);
const q = n => Math.round(n * 1000) / 1000;
const types = new Set(['glass', 'ceramic', 'wood', 'paper', 'cloth', 'plastic', 'foliage', 'metal', 'fruit']);
const weaponOf = id => typeof id === 'string' && Object.hasOwn(WEAPON_RULES, id) ? WEAPON_RULES[id] : null;
const boundedArray = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];
const encoder = new TextEncoder();
const byteLength = value => encoder.encode(JSON.stringify(value)).byteLength;

function sanitizeCollision(collision) {
  const valid = a => finite(a) && Math.abs(a) < 100;
  return boundedArray(collision?.extra || collision?.boxes, R.maxCollisionBoxes).filter(b =>
    plain(b) && (b.ax !== undefined ? ['ax', 'az', 'bx', 'bz', 'h'].every(k => valid(b[k])) && b.h >= 0 && Math.hypot(b.bx - b.ax, b.bz - b.az) > 1e-6 :
      ['x0', 'x1', 'z0', 'z1'].every(k => valid(b[k])) && b.x1 > b.x0 && b.z1 > b.z0)
  ).map(b => b.ax !== undefined ? { ax: b.ax, az: b.az, bx: b.bx, bz: b.bz, h: clamp(b.h, 0, 0.3), ...(b.door ? { door: String(b.door) } : {}) } :
    { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
}

export function sanitizeObjects(objects) {
  if (!Array.isArray(objects)) return [];
  const ids = new Set();
  return objects.slice(0, R.maxObjects).filter(o => {
    if (!plain(o) || typeof o.id !== 'string' || o.id.length > 500 || ids.has(o.id) || !Array.isArray(o.bounds) || o.bounds.length !== 6 || !o.bounds.every(n => finite(n) && Math.abs(n) < 1500)) return false;
    const extents = [0, 1, 2].map(i => o.bounds[i + 3] - o.bounds[i]);
    if (extents.some(size => size < 0) || extents.filter(size => size > 1e-6).length < 2) return false;
    ids.add(o.id); return true;
  }).map(o => ({ id: o.id, bounds: o.bounds.map((value, i) => {
    const axis = i % 3, size = o.bounds[axis + 3] - o.bounds[axis];
    return size < 0.001 ? (o.bounds[axis] + o.bounds[axis + 3]) / 2 + (i < 3 ? -0.0005 : 0.0005) : value;
  }), unitId: String(o.unitId || o.id).slice(0, 500),
    breakable: types.has(o.breakable) ? o.breakable : null, glass: !!o.glass,
    dependentIds: boundedArray(o.dependentIds, 32).filter(id => typeof id === 'string' && id.length <= 500) }));
}

// Slab intersection; normal and distance are derived by the authority.
export function rayBox(origin, direction, bounds, range = Infinity) {
  let near = 0, far = range, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(direction[i]) < 1e-9) { if (origin[i] < bounds[i] || origin[i] > bounds[i + 3]) return null; continue; }
    let a = (bounds[i] - origin[i]) / direction[i], b = (bounds[i + 3] - origin[i]) / direction[i];
    let s = -1;
    if (a > b) { [a, b] = [b, a]; s = 1; }
    if (a > near) { near = a; axis = i; sign = s; }
    far = Math.min(far, b);
    if (far < near) return null;
  }
  if (near < 0.005 || near > range || axis < 0) return null;
  const normal = [0, 0, 0]; normal[axis] = sign;
  return { distance: near, point: origin.map((v, i) => q(v + direction[i] * near)), normal };
}

export function createRoomAuthority({ roomId, plan, huntSpec, site, partySpec, socialSpec, rcSpec, serviceSpec, send, sendMany, now = () => performance.now(), seed = 1 }) {
  const players = new Map(), links = new Map(), objects = new Map(), broken = new Set();
  const completedExternal = new Set(), killedExternal = new Set();
  const effectSizes = new Map(), pendingExternal = new Map();
  const col = buildColliders(plan), hunt = createHuntSimulation({ spec: huntSpec, site, plan, seed });
  const rc = rcSpec ? createRCSimulation({ spec: rcSpec, site }) : null;
  let apartment = null, hostId = null, revision = 0, seq = 0, eventSeq = 0, time = 0, disposed = false;
  let extra = [], ambientExtra = [], doorMeta = [], doors = {}, items = {}, itemMeta = [], seatMeta = [], seats = {}, effects = [], effectsBytes = 2, snapshotClock = 0, epoch = 0, ambient = null;
  let interactionMeta = { media: {}, newspaperPages: [], hoodPosition: null }, interactions = {};
  let showerPoint = null;
  const socialSupport = id => { const object = objects.get(id); return object && !broken.has(object.unitId) ? object.bounds : null; };
  const social = socialSpec ? createSocialSimulation({ spec: socialSpec, plan,
    isEntryOpen: () => !!doors[plan.openings.find(o => o.type === 'entry')?.id],
    blocked: (p, point) => pathBlocked(p, { x: point[0], z: point[2] }),
    validatePlacement(point, kind) {
      if (kind === 'shower') return showerPoint && distance(point, showerPoint) < 0.02;
      const margin = socialSpec.pizza.size / 2 - 0.015;
      if (![-margin, margin].every(x => [-margin, margin].every(z => roomOf(plan, point[0] + x, point[2] + z))) ||
        col.boxes.some(box => point[0] > box.x0 - margin && point[0] < box.x1 + margin && point[2] > box.z0 - margin && point[2] < box.z1 + margin)) return false;
      if (point[1] < 0.03) return true;
      const support = [...objects.values()].find(o => !broken.has(o.unitId) && !o.id.startsWith('party:') &&
        point[0] - margin >= o.bounds[0] && point[0] + margin <= o.bounds[3] && point[2] - margin >= o.bounds[2] && point[2] + margin <= o.bounds[5] && Math.abs(point[1] - o.bounds[4] - 0.008) < 0.025);
      return support ? { id: support.id, bounds: [...support.bounds] } : false;
    } }) : null;
  const party = createPartySimulation({ spec: partySpec, floorAt: createPartyGround({ plan, site }), collision(from, to, item) {
    const delta = to.map((n, i) => n - from[i]), length = Math.hypot(...delta);
    if (length < 1e-8) return null;
    const direction = delta.map(n => n / length), candidates = [];
    for (const box of col.boxes) {
      const hit = rayBox(from, direction, [box.x0, 0, box.z0, box.x1, plan.ceiling, box.z1], length);
      if (hit) candidates.push(hit);
    }
    for (const object of objects.values()) {
      if (broken.has(object.unitId) || object.unitId === `party:${item.id}` || object.id.startsWith(`party:${item.id}/`)) continue;
      if (object.unitId.startsWith('party:') && party.status(object.unitId.slice(6)) !== 'ready') continue;
      const hit = rayBox(from, direction, object.bounds, length); if (hit) candidates.push(hit);
    }
    for (const door of doorObstacles()) {
      const hit = rayBox(from, direction, [Math.min(door.ax, door.bx) - door.h, 0, Math.min(door.az, door.bz) - door.h,
        Math.max(door.ax, door.bx) + door.h, plan.ceiling, Math.max(door.az, door.bz) + door.h], length);
      if (hit) candidates.push(hit);
    }
    return candidates.sort((a, b) => a.distance - b.distance)[0] || null;
  } });
  const started = now();

  const entrance = serviceSpec && serviceEntrance(plan);
  let service = null, serviceSerial = 0;
  const nextServiceSeed = () => (seed + Math.imul(serviceSerial + 1, 0x9e3779b9)) >>> 0;
  function nextService() {
    const run = createServiceLevel({ config: serviceSpec, seed: nextServiceSeed() });
    serviceSerial++; return run;
  }

  function leaveService(p, { restore = true } = {}) {
    if (!p.inService) return false;
    service.leave(p.id); p.inService = false;
    if (!active().some(other => other.inService)) service = null;
    if (restore) {
      const place = findFree(plan, entrance.returnPose, col, obstacles(p));
      if (place) Object.assign(p, entrance.returnPose, place, { lookYaw: entrance.yaw, vy: 0 });
    }
    return true;
  }

  function serviceAction(p, action) {
    if (!entrance) return false;
    if (action.verb === 'enter') {
      if (p.inService) return true;
      if (p.seat || rc?.isDriving(p.id) || social?.reservesLanding() || !doors[entrance.id] ||
          !entrance.crossed(p, 0.16)) return false;
      service ??= nextService();
      if (!service.join(p.id)) return false;
      release(p); p.inService = true; p.y = p.vy = 0; p.action = null;
      return true;
    }
    if (!p.inService) return action.verb === 'leave';
    if (action.verb === 'leave') return leaveService(p);
    if (action.verb === 'input' && plain(action.input)) return service.input(p.id, action.input);
    if (action.verb === 'restart' && ['victory', 'defeat'].includes(service.snapshot().phase)) {
      service = nextService();
      for (const player of active()) if (player.inService) service.join(player.id);
      return true;
    }
    return false;
  }

  const active = () => [...players.values()].filter(p => p.link !== null);
  const inApartment = () => active().filter(p => !p.inService);
  const others = self => inApartment().filter(p => p !== self).map(p => ({ x: p.x, z: p.z, radius: WALK.radius }));
  const doorObstacles = () => doorMeta.map(d => ({ ...(doors[d.id] ? d.opened : d.closed), door: d.id }));
  const obstacles = p => [...(social?.reservesLanding() ? [] : ambientExtra), ...extra.filter(o => !o.door), ...doorObstacles(), ...others(p)];
  function pathBlocked(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z, length = Math.hypot(dx, dz);
    if (length < 0.01) return false;
    const origin = [from.x, 1.2, from.z], direction = [dx / length, 0, dz / length];
    if (col.boxes.some(box => rayBox(origin, direction, [box.x0, -10, box.z0, box.x1, 10, box.z1], length - 0.01))) return true;
    for (const segment of doorObstacles()) {
      const vx = segment.bx - segment.ax, vz = segment.bz - segment.az, size = vx * vx + vz * vz;
      for (let along = 0.025; along < length; along += 0.025) {
        const x = from.x + direction[0] * along, z = from.z + direction[2] * along;
        const k = clamp(((x - segment.ax) * vx + (z - segment.az) * vz) / size, 0, 1);
        if (Math.hypot(x - segment.ax - vx * k, z - segment.az - vz * k) < segment.h + 0.015) return true;
      }
    }
    return false;
  }
  function standPlace(p, seat) {
    const from = { x: seat.position[0], z: seat.position[2] }, room = roomOf(plan, from.x, from.z), blockers = obstacles(p);
    const valid = point => roomOf(plan, point.x, point.z) === room && isFree(point, col, blockers) && !pathBlocked(from, point);
    const wanted = p.seatOrigin && roomOf(plan, p.seatOrigin.x, p.seatOrigin.z) === room ? p.seatOrigin : { x: seat.stand[0], z: seat.stand[1] };
    if (valid(wanted)) return wanted;
    for (let radius = 0.05; radius <= 2; radius += 0.05) {
      const count = Math.max(8, Math.ceil(Math.PI * 2 * radius / 0.05));
      for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2, point = { x: wanted.x + Math.cos(angle) * radius, z: wanted.z + Math.sin(angle) * radius };
        if (valid(point)) return point;
      }
    }
    return null;
  }
  const post = (link, packet) => { if (!disposed) send(link, packet); };
  // A Worker bridge can clone one shared state for the entire fanout. Ordinary
  // transports retain the original per-recipient API and packet ordering.
  const broadcast = packet => {
    if (disposed) return;
    const recipients = active().map(p => p.link);
    if (sendMany) sendMany(recipients, packet);
    else for (const link of recipients) post(link, packet);
  };
  const result = (link, action, ok, error) => { if (action.requestId) post(link, { type: 'result', requestId: action.requestId, ok, ...(error ? { error } : {}) }); return ok; };
  const event = e => { const packet = { ...e, id: ++eventSeq, time, epoch }; broadcast({ type: 'event', event: packet }); return packet; };
  const animate = (p, kind, targetId, target, weapon = p.weapon) => {
    p.action = makeAvatarAction(kind, time, { weapon, targetId, target });
  };
  function equip(p, weapon) {
    if (!weaponOf(weapon)) return false;
    const next = p.held ? 'none' : weapon;
    if (next !== p.weapon) {
      const previous = p.weapon; p.weapon = next;
      if (next === 'none') { p.aiming = 0; animate(p, 'holster', previous, undefined, previous); }
      else animate(p, 'draw', next);
    }
    return true;
  }

  function normalizedInteraction(id, value) {
    if (!plain(value)) return null;
    if (id === 'hood') return Number.isInteger(value.level) && value.level >= 0 && value.level <= 3 ? { level: value.level } : null;
    if (id === 'newspaper') {
      const count = interactionMeta.newspaperPages[value.issue];
      return Number.isInteger(value.issue) && Number.isInteger(value.page) && count && value.page >= 0 && value.page < count ? { issue: value.issue, page: value.page } : null;
    }
    if (id.startsWith('media:')) {
      const videos = interactionMeta.media[id.slice(6)];
      return Array.isArray(videos) && Number.isInteger(value.index) && value.index >= 0 && value.index < videos.length && (value.playing === undefined || typeof value.playing === 'boolean') ?
        { index: value.index, videoId: videos[value.index], playing: value.playing !== false } : null;
    }
    return null;
  }
  function setInteractions(payload) {
    const supplied = plain(payload.interactionMeta) ? payload.interactionMeta : null;
    if (supplied) {
      const media = {};
      if (plain(supplied.media)) for (const [id, videos] of Object.entries(supplied.media).slice(0, 8)) {
        if (/^[a-z][a-z0-9-]{0,31}$/.test(id) && Array.isArray(videos)) {
          const safe = videos.slice(0, 128).filter(video => typeof video === 'string' && /^[a-zA-Z0-9_-]{6,32}$/.test(video));
          if (safe.length) media[id] = safe;
        }
      }
      interactionMeta = { media, newspaperPages: boundedArray(supplied.newspaperPages, 32).map(count => Number.isInteger(count) && count > 0 && count <= 128 ? count : 0),
        hoodPosition: vec(supplied.hoodPosition) && supplied.hoodPosition.every(n => Math.abs(n) < 100) ? [...supplied.hoodPosition] : null };
    }
    const ids = ['hood', ...Object.keys(interactionMeta.media).map(id => `media:${id}`), ...(interactionMeta.newspaperPages.length ? ['newspaper'] : [])];
    const initial = plain(payload.interactions) ? payload.interactions : {};
    interactions = Object.fromEntries(ids.map(id => [id, normalizedInteraction(id, interactions[id]) || normalizedInteraction(id, initial[id]) ||
      (id === 'hood' ? { level: 0 } : id === 'newspaper' ? { issue: 0, page: 0 } : normalizedInteraction(id, { index: 0, playing: true }))]).filter(([, value]) => value));
  }
  function advanceNewspaper() {
    const current = interactions.newspaper, count = interactionMeta.newspaperPages.length;
    if (current && count) {
      interactions.newspaper = { issue: (current.issue + 1) % count, page: 0 };
      event({ kind: 'interaction', targetId: 'newspaper', value: { ...interactions.newspaper } });
    }
  }

  function setGeometry(payload) {
    extra = sanitizeCollision({ extra: boundedArray(payload.collision?.extra || payload.collision?.boxes, R.maxCollisionBoxes).filter(b => b?.scope !== 'ambient') });
    if (payload.ambientCollision) ambientExtra = sanitizeCollision({ extra: payload.ambientCollision });
    doorMeta = boundedArray(payload.doors?.doors, 32).filter(d => plain(d) && typeof d.id === 'string' && d.id.length <= 96 &&
      sanitizeCollision({ extra: [d.closed, d.opened] }).length === 2).map(d => ({ id: d.id, open: !!d.open,
        closed: sanitizeCollision({ extra: [d.closed] })[0], opened: sanitizeCollision({ extra: [d.opened] })[0] }));
    doors = Object.fromEntries(doorMeta.map(d => [d.id, !!d.open]));
    extra.push(...sanitizeCollision({ boxes: payload.doors?.blockers || [] }));
    objects.clear(); for (const o of sanitizeObjects(payload.objects)) objects.set(o.id, o);
    itemMeta = boundedArray(payload.items, 2).filter(i => plain(i) && ['phone', 'newspaper'].includes(i.id) && vec(i.position));
    items = Object.fromEntries(itemMeta.map(i => [i.id, null]));
    seatMeta = boundedArray(payload.seats, 96).filter(seat => plain(seat) && typeof seat.id === 'string' && seat.id.length <= 500 && vec(seat.position) &&
      seat.position.every(n => Math.abs(n) < 100) && finite(seat.yaw) && finite(seat.eyeY) && seat.eyeY > 0.3 && seat.eyeY < 2.5 &&
      Array.isArray(seat.stand) && seat.stand.length === 2 && seat.stand.every(n => finite(n) && Math.abs(n) < 100));
    seats = Object.fromEntries(seatMeta.map(seat => [seat.id, null]));
    showerPoint = vec(payload.socialMeta?.showerPoint) && payload.socialMeta.showerPoint.every(n => Math.abs(n) < 100) ? [...payload.socialMeta.showerPoint] : null;
    if (Object.hasOwn(payload.socialMeta || {}, 'radioPose')) {
      const pose = payload.socialMeta.radioPose;
      social?.setRadioPose(vec(pose?.position) && pose.position.every(n => Math.abs(n) < 100) && finite(pose.yaw) ? pose : null);
    }
    setInteractions(payload);
    for (const item of boundedArray(payload.partySpec?.items, 64)) party.setHome(item?.id, item?.position);
  }

  function spawn(p) {
    const bodies = obstacles(p);
    const candidate = findFree(plan, WALK.start, col, bodies);
    if (!candidate) return false;
    Object.assign(p, { ...candidate, y: 0, vy: 0, yaw: WALK.start.yaw, lookYaw: WALK.start.yaw, pitch: 0, aiming: 0, action: null, ack: 0, seat: null, eyeY: null }); return true;
  }

  function connect(link, hello) {
    if (disposed) return;
    if (!plain(hello) || hello.version !== R.version) return post(link, { type: 'error', error: 'version_mismatch' });
    if (hello.type === 'create') {
      if (hostId || link !== 'local' || !plain(hello.apartment)) return post(link, { type: 'error', error: 'room_exists' });
      if (JSON.stringify(hello.apartment).length > 32000) return post(link, { type: 'error', error: 'invalid_apartment' });
      apartment = copy(hello.apartment); revision = 1; setGeometry(hello);
    } else if (!hostId) return post(link, { type: 'error', error: 'room_missing' });
    const known = typeof hello.token === 'string' ? [...players.values()].find(p => p.token === hello.token) : null;
    if (known && known.id === hostId && link !== 'local') return post(link, { type: 'error', error: 'host_reserved' });
    if ((!known || known.link === null) && active().length >= R.maxPlayers) return post(link, { type: 'error', error: 'room_full' });
    if (links.has(link) && players.get(links.get(link)) !== known) return post(link, { type: 'error', error: 'connection_exists' });
    if (link === 'local' && hostId && known?.id !== hostId) return post(link, { type: 'error', error: 'host_reserved' });
    let p = known;
    if (p) {
      if (p.link !== null) { links.delete(p.link); post(p.link, { type: 'error', error: 'session_replaced' }); }
      const used = new Set(active().filter(q => q !== p).map(q => q.avatar));
      if (used.has(p.avatar)) p.avatar = [...Array(R.maxPlayers).keys()].find(n => !used.has(n));
      leaveService(p, { restore: false });
      releaseSeat(p);
      p.link = null;
      if (!spawn(p)) return post(link, { type: 'error', error: 'spawn_blocked' });
    } else {
      const used = new Set(active().map(q => q.avatar)), slots = [...Array(R.maxPlayers).keys()].filter(n => !used.has(n));
      p = { id: token().slice(0, 16), token: token(), avatar: slots[Math.floor(Math.random() * slots.length)], name: nameOf(hello.name),
        link: null, score: 0, kills: 0, held: null, seat: null, eyeY: null, weapon: 'none', ack: 0, budget: R.inputBudget, lastSeen: now(),
        ammo: Object.fromEntries(Object.entries(WEAPON_RULES).filter(([, w]) => w.mag).map(([id, w]) => [id, { mag: w.mag, reserve: w.reserve, shotAt: -Infinity, reloadAt: 0 }])), shotIds: new Set(), requestIds: new Set(), actions: 0 };
      if (!spawn(p)) return post(link, { type: 'error', error: 'spawn_blocked' });
      players.set(p.id, p);
    }
    if (!hostId) hostId = p.id;
    p.link = link; p.lastSeen = now(); p.budget = R.inputBudget; p.requestIds.clear(); links.set(link, p.id);
    post(link, { type: 'welcome', id: p.id, token: p.token, room: roomId, hostId, snapshot: snapshot() });
    event({ kind: 'joined', actorId: p.id }); emitSnapshot();
  }

  function releaseItems(p) {
    const paper = items.newspaper === p.id;
    for (const id of Object.keys(items)) if (items[id] === p.id) items[id] = null;
    party.release(p.id); social?.releaseItem(p.id); rc?.releasePlayer(p.id); p.held = null; if (paper) advanceNewspaper();
  }
  function releaseSeat(p) { for (const id of Object.keys(seats)) if (seats[id] === p.id) seats[id] = null; p.seat = null; p.seatOrigin = null; p.eyeY = null; p.lookYaw = p.yaw; }
  function release(p) { releaseItems(p); releaseSeat(p); social?.release(p.id); }
  function disconnect(link) {
    const p = players.get(links.get(link)); links.delete(link);
    if (!p || p.link !== link) return;
    p.link = null; p.lastSeen = now(); leaveService(p, { restore: false }); release(p);
    event({ kind: 'left', actorId: p.id }); emitSnapshot();
  }

  function applyInputs(p, input) {
    if (!Array.isArray(input) || input.length > R.maxInputBatch) return false;
    for (const cmd of input) {
      if (!plain(cmd) || !Number.isSafeInteger(cmd.seq) || cmd.seq <= p.ack || !['dt', 'dx', 'dz', 'yaw', 'pitch'].every(k => finite(cmd[k]))) continue;
      const dt = clamp(cmd.dt, 0, R.maxInputDt), allowed = Math.min(dt, p.budget);
      p.budget -= allowed; p.ack = cmd.seq;
      p.lookYaw = cmd.yaw % (Math.PI * 2); if (!p.seat) p.yaw = p.lookYaw;
      p.pitch = clamp(cmd.pitch, -Math.PI / 2.05, Math.PI / 2.05);
      if (finite(cmd.aiming)) p.aiming = p.held ? 0 : clamp(cmd.aiming, 0, 1);
      if (weaponOf(cmd.weapon)) equip(p, cmd.weapon);
      if (p.seat || rc?.isDriving(p.id)) continue;
      const length = Math.hypot(cmd.dx, cmd.dz), max = WALK.run * allowed;
      const k = length > max ? max / length : 1;
      const before = { x: p.x, z: p.z };
      moveCircle(p, cmd.dx * k, cmd.dz * k, col, obstacles(p));
      if (!roomOf(plan, p.x, p.z)) Object.assign(p, before);
      if (cmd.jump === true && p.y < 0.001 && p.vy <= 0) { p.vy = WALK.jump; animate(p, 'jump'); }
    }
    return true;
  }

  function mutateApartment(p, action) {
    if (p.id !== hostId || !plain(action.apartment) || JSON.stringify(action.apartment).length > 32000) return false;
    apartment = copy(action.apartment); revision++; epoch++;
    releaseAll(); setGeometry(action); effects = []; effectsBytes = 2; effectSizes.clear(); pendingExternal.clear(); broken.clear();
    for (const other of inApartment()) {
      const q = findFree(plan, other, col, obstacles(other)); if (q) { other.x = q.x; other.z = q.z; }
    }
    event({ kind: 'apartment', actorId: p.id, revision }); emitSnapshot(); return true;
  }
  const releaseAll = () => { for (const p of players.values()) release(p); };

  // One authority transaction for every carryable family. No optimistic ownership
  // changes on clients; two simultaneous handoffs can never duplicate a prop.
  function handoff(p, action) {
    const target = players.get(action.targetId);
    if (!target || target === p || target.link === null || target.inService || p.held !== action.id || target.held ||
      social?.heldBy(target.id) || party.held(target.id) || rc?.held(target.id) ||
      distance([p.x, p.eyeY ?? p.y + 1.2, p.z], [target.x, target.eyeY ?? target.y + 1.2, target.z]) > R.itemReach || pathBlocked(p, target)) return false;
    // Walking proxies have no height. Use actual 3D item bounds so a low
    // table/stool does not become an invisible ceiling-high handoff barrier.
    const eye = actor => actor.eyeY ?? actor.y + WALK.height / 100 * WALK.eyeRatio;
    const origin = [p.x, eye(p) - R.handoffEyeOffset, p.z];
    const delta = [target.x - p.x, eye(target) - eye(p), target.z - p.z], length = Math.hypot(...delta);
    if (length > 0.01) {
      const direction = delta.map(n => n / length), geometry = [...objects.values()];
      if (geometry.some(o => !broken.has(o.unitId) && !(o.unitId.startsWith('party:') && party.status(o.unitId.slice(6)) !== 'ready') &&
        rayBox(origin, direction, o.bounds, length - 0.01))) return false;
      const represented = box => geometry.some(o => o.bounds[0] >= box.x0 - R.collisionGeometryMargin && o.bounds[3] <= box.x1 + R.collisionGeometryMargin &&
        o.bounds[2] >= box.z0 - R.collisionGeometryMargin && o.bounds[5] <= box.z1 + R.collisionGeometryMargin);
      if (extra.some(box => box.ax === undefined && !represented(box) && rayBox(origin, direction,
        [box.x0, 0, box.z0, box.x1, plan.ceiling, box.z1], length - 0.01))) return false;
    }
    let accepted = false;
    if (items[action.id] === p.id) { items[action.id] = target.id; accepted = true; }
    else for (const family of [party, social, rc]) {
      if (family?.transfer?.(p.id, target.id, action.id, [p, target])?.ok) { accepted = true; break; }
    }
    if (!accepted) return false;
    target.held = action.id; p.held = null; target.weapon = 'none'; target.aiming = 0;
    animate(p, 'drop', action.id, [target.x, target.eyeY ?? target.y + 1.2, target.z]);
    animate(target, 'pickup', action.id, [p.x, p.eyeY ?? p.y + 1.2, p.z]);
    event({ kind: 'handoff', actorId: p.id, targetId: target.id, itemId: action.id });
    emitSnapshot(); return true;
  }

  function reload(p, weapon) {
    const w = weaponOf(weapon), a = Object.hasOwn(p.ammo, weapon) ? p.ammo[weapon] : null;
    if (!w || !a || p.held || p.weapon !== weapon || a.reloadAt || a.mag >= w.mag || !w.infiniteReserve && a.reserve <= 0) return false;
    a.reloadAt = time + w.reload; animate(p, 'reload', weapon); return true;
  }

  function shoot(p, action, worldTrace, externalTrace) {
    const w = weaponOf(action.weapon), a = Object.hasOwn(p.ammo, action.weapon) ? p.ammo[action.weapon] : null;
    if (!w?.damage || !a || p.held || !vec(action.origin) || !vec(action.direction) || typeof action.shotId !== 'string' || action.shotId.length > 96 || p.shotIds.has(action.shotId)) return false;
    if (distance(action.origin, [p.x, p.eyeY ?? p.y + WALK.height / 100 * WALK.eyeRatio, p.z]) > R.originTolerance) return false;
    if (a.reloadAt || !a.mag || time - a.shotAt < Math.max(1 / w.rate, w.cycle || 0) - 0.025) return false;
    if (!Array.isArray(action.rays) || !action.rays.length || action.rays.length > w.pellets) return false;
    const baseLength = Math.hypot(...action.direction);
    if (baseLength < 0.99 || baseLength > 1.01) return false;
    for (const ray of action.rays) {
      if (!plain(ray) || !vec(ray.direction) || Math.abs(Math.hypot(...ray.direction) - 1) > 0.01 || ray.direction.reduce((s, n, i) => s + n * action.direction[i], 0) < 0.96) return false;
    }
    a.mag--; a.shotAt = time; p.weapon = action.weapon; p.shotIds.add(action.shotId);
    animate(p, 'fire', action.weapon);
    if (p.shotIds.size > 128) p.shotIds.delete(p.shotIds.values().next().value);
    const rays = [], hits = [];
    for (const [rayIndex, ray] of action.rays.entries()) {
      const surfaces = [];
      // Production supplies exact Three.js observations through the host's private
      // Worker channel. A guest packet cannot set this argument. AABB fallback
      // keeps the portable core testable without a renderer.
      if (worldTrace !== undefined) {
        for (const observation of boundedArray(worldTrace?.[rayIndex], R.maxEffectsPerRay)) {
          if (!plain(observation) || typeof observation.objectId !== 'string' || observation.objectId.length > 500) continue;
          // Exact host traces can see a model before its manifest refresh reaches
          // this worker. Its opaque geometry must still stop the bullet.
          const o = objects.get(observation.objectId) || { id: observation.objectId, unitId: observation.objectId,
            glass: observation.kind === 'glass', breakable: null, dependentIds: [] };
          if (broken.has(o.unitId) || broken.has(o.id) || !vec(observation.point) || !vec(observation.normal) ||
            !finite(observation.distance) || observation.distance < 0.005 || observation.distance > w.range ||
            Math.abs(Math.hypot(...observation.normal) - 1) > 0.02) continue;
          surfaces.push({ point: [...observation.point], normal: [...observation.normal], distance: observation.distance, object: o });
        }
      } else for (const o of objects.values()) {
          if (broken.has(o.unitId) || broken.has(o.id)) continue;
          const hit = rayBox(action.origin, ray.direction, o.bounds, w.range);
          if (hit) surfaces.push({ ...hit, object: o });
      }
      surfaces.sort((a, b) => a.distance - b.distance);
      const accepted = [], seen = new Set(); let range = w.range;
      const animal = hunt.raycast(action.origin, ray.direction, w.range);
      const vehicle = rc?.raycast(action.origin, ray.direction, w.range);
      const candidate = externalTrace?.[rayIndex];
      const external = plain(candidate) && typeof candidate.animalId === 'string' && candidate.animalId.length <= 120 &&
        Object.hasOwn(EXTERNAL_TARGET_RULES, candidate.species) && finite(candidate.distance) && candidate.distance > 0.005 && candidate.distance <= w.range &&
        vec(candidate.point) && vec(candidate.normal) ? { animalId: candidate.animalId, species: candidate.species,
          distance: candidate.distance, point: [...candidate.point], normal: [...candidate.normal], running: !!candidate.running } : null;
      const nearest = Math.min(animal?.distance ?? Infinity, external?.distance ?? Infinity, vehicle?.distance ?? Infinity);
      for (const surface of surfaces) {
        if (surface.distance >= nearest) break;
        const o = surface.object;
        if (seen.has(o.unitId)) continue;
        seen.add(o.unitId);
        const effect = { kind: o.glass ? 'glass' : 'surface', objectId: o.id, unitId: o.unitId,
          point: surface.point, normal: surface.normal, distance: surface.distance, material: o.breakable };
        accepted.push(effect);
        if (o.breakable) {
          if (o.unitId.startsWith('party:')) party.breakItem(o.unitId.slice(6), surface.point);
          else { broken.add(o.unitId); for (const id of o.dependentIds) broken.add(id); }
        }
        if (!o.glass) { range = Math.max(0, effect.distance - 0.01); break; }
        if (accepted.length >= R.maxEffectsPerRay) break;
      }
      const vehicleHit = vehicle && vehicle.distance <= range && vehicle.distance <= (animal?.distance ?? Infinity) && vehicle.distance <= (external?.distance ?? Infinity) ? vehicle : null;
      if (vehicleHit) {
        const result = rc.damage(vehicleHit.id, w.damage);
        if (result.ok) {
          const { hp, maxHp, destroyed } = result;
          Object.assign(vehicleHit, { hp, maxHp, destroyed });
        }
        range = Math.min(range, Math.max(0, vehicleHit.distance - 0.01));
      }
      const externalHit = external && external.distance <= range && external.distance <= (animal?.distance ?? Infinity) ? external : null;
      if (externalHit) range = Math.min(range, Math.max(0, externalHit.distance - 0.01));
      const hit = hunt.hit({ origin: action.origin, direction: ray.direction, weapon: action.weapon, range, playerId: p.id });
      if (hit) { hits.push(hit); p.score += hit.points || 0; if (hit.killed) p.kills++; }
      rays.push({ direction: [...ray.direction], effects: accepted, ...(hit ? { hit } : {}), ...(externalHit ? { externalHit } : {}), ...(vehicleHit ? { vehicleHit } : {}) });
    }
    const shot = event({ kind: 'shot', actorId: p.id, shotId: action.shotId, weapon: action.weapon,
      origin: [...action.origin], direction: [...action.direction], rays, hits });
    if (rays.some(ray => ray.externalHit)) {
      pendingExternal.set(`${p.id}:${action.shotId}`, shot);
      if (pendingExternal.size > R.maxEffects) pendingExternal.delete(pendingExternal.keys().next().value);
    }
    effects.push(shot); const size = byteLength(shot) + 1; effectSizes.set(shot.id, size); effectsBytes += size;
    while (effects.length && (effects.length > R.maxEffects || effectsBytes > R.maxEffectsBytes)) {
      const removed = effects.shift(); effectsBytes -= effectSizes.get(removed.id) || 0; effectSizes.delete(removed.id);
    }
    return true;
  }

  function receive(link, packet, { worldTrace, externalTrace } = {}) {
    if (disposed || !plain(packet)) return;
    const p = players.get(links.get(link)); if (!p || p.link !== link) return;
    p.lastSeen = now();
    if (packet.type === 'leave') return disconnect(link);
    if (packet.type === 'ping') return post(link, { type: 'pong', clientTime: packet.clientTime, time });
    if (packet.type !== 'action' || !plain(packet.action)) return;
    const action = packet.action;
    if (typeof action.requestId === 'string' && action.requestId.length <= 128) {
      if (p.requestIds.has(action.requestId)) return result(link, action, false, 'replayed_request');
      p.requestIds.add(action.requestId);
      if (p.requestIds.size > 256) p.requestIds.delete(p.requestIds.values().next().value);
    }
    if (++p.actions > 120) return result(link, action, false, 'rate_limited');
    const kind = action.kind || action.type;
    if (kind === 'service-level') {
      const ok = serviceAction(p, action);
      result(link, action, ok, ok ? null : 'action_rejected');
      if (ok && action.verb !== 'input') emitSnapshot();
      return;
    }
    if (p.inService && !['ambient', 'geometry'].includes(kind)) return result(link, action, false, 'action_rejected');
    let ok = false;
    switch (kind) {
      case 'inputs': ok = applyInputs(p, action.inputs); break;
      case 'input': ok = applyInputs(p, [action]); break;
      case 'look': if ((p.seat || rc?.isDriving(p.id)) && [action.yaw, action.pitch, action.aiming].every(finite)) {
        p.lookYaw = action.yaw % (Math.PI * 2); p.pitch = clamp(action.pitch, -Math.PI / 2.05, Math.PI / 2.05);
        p.aiming = p.held ? 0 : clamp(action.aiming, 0, 1); ok = true;
      } break;
      case 'weapon': ok = equip(p, action.weapon); break;
      case 'shoot': ok = shoot(p, action, worldTrace, externalTrace); break;
      case 'reload': ok = reload(p, action.weapon); break;
      case 'handoff': ok = handoff(p, action); break;
      case 'rc': {
        if (!rc || p.seat && ['take', 'drive'].includes(action.verb)) break;
        const controller = rc.controllers.find(item => item.id === action.id);
        if (action.verb === 'take' && (!controller || pathBlocked(p, { x: controller.position[0], z: controller.position[2] }))) break;
        const previous = p.held;
        const accepted = rc.command({ ...p, eyeY: p.eyeY ?? p.y + WALK.height / 100 * WALK.eyeRatio }, action.verb, action.id, action.input);
        if (!accepted?.ok) break;
        if (action.verb === 'take') {
          // The RC simulation already accepted its ownership. Release the other
          // families separately so the newly acquired controller is preserved.
          const paper = items.newspaper === p.id;
          for (const id of Object.keys(items)) if (items[id] === p.id) items[id] = null;
          party.release(p.id); social?.releaseItem(p.id); if (paper) advanceNewspaper();
          p.weapon = 'none'; p.aiming = 0;
        }
        p.held = rc.held(p.id)?.id || (action.verb === 'release' ? null : previous);
        if (action.verb === 'take' || action.verb === 'release') animate(p, action.verb === 'take' ? 'pickup' : 'drop', action.id, controller?.position);
        ok = true; break;
      }
      case 'social': {
        ok = social?.command({ ...p, eyeY: p.eyeY ?? p.y + WALK.height / 100 * WALK.eyeRatio }, action) || false;
        if (ok && ['take', 'receive'].includes(action.verb)) {
          const paper = items.newspaper === p.id;
          for (const id of Object.keys(items)) if (items[id] === p.id) items[id] = null;
          party.release(p.id); rc?.releasePlayer(p.id); if (paper) advanceNewspaper();
          p.held = 'pizza'; p.weapon = 'none'; p.aiming = 0; animate(p, 'pickup', 'pizza');
        } else if (ok && ['place', 'return'].includes(action.verb)) { p.held = null; animate(p, 'drop', 'pizza'); }
        else if (ok && action.verb === 'eat') animate(p, 'use', 'pizza');
        break;
      }
      case 'door': {
        const d = doorMeta.find(d => d.id === action.id);
        if (d && Math.hypot(p.x - d.closed.ax, p.z - d.closed.az) < R.doorReach) {
          if (typeof action.open !== 'boolean') break;
          const from = doors[d.id] ? d.opened : d.closed, to = action.open ? d.opened : d.closed;
          const angle = Math.atan2(from.bz - from.az, from.bx - from.ax);
          const turn = Math.atan2(Math.sin(Math.atan2(to.bz - to.az, to.bx - to.ax) - angle), Math.cos(Math.atan2(to.bz - to.az, to.bx - to.ax) - angle));
          const length = Math.hypot(from.bx - from.ax, from.bz - from.az);
          const blocked = inApartment().some(q => {
            for (let i = 0; i <= 12; i++) {
              const k = i / 12, ax = from.ax + (to.ax - from.ax) * k, az = from.az + (to.az - from.az) * k;
              const vx = Math.cos(angle + turn * k) * length, vz = Math.sin(angle + turn * k) * length;
              const projection = clamp(((q.x - ax) * vx + (q.z - az) * vz) / (length * length), 0, 1);
              if (Math.hypot(q.x - ax - vx * projection, q.z - az - vz * projection) < WALK.radius + Math.max(from.h, to.h) + 0.02) return true;
            }
            return false;
          });
          if (!blocked) {
            if (doors[action.id] !== action.open) animate(p, 'use', action.id, [d.closed.ax, 1.1, d.closed.az]);
            doors[action.id] = !!action.open; ok = true; event({ kind: 'door', actorId: p.id, targetId: action.id, open: !!action.open });
          }
        } break;
      }
      case 'claim': {
        const item = itemMeta.find(i => i.id === action.id);
        if (item && !items[action.id] && distance(item.position, [p.x, p.y + 1.2, p.z]) < R.itemReach && !pathBlocked(p, { x: item.position[0], z: item.position[2] }) && !broken.has(item.objectId)) {
          releaseItems(p); items[action.id] = p.id; p.held = action.id; p.weapon = 'none'; p.aiming = 0; ok = true;
          animate(p, 'pickup', action.id, item.position);
          event({ kind: 'item', actorId: p.id, targetId: action.id, owner: p.id });
        } break;
      }
      case 'release': if (items[action.id] === p.id) { items[action.id] = null; p.held = null; if (action.id === 'newspaper') advanceNewspaper(); ok = true; animate(p, 'drop', action.id, itemMeta.find(item => item.id === action.id)?.position); event({ kind: 'item', actorId: p.id, targetId: action.id, owner: null }); } break;
      case 'party': {
        if (action.verb === 'fridge' && partySpec?.fridge?.position && pathBlocked(p, { x: partySpec.fridge.position[0], z: partySpec.fridge.position[2] })) break;
        const item = party.snapshot().items.find(item => item.id === action.id);
        if (action.verb === 'take' && item && pathBlocked(p, { x: item.position[0], z: item.position[2] })) break;
        const accepted = party.command({ ...p, eyeY: p.eyeY ?? p.y + WALK.height / 100 * WALK.eyeRatio }, action.verb, action.id, action.direction);
        if (!accepted.ok) break;
        if (action.verb === 'take') {
          social?.releaseItem(p.id); rc?.releasePlayer(p.id);
          // Release only the older phone/paper; the party simulation has already
          // atomically replaced any previous party item owned by this player.
          const paper = items.newspaper === p.id;
          for (const id of Object.keys(items)) if (items[id] === p.id) items[id] = null;
          if (paper) advanceNewspaper();
          p.weapon = 'none'; p.aiming = 0;
        }
        if (action.verb === 'fridge') { event({ kind: 'party', verb: action.verb, state: party.snapshot() }); ok = true; break; }
        const carried = party.held(p.id); p.held = carried?.id || null;
        const kind = action.verb === 'take' ? 'pickup' : action.verb === 'return' ? 'drop' : action.verb;
        animate(p, kind, accepted.item.kind, action.verb === 'take' || action.verb === 'return' ? accepted.item.position : undefined);
        if (p.action && accepted.item.action && ['sip', 'puff'].includes(kind)) p.action.duration = accepted.item.action.duration;
        event({ ...accepted.event, kind: 'party', verb: action.verb, state: party.snapshot() }); ok = true; break;
      }
      case 'interaction': {
        if (typeof action.id !== 'string' || !Object.hasOwn(interactions, action.id)) break;
        const value = normalizedInteraction(action.id, action.value); if (!value) break;
        if (action.id === 'hood') {
          const point = interactionMeta.hoodPosition;
          if (!point || distance(point, [p.x, p.eyeY ?? p.y + WALK.height / 100 * WALK.eyeRatio, p.z]) > R.hoodReach ||
            action.expectedLevel !== undefined && action.expectedLevel !== interactions.hood.level) break;
        } else if (action.id === 'newspaper') { if (items.newspaper !== p.id) break; }
        else if (action.id === 'media:phone') { if (items.phone !== p.id) break; }
        if (action.id.startsWith('media:')) {
          if (action.expectedIndex !== undefined && action.expectedIndex !== interactions[action.id].index) break;
          if (action.automatic && action.id !== 'media:phone' && p.id !== hostId) break;
        }
        if (!action.automatic && JSON.stringify(interactions[action.id]) !== JSON.stringify(value)) {
          const itemId = action.id.startsWith('media:') ? action.id.slice(6) : action.id;
          animate(p, action.id === 'newspaper' ? 'page' : 'use', itemId,
            action.id === 'hood' ? interactionMeta.hoodPosition : itemMeta.find(item => item.id === itemId)?.position);
        }
        interactions[action.id] = value; ok = true;
        event({ kind: 'interaction', actorId: p.id, targetId: action.id, value: copy(value) }); break;
      }
      case 'sit': {
        const seat = seatMeta.find(seat => seat.id === action.id);
        if (seat && p.seat === seat.id) { ok = true; break; }
        if (seat && !rc?.isDriving(p.id) && (!seats[seat.id] || seats[seat.id] === p.id) && Math.hypot(p.x - seat.position[0], p.z - seat.position[2]) <= R.itemReach &&
          roomOf(plan, seat.position[0], seat.position[2]) && !pathBlocked(p, { x: seat.position[0], z: seat.position[2] }) &&
          !others(p).some(other => Math.hypot(other.x - seat.position[0], other.z - seat.position[2]) < WALK.radius * 2)) {
          const seatOrigin = p.seatOrigin || { x: p.x, z: p.z };
          releaseSeat(p); p.seatOrigin = seatOrigin; seats[seat.id] = p.id; p.seat = seat.id; p.x = seat.position[0]; p.z = seat.position[2]; p.y = p.vy = 0;
          p.eyeY = seat.eyeY; p.yaw = p.lookYaw = seat.yaw; p.weapon = 'none'; p.aiming = 0; ok = true;
          animate(p, 'sit', seat.id, seat.position);
          event({ kind: 'seat', actorId: p.id, targetId: seat.id, owner: p.id });
        } break;
      }
      case 'stand': {
        const seat = seatMeta.find(seat => seat.id === p.seat);
        if (seat) {
          const place = standPlace(p, seat);
          if (place) { if (finite(p.lookYaw)) p.yaw = p.lookYaw; releaseSeat(p); p.x = place.x; p.z = place.z; p.y = p.vy = 0; ok = true; animate(p, 'stand', seat.id, seat.position); event({ kind: 'seat', actorId: p.id, targetId: seat.id, owner: null }); }
        } break;
      }
      case 'apartment': ok = mutateApartment(p, action); break;
      case 'geometry': if (p.id === hostId) {
        const owners = { ...items }, seated = { ...seats }; setGeometry(action);
        items = Object.fromEntries(Object.keys(items).map(id => [id, owners[id] || null])); seats = Object.fromEntries(Object.keys(seats).map(id => [id, seated[id] || null]));
        for (const player of players.values()) {
          if (player.held && items[player.held] !== player.id && party.held(player.id)?.id !== player.held && rc?.held(player.id)?.id !== player.held && !social?.heldBy(player.id)) player.held = null;
          if (player.seat && seats[player.seat] !== player.id) releaseSeat(player);
          else if (player.seat) { const seat = seatMeta.find(seat => seat.id === player.seat); player.x = seat.position[0]; player.z = seat.position[2]; player.eyeY = seat.eyeY; }
        }
        ok = true;
      } break;
      case 'clear': if (p.id === hostId) { party.reset(); for (const player of players.values()) if (!items[player.held] && !rc?.held(player.id) && !social?.heldBy(player.id)) player.held = null; broken.clear(); effects = []; effectsBytes = 2; effectSizes.clear(); pendingExternal.clear(); epoch++; ok = true; event({ kind: 'clear', actorId: p.id }); } break;
      case 'ambient': if (p.id === hostId && link === 'local' && plain(action.ambient)) {
        try { if (byteLength(action.ambient) <= R.maxAmbientBytes) { ambient = copy(action.ambient); ambientExtra = sanitizeCollision({ extra: ambient.collision || [] }); ok = true; } } catch { /* Reject non-serializable host state. */ }
      } break;
    }
    result(link, action, ok, ok ? null : 'action_rejected');
  }

  function snapshot() {
    return { type: 'snapshot', seq: ++seq, time, epoch, hostId, apartment, revision,
      players: active().map(p => ({ id: p.id, name: p.name, avatar: p.avatar, ...(p.inService ? { inService: true } : {}), x: q(p.x), y: q(p.y), z: q(p.z),
        yaw: q(p.yaw), lookYaw: q(p.lookYaw ?? p.yaw), pitch: q(p.pitch), vy: q(p.vy), verticalSpeed: q(p.vy), grounded: p.y <= 0.001 && p.vy <= 0,
        aiming: q(p.aiming || 0), action: p.action ? copy(p.action) : null,
        reloading: !!p.ammo[p.weapon]?.reloadAt,
        reloadProgress: p.ammo[p.weapon]?.reloadAt ? q(clamp(1 - (p.ammo[p.weapon].reloadAt - time) / WEAPON_RULES[p.weapon].reload, 0, 1)) : 0,
        shotAge: finite(p.ammo[p.weapon]?.shotAt) ? q(Math.max(0, time - p.ammo[p.weapon].shotAt)) : null,
        weapon: p.weapon, score: p.score, kills: p.kills, held: p.held, eyeY: p.eyeY ?? q(p.y + WALK.height / 100 * WALK.eyeRatio), carried: rc?.held(p.id) ? 'controller' : party.held(p.id)?.kind || null, seat: p.seat,
        seatY: p.seat ? seatMeta.find(seat => seat.id === p.seat)?.position[1] ?? 0 : null,
        reclined: !!p.seat && seatMeta.find(seat => seat.id === p.seat)?.posture === 'recline', ack: p.ack,
        ammo: Object.fromEntries(Object.entries(p.ammo).map(([id, a]) => [id, { mag: a.mag, reserve: a.reserve, reloading: !!a.reloadAt }])) })),
      ...(entrance ? { serviceLevel: service?.snapshot() ?? null, serviceSeed: nextServiceSeed() } : {}),
      doors: { ...doors }, items: { ...items }, seats: { ...seats }, interactions: copy(interactions), broken: [...broken], effects: [...effects], hunt: hunt.snapshot(), ambient, party: party.snapshot(), ...(social ? { social: social.snapshot() } : {}), ...(rc ? { rc: rc.snapshot() } : {}) };
  }
  // Called only by the creator's private simulation bridge after its scene target
  // adapter has applied an already-approved shot. Never exposed as a wire action.
  function completeExternal(shotId, results, actorId) {
    const shot = actorId ? pendingExternal.get(`${actorId}:${shotId}`) : [...pendingExternal.values()].reverse().find(effect => effect.shotId === shotId);
    if (!shot || completedExternal.has(shot.id) || !Array.isArray(results) || results.length > shot.rays.length) return false;
    const p = players.get(shot.actorId); if (!p) return false;
    pendingExternal.delete(`${shot.actorId}:${shotId}`);
    completedExternal.add(shot.id);
    if (completedExternal.size > R.maxEffects * 2) completedExternal.delete(completedExternal.values().next().value);
    const approved = new Map(shot.rays.filter(ray => ray.externalHit).map(ray => [ray.externalHit.animalId, ray.externalHit]));
    const used = new Set(), hits = [];
    for (const result of results) {
      const target = approved.get(result?.animalId), rule = EXTERNAL_TARGET_RULES[target?.species];
      if (!target || !rule || used.has(target.animalId) || typeof result.killed !== 'boolean') continue;
      used.add(target.animalId);
      const killed = rule.killable && result.killed && !killedExternal.has(target.animalId);
      const points = killed ? Math.round(rule.points * (target.running ? rule.runningMultiplier : 1) / 5) * 5 : 0;
      if (killed) { killedExternal.add(target.animalId); p.kills++; p.score += points; }
      if (killedExternal.size > 4096) killedExternal.delete(killedExternal.values().next().value);
      hits.push({ ...target, killed, points });
    }
    if (hits.length) event({ kind: 'external-hit', actorId: p.id, shotId, hits });
    emitSnapshot(); return true;
  }
  const emitSnapshot = () => broadcast(snapshot());
  function step(dt) {
    if (disposed || !hostId) return;
    dt = clamp(dt, 0, 0.05); time += dt; snapshotClock += dt;
    hunt.step(dt); service?.tick(dt);
    const apartmentPlayers = inApartment();
    party.step(dt, apartmentPlayers.map(p => ({ ...p, eyeY: p.eyeY ?? p.y + WALK.height / 100 * WALK.eyeRatio })));
    social?.step(dt, apartmentPlayers.map(p => ({ ...p, eyeY: p.eyeY ?? p.y + WALK.height / 100 * WALK.eyeRatio })));
    social?.reconcileSupport(socialSupport);
    rc?.step(dt, apartmentPlayers);
    for (const player of players.values()) if (player.held && !Object.hasOwn(items, player.held) && !party.held(player.id) && !rc?.held(player.id) && !social?.heldBy(player.id)) player.held = null;
    for (const p of players.values()) {
      p.actions = Math.max(0, p.actions - dt * 100); p.budget = Math.min(R.inputBudget, p.budget + dt);
      if (p.link !== null && now() - p.lastSeen > R.timeoutMs) { disconnect(p.link); continue; }
      if (p.link === null && p.id !== hostId && now() - p.lastSeen > R.resumeMs) { players.delete(p.id); continue; }
      if (p.y > 0 || p.vy > 0) {
        p.vy -= WALK.gravity * dt; p.y = Math.max(0, p.y + p.vy * dt);
        if (!p.y) { p.vy = 0; animate(p, 'land'); }
      }
      for (const [weapon, a] of Object.entries(p.ammo)) if (a.reloadAt && time >= a.reloadAt) {
        refillMagazine(a, WEAPON_RULES[weapon]); a.reloadAt = 0;
      }
    }
    if (snapshotClock >= 1 / R.snapshotHz) { snapshotClock %= 1 / R.snapshotHz; emitSnapshot(); }
    if (now() - started > R.maxRoomMs) { broadcast({ type: 'error', error: 'room_expired' }); disposed = true; }
  }
  return { connect, receive, disconnect, step, snapshot, completeExternal, dispose() { disposed = true; rc?.dispose(); links.clear(); players.clear(); },
    get size() { return active().length; }, get hostId() { return hostId; },
    exportState() { return { roomId, snapshot: snapshot() }; } };
}
