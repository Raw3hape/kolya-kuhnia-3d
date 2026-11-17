// Independent acceptance tests: drive the public authority wire protocol, not
// private item maps. Fixtures retain the authored apartment's collision model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRoomAuthority } from '../web/js/multiplayer/authority.js';
import { NETWORK_RULES as R } from '../web/js/multiplayer/rules.js';
import { WALK } from '../web/js/multiplayer/collision.js';

const read = name => JSON.parse(readFileSync(new URL(`../web/spec/${name}.json`, import.meta.url)));
function fixture({ rc = false } = {}) {
  const plan = read('plan.generated'), partySpec = read('party'), packets = [];
  const rcSpec = rc ? read('rc') : undefined;
  if (rcSpec) rcSpec.table.position = [WALK.start.x, 0, WALK.start.z];
  let clock = 0, serial = 0;
  for (const item of partySpec.items) item.position = [WALK.start.x, 1.2, WALK.start.z];
  if (partySpec.fridge) partySpec.fridge.position = [WALK.start.x, 1.2, WALK.start.z];
  const itemMeta = ['phone', 'newspaper'].map(id => ({ id, position: [WALK.start.x, 1.2, WALK.start.z] }));
  const room = createRoomAuthority({ roomId: 'independent-items', plan, site: read('site'), huntSpec: read('hunt'), partySpec, rcSpec,
    now: () => clock, seed: 13, send: (link, packet) => packets.push({ link, packet: structuredClone(packet) }) });
  const last = (link, type) => packets.findLast(p => p.link === link && p.packet.type === type)?.packet;
  room.connect('local', { type: 'create', version: R.version, name: 'Host', apartment: {}, items: itemMeta });
  const join = link => { room.connect(link, { type: 'join', version: R.version, name: link }); return last(link, 'welcome'); };
  join('guest');
  const id = link => last(link, 'welcome').id;
  const player = link => room.snapshot().players.find(p => p.id === id(link));
  const action = (link, value, trusted) => { room.receive(link, { type: 'action', action: { ...value, requestId: 'independent-' + ++serial } }, trusted); return last(link, 'result'); };
  const step = seconds => { for (let rest = seconds; rest > 1e-8; rest -= .05) {
    const dt = Math.min(.05, rest); clock += dt * 1000;
    // Exercise the real heartbeat contract during long persistence checks.
    if (Math.floor(clock / 1000) !== Math.floor((clock - dt * 1000) / 1000)) {
      for (const link of ['local', 'guest']) room.receive(link, { type: 'ping', clientTime: clock });
    }
    room.step(dt);
  } };
  return { room, action, step, player, id, join, last, itemMeta, partySpec };
}

test('handoff changes both item and actor ownership, rejects stale donor and never duplicates a phone', () => {
  const f = fixture();
  assert(f.action('local', { kind: 'claim', id: 'phone' }).ok);
  assert.equal(f.action('guest', { kind: 'handoff', id: 'phone', targetId: f.id('local') }).ok, false, 'recipient cannot forge donor intent');
  assert(f.action('local', { kind: 'handoff', id: 'phone', targetId: f.id('guest') }).ok);
  let s = f.room.snapshot();
  assert.equal(s.items.phone, f.id('guest'));
  assert.equal(f.player('local').held, null); assert.equal(f.player('guest').held, 'phone');
  assert.equal(f.action('local', { kind: 'handoff', id: 'phone', targetId: f.id('guest') }).ok, false, 'stale donor cannot transfer again');
  assert.equal(f.action('local', { kind: 'release', id: 'phone' }).ok, false);
  s = f.room.snapshot(); assert.equal(s.players.filter(p => p.held === 'phone').length, 1);
  f.room.disconnect('guest'); assert.equal(f.room.snapshot().items.phone, null);
  f.room.dispose();
});

test('busy recipient, self handoff, nonexistent recipient and disconnected recipient leave donor state intact', () => {
  const f = fixture();
  assert(f.action('local', { kind: 'claim', id: 'phone' }).ok);
  assert(f.action('guest', { kind: 'claim', id: 'newspaper' }).ok);
  for (const targetId of [f.id('guest'), f.id('local'), 'nonexistent']) {
    assert.equal(f.action('local', { kind: 'handoff', id: 'phone', targetId }).ok, false);
    assert.equal(f.room.snapshot().items.phone, f.id('local'));
    assert.equal(f.player('local').held, 'phone');
  }
  const guestId = f.id('guest'); f.room.disconnect('guest');
  assert.equal(f.action('local', { kind: 'handoff', id: 'phone', targetId: guestId }).ok, false);
  f.room.dispose();
});

test('handoff cannot pass through a closed barrier even with recipient in reach', () => {
  const f = fixture();
  assert(f.action('local', { kind: 'claim', id: 'phone' }).ok);
  const a = f.player('local'), b = f.player('guest'), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const wideX = Math.abs(a.x - b.x) > Math.abs(a.z - b.z);
  const box = wideX ? { x0: mx - .015, x1: mx + .015, z0: mz - .5, z1: mz + .5 }
    : { x0: mx - .5, x1: mx + .5, z0: mz - .015, z1: mz + .015 };
  assert(f.action('local', { kind: 'geometry', collision: { extra: [box] }, items: f.itemMeta }).ok);
  assert.equal(f.player('local').held, 'phone', 'geometry refresh preserves valid ownership');
  assert.equal(f.action('local', { kind: 'handoff', id: 'phone', targetId: f.id('guest') }).ok, false);
  assert.equal(f.room.snapshot().items.phone, f.id('local'));
  f.room.dispose();
});

test('handoff from a seated donor preserves the seat and gives the recipient the same item', () => {
  const f = fixture();
  const seat = { id: 'independent-seat', position: [WALK.start.x - .8, .45, WALK.start.z], yaw: 0, eyeY: 1.17, stand: [WALK.start.x, WALK.start.z] };
  assert(f.action('local', { kind: 'geometry', seats: [seat], items: f.itemMeta }).ok);
  assert(f.action('local', { kind: 'claim', id: 'phone' }).ok);
  assert(f.action('local', { kind: 'sit', id: seat.id }).ok);
  assert(f.action('local', { kind: 'handoff', id: 'phone', targetId: f.id('guest') }).ok);
  assert.equal(f.player('local').seat, seat.id); assert.equal(f.room.snapshot().seats[seat.id], f.id('local'));
  assert.equal(f.player('guest').held, 'phone');
  f.room.dispose();
});

test('consumed party bottle keeps its exact sip count through handoff and disconnect', () => {
  const f = fixture(), bottle = f.partySpec.items.find(i => i.kind === 'beer');
  assert(f.action('local', { kind: 'party', verb: 'take', id: bottle.id }).ok); f.step(.7);
  assert(f.action('local', { kind: 'party', verb: 'sip', id: bottle.id }).ok); f.step(1.2);
  assert(f.action('local', { kind: 'handoff', id: bottle.id, targetId: f.id('guest') }).ok);
  const item = () => f.room.snapshot().party.items.find(i => i.id === bottle.id);
  assert.equal(item().owner, f.id('guest')); assert.equal(item().sips, 1);
  assert.equal(f.player('local').held, null); assert.equal(f.player('guest').held, bottle.id);
  assert.equal(f.action('local', { kind: 'party', verb: 'sip', id: bottle.id }).ok, false);
  f.room.disconnect('guest'); assert.equal(item().owner, null); assert.equal(item().sips, 1);
  f.room.dispose();
});

test('thrown beer remains broken past its old respawn timer and a late join sees the same debris', () => {
  const f = fixture(), bottle = f.partySpec.items.find(i => i.kind === 'beer');
  assert(f.action('local', { kind: 'party', verb: 'take', id: bottle.id }).ok); f.step(.7);
  assert(f.action('local', { kind: 'party', verb: 'throw', id: bottle.id, direction: [0, -1, 0] }).ok);
  f.step(1);
  const item = () => f.room.snapshot().party.items.find(i => i.id === bottle.id);
  assert.equal(item().status, 'broken'); const serial = item().breakSerial, point = [...item().position];
  f.step(30); assert.equal(item().status, 'broken'); assert.equal(item().breakSerial, serial); assert.deepEqual(item().position, point);
  const welcome = f.join('late');
  assert.deepEqual(welcome.snapshot.party.items.find(i => i.id === bottle.id), item());
  assert.equal(f.action('local', { kind: 'party', verb: 'take', id: bottle.id }).ok, false);
  f.room.dispose();
});

test('RC owner can drive but neither owner nor forged movement can move the human body', () => {
  const f = fixture({ rc: true });
  assert(f.action('local', { kind: 'rc', verb: 'take', id: 'rc-0' }).ok);
  const human = f.player('local'), car = () => f.room.snapshot().rc.cars.find(c => c.id === 'rc-0');
  assert.equal(human.held, 'rc-0');
  assert.equal(f.action('guest', { kind: 'rc', verb: 'input', id: 'rc-0', input: { throttle: 1, steer: 0, brake: false, seq: 1 } }).ok, false);
  assert(f.action('local', { kind: 'rc', verb: 'input', id: 'rc-0', input: { throttle: 1, steer: .4, brake: false, seq: 1 } }).ok);
  f.step(.05);
  assert(f.action('local', { kind: 'inputs', inputs: [{ seq: 1, dt: .05, dx: .15, dz: .15, yaw: 0, pitch: 0, jump: true }] }).ok);
  assert.equal(f.player('local').x, human.x); assert.equal(f.player('local').z, human.z); assert.equal(f.player('local').y, human.y);
  assert.equal(car().owner, f.id('local'));
  for (const input of [{ throttle: 99, steer: 0, brake: false, seq: 2 }, { throttle: 1, steer: NaN, brake: false, seq: 2 }, { throttle: 1, steer: 0, brake: 'false', seq: 2 }, { throttle: 1, steer: 0, brake: false, seq: 1 }])
    assert.equal(f.action('local', { kind: 'rc', verb: 'input', id: 'rc-0', input }).ok, false);
  assert.equal(car().hp, car().maxHp); f.room.dispose();
});

test('RC handoff carries the controller without forcing driving, clears sticky input and disconnect frees it', () => {
  const f = fixture({ rc: true }), input = { throttle: 1, steer: .5, brake: false, seq: 1 };
  assert(f.action('local', { kind: 'rc', verb: 'take', id: 'rc-0' }).ok);
  assert(f.action('local', { kind: 'rc', verb: 'input', id: 'rc-0', input }).ok);
  assert(f.action('local', { kind: 'handoff', id: 'rc-0', targetId: f.id('guest') }).ok);
  const car = () => f.room.snapshot().rc.cars.find(c => c.id === 'rc-0');
  assert.equal(car().owner, f.id('guest')); assert.equal(car().input.throttle, 0); assert.equal(car().input.steer, 0);
  assert.equal(f.player('local').held, null); assert.equal(f.player('guest').held, 'rc-0');
  assert.equal(f.action('local', { kind: 'rc', verb: 'input', id: 'rc-0', input: { ...input, seq: 2 } }).ok, false);
  assert.equal(car().controlMode, 'carry'); assert.equal(car().input.brake, true);
  const recipientBefore=f.player('guest');assert(f.action('guest',{kind:'inputs',inputs:[{seq:1,dt:.05,dx:0,dz:.15,yaw:0,pitch:0}]}).ok);assert(f.player('guest').z>recipientBefore.z+.1,'recipient can step away while carrying the received controller');
  assert.equal(f.action('guest', { kind: 'rc', verb: 'input', id: 'rc-0', input }).ok, false, 'recipient does not drive without consent');
  assert(f.action('guest', { kind: 'rc', verb: 'drive', id: 'rc-0' }).ok);
  assert(f.action('guest', { kind: 'rc', verb: 'input', id: 'rc-0', input }).ok, 'new owner explicitly starts driving with a new input sequence');
  f.room.disconnect('guest'); assert.equal(car().owner, null); assert.equal(car().status, 'ready');
  assert(f.action('local', { kind: 'rc', verb: 'take', id: 'rc-0' }).ok); f.room.dispose();
});

test('seated recipient can carry a controller but cannot drive until standing', () => {
  const f = fixture({ rc: true });
  const guest = f.player('guest'), seat = { id: 'rc-recipient-seat', position: [guest.x, .45, guest.z - .5], yaw: 0, eyeY: 1.17, stand: [guest.x, guest.z] };
  assert(f.action('local', { kind: 'geometry', seats: [seat], items: f.itemMeta }).ok);
  assert(f.action('guest', { kind: 'sit', id: seat.id }).ok);
  assert(f.action('local', { kind: 'rc', verb: 'take', id: 'rc-0' }).ok);
  assert(f.action('local', { kind: 'handoff', id: 'rc-0', targetId: f.id('guest') }).ok);
  assert.equal(f.player('guest').seat, seat.id); assert.equal(f.player('guest').held, 'rc-0');
  assert.equal(f.room.snapshot().rc.cars[0].controlMode, 'carry');
  assert.equal(f.action('guest', { kind: 'rc', verb: 'drive', id: 'rc-0' }).ok, false, 'seated carry cannot turn into driving');
  assert.equal(f.action('guest', { kind: 'rc', verb: 'input', id: 'rc-0', input: { throttle: 1, steer: 0, brake: false, seq: 1 } }).ok, false);
  assert(f.action('guest', { kind: 'stand' }).ok);
  assert(f.action('guest', { kind: 'rc', verb: 'drive', id: 'rc-0' }).ok); f.room.dispose();
});

test('ten authority clients receive ten distinct RC designs and colors; eleventh client remains rejected', () => {
  const f = fixture({ rc: true }), links = ['local', 'guest'];
  for (let i = 2; i < 10; i++) { const link = 'driver-' + i; assert(f.join(link)); links.push(link); }
  links.forEach((link, i) => assert(f.action(link, { kind: 'rc', verb: 'take', id: 'rc-' + i }).ok, `driver ${i} takes their controller`));
  const cars = f.room.snapshot().rc.cars.filter(c => c.owner);
  assert.equal(cars.length, 10); assert.equal(new Set(cars.map(c => c.owner)).size, 10);
  assert.equal(new Set(cars.map(c => c.designId)).size, 10); assert.equal(new Set(cars.map(c => c.color)).size, 10);
  assert.equal(f.join('eleventh'), undefined); assert.equal(f.last('eleventh', 'error').error, 'room_full');
  const lateState = f.room.snapshot();
  for (const player of lateState.players) assert.equal(lateState.rc.cars.filter(c => c.owner === player.id).length, 1);
  f.room.dispose();
});

test('fridge gates energy pickup; five accepted sips, crush, floor litter and timed effects survive protocol boundaries', () => {
  const f = fixture(), drink = f.partySpec.items.find(i => i.kind === 'energy'); assert(drink, 'authored fridge has energy stock');
  const command = (verb, link = 'local') => f.action(link, { kind: 'party', verb, id: drink.id, direction: [0, -1, 0] });
  const item = () => f.room.snapshot().party.items.find(i => i.id === drink.id);
  assert.equal(command('take').ok, false, 'closed fridge prevents remote item pickup');
  assert(command('fridge').ok); assert.equal(f.room.snapshot().party.fridgeOpen, true);
  assert(command('take').ok); f.step(.7); assert.equal(command('crush').ok, false, 'full bottle cannot be crushed');
  for (let sip = 1; sip <= 5; sip++) {
    assert(command('sip').ok); assert.equal(item().sips, sip);
    assert.equal(command('sip').ok, false, 'repeat press during sip is rejected'); f.step(1.2);
  }
  assert.equal(command('sip').ok, false, 'sixth sip is rejected'); assert.equal(item().sips, 5);
  const boost = f.room.snapshot().party.boosts.find(b => b.actorId === f.id('local')); assert(boost);
  assert.equal(f.room.snapshot().party.boosts.some(b => b.actorId === f.id('guest')), false, 'spectator does not inherit drink effect');
  assert(command('crush').ok); f.step(.8); assert.equal(item().crushed, true);
  assert(command('throw').ok); f.step(1); assert.equal(item().status, 'resting'); const point = [...item().position];
  f.step(20); assert.equal(item().status, 'resting'); assert.deepEqual(item().position, point);
  assert.equal(f.room.snapshot().party.boosts.length, 0, 'camera effect expires by authority time');
  const late = f.join('energy-late'); assert.deepEqual(late.snapshot.party.items.find(i => i.id === drink.id), item());
  f.room.dispose();
});

test('RC HP obeys trusted opaque occlusion, ignores forged damage and accepts visible weapon hits', () => {
  const f = fixture({ rc: true }); assert(f.action('local', { kind: 'rc', verb: 'take', id: 'rc-0' }).ok); f.step(.1);
  const car = () => f.room.snapshot().rc.cars.find(c => c.id === 'rc-0');
  const shoot = (id, trace) => {
    const p = f.player('guest'), origin = [p.x, p.eyeY, p.z], target = car().position.map((n, i) => n + (i === 1 ? .06 : 0));
    const delta = target.map((n, i) => n - origin[i]), length = Math.hypot(...delta), direction = delta.map(n => n / length);
    return f.action('guest', { kind: 'shoot', weapon: 'pistol', shotId: id, origin, direction, rays: [{ direction }], worldTrace: [] },
      { worldTrace: [trace ? [{ objectId: 'independent-opaque-barrier', kind: 'surface', point: origin.map((n, i) => n + direction[i]), normal: [0, 0, 1], distance: 1 }] : []] });
  };
  assert(shoot('occluded-car', true).ok); assert.equal(car().hp, 100);
  assert.equal(f.action('guest', { kind: 'rc', verb: 'damage', id: 'rc-0', amount: 100 }).ok, false);
  assert.equal(f.action('guest', { kind: 'rc', verb: 'input', id: 'rc-0', input: { throttle: 0, steer: 0, brake: false, seq: 1 }, hp: 0 }).ok, false);
  assert.equal(car().hp, 100); f.step(.2);
  assert(shoot('visible-car', false).ok); assert.equal(car().hp, 66, 'pistol damage comes from host weapon rules');
  const accepted = car().hp;
  assert.equal(shoot('visible-car', false).ok, false); assert.equal(car().hp, accepted, 'replayed shot cannot damage again');
  f.step(2.2);
  assert(f.action('local', { kind: 'rc', verb: 'respawn', id: 'rc-0' }).ok, 'driver can manually recover a flipped active car');
  assert.equal(car().hp, accepted, 'manual recovery cannot heal accepted combat damage');
  f.room.dispose();
});

test('a hooked hose can be handed over only while the recipient remains within its physical length', () => {
  const f = fixture(), hookah = f.partySpec.items.find(i => i.kind === 'hookah');
  assert(f.action('local', { kind: 'party', verb: 'take', id: hookah.id }).ok); f.step(.7);
  const a = f.player('local'), b = f.player('guest'), dx = a.x - b.x, dz = a.z - b.z, length = Math.hypot(dx, dz);
  const source = [a.x + dx / length * 2.2, a.eyeY, a.z + dz / length * 2.2];
  assert(f.action('local', { kind: 'geometry', items: f.itemMeta, partySpec: { items: [{ id: hookah.id, position: source }] } }).ok);
  assert.equal(f.action('local', { kind: 'handoff', id: hookah.id, targetId: f.id('guest') }).ok, false, 'two nearby players cannot stretch hose beyond its source');
  const nearSource = [a.x, a.eyeY, a.z];
  assert(f.action('local', { kind: 'geometry', items: f.itemMeta, partySpec: { items: [{ id: hookah.id, position: nearSource }] } }).ok);
  assert(f.action('local', { kind: 'handoff', id: hookah.id, targetId: f.id('guest') }).ok);
  assert.equal(f.player('guest').held, hookah.id); f.room.dispose();
});

// A navigation footprint is deliberately 2D; handoffs must respect real height.
test('low furniture allows passing above it while tall opaque furniture still blocks', () => {
  const f = fixture(); assert(f.action('local', { kind: 'claim', id: 'phone' }).ok);
  const a=f.player('local'), b=f.player('guest'), mx=(a.x+b.x)/2, mz=(a.z+b.z)/2;
  const box=Math.abs(a.x-b.x)>Math.abs(a.z-b.z)?{x0:mx-.015,x1:mx+.015,z0:mz-.5,z1:mz+.5}:{x0:mx-.5,x1:mx+.5,z0:mz-.015,z1:mz+.015};
  const geometry = height => ({ kind:'geometry', collision:{extra:[box]}, items:f.itemMeta, objects:[{id:'counter',bounds:[box.x0,0,box.z0,box.x1,height,box.z1]}] });
  assert(f.action('local',geometry(.7)).ok);
  assert(f.action('local',{kind:'handoff',id:'phone',targetId:f.id('guest')}).ok);
  assert(f.action('local',geometry(2.3)).ok);
  assert.equal(f.action('guest',{kind:'handoff',id:'phone',targetId:f.id('local')}).ok,false);
  assert.equal(f.room.snapshot().items.phone,f.id('guest')); f.room.dispose();
});


test('pausing preserves controller ownership while authority allows walking and jumping; resumed driving freezes again', () => {
 const f=fixture({rc:true}),car=()=>f.room.snapshot().rc.cars.find(c=>c.id==='rc-0');
 try{
  assert(f.action('local',{kind:'rc',verb:'take',id:'rc-0'}).ok);assert.equal(car().controlMode,'drive');
  const start=f.player('local');assert(f.action('local',{kind:'inputs',inputs:[{seq:1,dt:.05,dx:-.15,dz:0,yaw:0,pitch:0,jump:true}]}).ok);f.step(.1);
  assert.equal(f.player('local').x,start.x);assert.equal(f.player('local').y,0);
  assert(f.action('local',{kind:'rc',verb:'pause',id:'rc-0'}).ok);assert.equal(car().controlMode,'carry');assert.equal(f.player('local').held,'rc-0');
  assert.equal(f.action('guest',{kind:'rc',verb:'drive',id:'rc-0'}).ok,false);
  assert(f.action('local',{kind:'inputs',inputs:[{seq:2,dt:.05,dx:-.15,dz:0,yaw:0,pitch:0,jump:true}]}).ok);f.step(.05);
  assert(f.player('local').x<start.x-.1,`owner can step aside: start ${start.x},${start.z}; after ${f.player('local').x},${f.player('local').z}; guest ${f.player('guest').x},${f.player('guest').z}`);assert(f.player('local').y>0,'carry permits an ordinary jump');
  assert.equal(f.action('local',{kind:'look',yaw:1,pitch:0,aiming:0}).ok,false,'carry uses normal walk look inputs');
  f.step(1.5);assert(f.action('local',{kind:'rc',verb:'drive',id:'rc-0'}).ok);const resumed=f.player('local');
  assert(f.action('local',{kind:'look',yaw:1,pitch:0,aiming:0}).ok,'driving uses camera-only look');
  assert(f.action('local',{kind:'inputs',inputs:[{seq:3,dt:.05,dx:-.15,dz:0,yaw:1,pitch:0,jump:true}]}).ok);f.step(.1);
  assert.equal(f.player('local').x,resumed.x);assert.equal(f.player('local').z,resumed.z);assert.equal(f.player('local').y,0);
 }finally{f.room.dispose();}
});
