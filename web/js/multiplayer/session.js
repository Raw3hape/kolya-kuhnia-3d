// Integration adapter: apartment modules keep their single-player API and rules.
import { createMultiplayerClient } from './client.js';
import { createMultiplayerLobby } from './lobby.js';
import { createHostAuthority } from './host.js';
import { createAvatar } from './avatars.js';
import { createShotRenderer } from './shots.js';
import { createHandoffUI } from './handoff-ui.js';
import { NETWORK_RULES as R } from './rules.js';
import { sampleAvatarAction, selectAvatarPresentation } from './action-contract.js';

const angle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export function createMultiplayerSession({ THREE, scene, plan, site, getState, applyState, getModules, requestRender, ui, getParty = () => getModules().party, whenReady = Promise.resolve() }) {
  const avatars = new Map(), samples = [], inputs = [], seenEvents = new Set();
  const shots = createShotRenderer({ THREE, scene, requestRender });
  let active = false, applying = false, revision = -1, epoch = -1, lastSnapshot = null, disposed = false;
  let appliedHunt = null, started = false, sendClock = 0, ambientClock = 0, geometryTimer = null, changeSerial = 0;
  let apartmentQueue = Promise.resolve(), previousState = null, sessionRole = null, lifecycle = 0, pendingApartments = 0, wasWalking = false, sentWeapon = null;
  let manifestDecor = null, manifestFurniture = null, manifestPass = -1, manifestPending = false;
  let appliedAmbient = null, ambientModule = null;
  let damageModule = null, damageEffects = null, damageBroken = null;
  const style = document.createElement('style');
  style.textContent = `body[data-multiplayer-role="guest"] :is(#tab-mat,#tab-kitchen,#tab-furniture,#tab-light,#pane-mat,#pane-kitchen,#pane-furniture,#pane-light),body[data-multiplayer-role="guest"] .mode[data-mode="design"],body[data-multiplayer-role="guest"] .mode[data-mode="photo"],body[data-multiplayer-role="guest"] #preset-row,body[data-multiplayer-role="guest"] #panel-head .head-row>:not(.hide-btn){display:none!important}body[data-multiplayer-state="reconnecting"] #scene{pointer-events:none}`;
  document.head.append(style);
  style.textContent += 'body[data-multiplayer-role="guest"] #coach{display:none!important}';
  const request = action => client.request(action).catch(error => { ui?.toast?.(error.message); return { ok: false }; });

  const client = createMultiplayerClient({
    createAuthority: async ({ room, send }) => {
      const [huntSpec, partySpec, socialSpec, rcSpec] = await Promise.all(['hunt', 'party', 'social', 'rc'].map(name => fetch(`spec/${name}.json`).then(r => {
        if (!r.ok) throw new Error(`${name}_config`); return r.json();
      })));
      return createHostAuthority({ room, plan, site, huntSpec, partySpec, socialSpec, rcSpec, send,
        resolveSurfaces: (...args) => getModules().viewmodel.resolveNetworkSurfaces(...args),
        resolveExternalTrace: shot => getModules().life?.traceExternalShot?.(shot),
        resolveExternalShot: shot => getModules().life?.resolveExternalShot?.(shot) });
    },
    onSnapshot: receiveSnapshot,
    onEvent: receiveEvent,
    onStatus(value) {
      document.body.dataset.multiplayerState = value.status;
      if (value.status === 'connected') sentWeapon = null;
      if (value.status === 'reconnecting') inputs.length = 0;
      if (active && ['idle', 'closed', 'error'].includes(value.status)) deactivate();
    },
  });

  async function roomState() {
    await apartmentQueue.catch(() => {});
    let modules = getModules();
    await Promise.all([modules.decor?.ready, modules.furniture?.ready, modules.paper?.ready, modules.social?.ready, modules.partyPropsReady, modules.rc?.ready, getParty()?.ready].filter(Boolean));
    modules = getModules();
    // The loader visually grows models after attaching them. Sample authored scale synchronously,
    // then restore the animation; room entry never waits on an arbitrary animation timeout.
    const growing = (modules.decor?.grow || []).map(g => ({ object: g.obj, scale: g.obj.scale.clone(), finalScale: g.s }));
    for (const g of growing) g.object.scale.copy(g.finalScale);
    let objects;
    try { objects = modules.viewmodel.collectNetworkObjects(); }
    finally { for (const g of growing) g.object.scale.copy(g.scale); scene.updateMatrixWorld(true); }
    const interactions = { ...(modules.hood?.snapshot ? { hood: modules.hood.snapshot() } : {}),
      ...(modules.paper?.snapshot ? { newspaper: modules.paper.snapshot() } : {}),
      ...Object.fromEntries(Object.entries(modules.tv?.snapshot?.() || {}).map(([id, value]) => ['media:' + id, value])) };
    return { rcSpec: modules.rc?.config, partySpec: getParty()?.spec, socialMeta: modules.social?.metadata(), apartment: structuredClone(getState()), collision: modules.walk.collisionSnapshot({ includeAmbient: false }), ambientCollision: modules.life?.colliders() || [], objects, interactions,
      interactionMeta: { media: modules.tv?.interactionMeta?.() || {}, newspaperPages: modules.paper?.interactionMeta?.() || [], hoodPosition: modules.hood?.networkPosition?.() },
      doors: modules.doors.snapshot(), seats: modules.seats?.networkSeats?.() || [], items: ['phone', 'newspaper'].flatMap(id => {
        const m = id === 'phone' ? modules.tv : modules.paper, position = m?.networkPosition?.();
        return position ? [{ id, position }] : [];
      }) };
  }

  const lobby = createMultiplayerLobby({ client, getApartment: () => structuredClone(getState()),
    getCollision: () => getModules().walk.collisionSnapshot({ includeAmbient: false }), getRoomState: roomState,
    onJoined() { requestRender(); }, onLeft: deactivate });
  let roomRequestTimer = null;
  const openRoom = () => { clearTimeout(roomRequestTimer); roomRequestTimer = setTimeout(() => { if (active && !disposed) lobby.open(); }, 0); };
  window.addEventListener('kitchen:room-request', openRoom);

  function syncWeapon(weapon) {
    if (!active || !client.connected) return false;
    if (client.self?.held) { sentWeapon = null; return false; }
    if (sentWeapon === weapon) return true;
    if (!client.send({ kind: 'weapon', weapon })) return false;
    sentWeapon = weapon; return true;
  }

  function activate(snapshot) {
    if (active) return;
    active = true; lifecycle++; sessionRole = client.role; previousState = sessionRole === 'guest' ? structuredClone(getState()) : null; started = false;
    sendClock = ambientClock = 0; manifestDecor = manifestFurniture = null; manifestPass = -1; wasWalking = false;
    document.body.dataset.multiplayerRole = sessionRole;
    const m = getModules(); m.furnEditor?.disable(); m.seats?.stand?.();
    m.walk.setNetwork({ onInput(command) {
      if (client.connected) { const vm = getModules().viewmodel; inputs.push({ ...command, weapon: vm.weapon, aiming: vm.aiming }); }
      if (inputs.length > R.maxInputBatch) inputs.splice(0, inputs.length - R.maxInputBatch);
    }, players: () => (lastSnapshot?.players || []).filter(p => p.id !== client.id),
    canExit: () => client.role === 'host', canTeleport: () => false,
    canMove: () => client.connected && !applying && !document.body.classList.contains('kmp-modal-open') && !getModules().rc?.controlling });
    m.doors.setNetwork({ request });
    m.tv.setNetwork({ request, nearbyRecipient: handoff.nearbyRecipient, selfId: () => client.id, isHost: () => client.role === 'host' });
    m.paper.setNetwork({ request, nearbyRecipient: handoff.nearbyRecipient, selfId: () => client.id });
    m.hood?.setNetwork?.({ request, selfId: () => client.id });
    m.viewmodel.setNetwork({ shoot(shot) { if (syncWeapon(shot.weapon)) client.send({ kind: 'shoot', ...shot }); },
      reload(weapon) { if (syncWeapon(weapon)) client.send({ kind: 'reload', weapon }); }, clear() { request({ kind: 'clear' }); } });
    m.hunt?.setNetwork(true); appliedHunt = m.hunt;
    m.life?.setNetwork?.({ authority: client.role === 'host' });
    m.seats?.setNetwork?.({ request, selfId: () => client.id });
    m.social?.setNetwork?.({ request, selfId: () => client.id });
    m.rc?.setNetwork?.({ request, send: action => client.send(action), ready: () => client.connected, selfId: () => client.id, gripForPlayer: id => avatars.get(id)?.root.getObjectByName('right_wrist') });
    getParty()?.setNetwork?.({ request, nearbyRecipient: handoff.nearbyRecipient, selfId: () => client.id, isHost: () => client.role === 'host',
      gripForPlayer: id => avatars.get(id)?.root.getObjectByName('right_wrist') });
    // The panel remains available for weapons and local device settings.
    document.getElementById('tab-live')?.click();
    receiveSnapshot(snapshot);
  }

  function receiveSnapshot(snapshot) {
    if (disposed) return;
    if (!active) { activate(snapshot); return; }
    lastSnapshot = snapshot;
    const m = getModules();
    if (epoch !== snapshot.epoch) {
      epoch = snapshot.epoch; seenEvents.clear(); m.viewmodel.clearHoles({ remote: true }); shots.clear(); getParty()?.clearEffects?.();
      damageModule = null;
    }
    if (revision !== snapshot.revision) {
      revision = snapshot.revision;
      if (client.role !== 'host') {
        const version = lifecycle, apartment = structuredClone(snapshot.apartment);
        pendingApartments++; applying = true;
        apartmentQueue = apartmentQueue.catch(() => {}).then(async () => {
          if (!active || lifecycle !== version) return;
          await applyState(apartment);
          const local=getModules();
          await Promise.all([local.decor?.ready, local.furniture?.ready, local.paper?.ready, local.partyPropsReady, local.rc?.ready, getParty()?.ready].filter(Boolean));
          if (active && lifecycle === version && lastSnapshot?.revision === snapshot.revision) {
            const latest = lastSnapshot, vm = getModules().viewmodel;
            vm.clearHoles({ remote: true });
            vm.reconcileNetworkDamage(latest.effects || [], latest.broken || []);
          }
        }).catch(error => { if (active && lifecycle === version) ui?.toast?.('Не удалось загрузить квартиру: ' + error.message); })
          .finally(() => { if (lifecycle === version) { pendingApartments = Math.max(0, pendingApartments - 1); applying = pendingApartments > 0; } });
      }
    }
    m.doors.applyNetwork(snapshot.doors, { instant: true });
    m.hood?.applyNetwork?.(snapshot.interactions?.hood);
    m.paper.applyInteractionState?.(snapshot.interactions?.newspaper);
    m.tv.applyInteractionState?.(snapshot.interactions || {});
    m.tv.applyNetwork(snapshot.items?.phone ?? null); m.paper.applyNetwork(snapshot.items?.newspaper ?? null);
    getParty()?.applyNetworkSnapshot?.(snapshot.party, { players: snapshot.players, time: snapshot.time, selfId: client.id });
    m.social?.applyNetwork(snapshot.social, snapshot.players);
    m.rc?.applyNetwork?.(snapshot.rc, { players: snapshot.players, time: snapshot.time, selfId: client.id });
    handoff.update();
    const me = snapshot.players.find(p => p.id === client.id);
    m.seats?.applyNetwork?.(snapshot.seats || {}, me, { instant: !started });
    if (m.viewmodel !== damageModule || snapshot.effects !== damageEffects || snapshot.broken !== damageBroken) {
      m.viewmodel.reconcileNetworkDamage(snapshot.effects || [], snapshot.broken || []);
      damageModule = m.viewmodel; damageEffects = snapshot.effects; damageBroken = snapshot.broken;
    }
    if (m.hunt) { if (appliedHunt !== m.hunt) { m.hunt.setNetwork(true); appliedHunt = m.hunt; } m.hunt.applyNetworkSnapshot(snapshot.hunt, me?.score ?? 0); }
    // The delta decoder retains unchanged fields by reference. The host samples
    // ambient life at 10 Hz, so do not reapply it on every 20 Hz player frame:
    // landing state also rebuilds movement obstacles and updates skeletal poses.
    if (client.role !== 'host' && snapshot.ambient && m.life &&
      (snapshot.ambient !== appliedAmbient || m.life !== ambientModule)) {
      m.life.applyNetworkSnapshot?.(snapshot.ambient);
      appliedAmbient = snapshot.ambient; ambientModule = m.life;
    }
    if (me) {
      if (m.seats?.active || me.seat) started = false;
      else if (!started && !applying) {
        if (!m.walk.active) m.walk.enter({ x: me.x, z: me.z }, me.yaw, { network: true });
        m.walk.reconcileNetwork(me, me.ack, { snap: true }); started = true; wasWalking = true;
      } else if (started && (sessionRole !== 'host' || m.walk.active)) {
        m.walk.reconcileNetwork(me, me.ack, { snap: sessionRole === 'host' && !wasWalking }); wasWalking = true;
      } else if (sessionRole === 'host' && !m.walk.active) wasWalking = false;
      m.viewmodel.applyNetworkAmmo(me.ammo);
    }
    samples.push({ at: performance.now(), snapshot }); if (samples.length > 6) samples.shift();
    const present = new Map(snapshot.players.map(p => [p.id, p.avatar]));
    // A returning identity may receive another free appearance if its old slot
    // was reused. Rebuild even when an intermediate departure frame was skipped.
    for (const [id, avatar] of avatars) if (!present.has(id) || present.get(id) !== avatar.slot) { scene.remove(avatar.root); avatar.dispose(); avatars.delete(id); }
    for (const p of snapshot.players) if (p.id !== client.id && !avatars.has(p.id)) {
      const avatar = createAvatar({ slot: p.avatar, name: p.name, host: p.id === snapshot.hostId });
      avatar.root.userData.networkAvatar = true; avatar.root.userData.rasterOnly = true;
      avatar.root.position.set(p.x, p.y, p.z); scene.add(avatar.root); avatars.set(p.id, avatar);
    }
    requestRender();
  }

  function receiveEvent(event) {
    if (!event || seenEvents.has(event.id)) return;
    seenEvents.add(event.id); if (seenEvents.size > 512) seenEvents.delete(seenEvents.values().next().value);
    const m = getModules();
    if (event.kind === 'shot') {
      m.viewmodel.applyNetworkShot(event);
      const muzzle = event.actorId !== client.id ? avatars.get(event.actorId)?.getMuzzleWorldPosition?.() : null;
      shots.shot(event, { origin: muzzle?.toArray?.() });
      for (const hit of event.hits || []) m.hunt?.applyNetworkHit(hit, { local: event.actorId === client.id });
    } else if (event.kind === 'external-hit') {
      for (const hit of event.hits || []) m.hunt?.applyNetworkHit(hit, { local: event.actorId === client.id });
    } else if (event.kind === 'party') getParty()?.applyNetworkSnapshot?.(event.state, { players: lastSnapshot?.players || [], time: event.time, selfId: client.id });
    else if (event.kind === 'clear') { m.viewmodel.clearHoles({ remote: true }); shots.clear(); damageModule = null; }
    else if (event.kind === 'door' && event.targetId) m.doors.applyNetwork({ ...lastSnapshot?.doors, [event.targetId]: event.open }, { instant: false });
    else if (event.kind === 'item' && event.targetId) { (event.targetId === 'phone' ? m.tv : m.paper).applyNetwork(event.owner); }
    else if (event.kind === 'interaction' && event.targetId) {
      if (event.targetId === 'hood') m.hood?.applyNetwork?.(event.value);
      else if (event.targetId === 'newspaper') m.paper.applyInteractionState?.(event.value);
      else m.tv.applyInteractionState?.({ [event.targetId]: event.value });
    }
    requestRender();
  }

  async function apartmentChanged() {
    if (!active || applying || client.role !== 'host') return;
    const serial = ++changeSerial;
    clearTimeout(geometryTimer);
    geometryTimer = setTimeout(async () => {
      try { const data = await roomState(); if (serial === changeSerial && active) client.send({ kind: 'apartment', ...data }); }
      catch (error) { ui?.toast?.(error.message); }
    }, 200);
  }

  function update(dt) {
    if (!active) return false;
    const m = getModules();
    if (sessionRole === 'host' && !m.walk.active) wasWalking = false;
    syncWeapon(m.viewmodel.weapon);
    if (m.hunt && appliedHunt !== m.hunt) { m.hunt.setNetwork(true); appliedHunt = m.hunt; if (lastSnapshot?.hunt) m.hunt.applyNetworkSnapshot(lastSnapshot.hunt, client.self?.score ?? 0); }
    sendClock += dt; ambientClock += dt;
    if (sendClock >= 1 / R.inputHz) {
      sendClock %= 1 / R.inputHz;
      if (inputs.length && client.connected) client.send({ kind: 'inputs', inputs: inputs.splice(0) });
      const look = client.self?.seat && m.seats?.getNetworkPose?.();
      if (look && client.connected && !applying && !document.body.classList.contains('kmp-modal-open'))
        client.send({ kind: 'look', yaw: look.yaw, pitch: look.pitch, aiming: m.viewmodel.aiming });
    }
    if (ambientClock > 0.1 && client.role === 'host') { ambientClock = 0; const ambient = m.life?.snapshot?.(); if (ambient) client.send({ kind: 'ambient', ambient }); }
    const t = performance.now() - R.interpolationMs;
    let b = samples.find(s => s.at >= t) || samples.at(-1), a = samples[Math.max(0, samples.indexOf(b) - 1)];
    const k = b && a && b.at > a.at ? THREE.MathUtils.clamp((t - a.at) / (b.at - a.at), 0, 1) : 1;
    if (b) for (const p of b.snapshot.players) {
      const avatar = avatars.get(p.id); if (!avatar) continue;
      const before = a?.snapshot.players.find(q => q.id === p.id) || p;
      const x = THREE.MathUtils.lerp(before.x, p.x, k), y = THREE.MathUtils.lerp(before.y, p.y, k), z = THREE.MathUtils.lerp(before.z, p.z, k);
      const speed = Math.min(3, Math.hypot(x - avatar.root.position.x, z - avatar.root.position.z) / Math.max(dt, 0.001));
      avatar.root.position.set(x, y, z); avatar.root.rotation.y = angle(before.yaw, p.yaw, k);
      // Interpolate simulation time with the same samples as the body. A stopped
      // connection can advance a pose by at most one interpolation window.
      const sampleTime = Number.isFinite(b.snapshot.time) ? b.snapshot.time : 0;
      const beforeTime = Number.isFinite(a?.snapshot.time) ? a.snapshot.time : sampleTime;
      const roomTime = THREE.MathUtils.lerp(beforeTime, sampleTime, k) + Math.min(R.interpolationMs / 1000, Math.max(0, (t - b.at) / 1000));
      const presentation = selectAvatarPresentation(before, p, roomTime, beforeTime, sampleTime), shown = presentation.player;
      const verticalSpeed = THREE.MathUtils.lerp(before.verticalSpeed ?? before.vy ?? 0, p.verticalSpeed ?? p.vy ?? 0, k);
      const visual = sampleAvatarAction({ ...shown, y, verticalSpeed, grounded: y <= 0.001 && verticalSpeed <= 0,
        aiming: THREE.MathUtils.lerp(before.aiming || 0, p.aiming || 0, k) }, roomTime, presentation.snapshotTime);
      const lookYaw = angle(before.lookYaw ?? before.yaw, p.lookYaw ?? p.yaw, k);
      const aimYaw = Math.atan2(Math.sin(lookYaw - avatar.root.rotation.y), Math.cos(lookYaw - avatar.root.rotation.y));
      avatar.update({ dt, ...visual, speed, weapon: shown.weapon, aimPitch: angle(before.pitch, p.pitch, k),
        aimYaw, held: shown.held, carried: shown.carried, seated: !!shown.seat, seatY: shown.seatY, reclined: shown.reclined, washing: b.snapshot.social?.shower.owner === shown.id });
    }
    // Cheap generation checks only. A scene-wide mesh/bounds scan is done once after a real change.
    if (client.role === 'host' && started && !manifestPending && (m.decor !== manifestDecor || m.furniture !== manifestFurniture || m.decor?.pass !== manifestPass)) {
      manifestDecor = m.decor; manifestFurniture = m.furniture; manifestPass = m.decor?.pass;
      manifestPending = true; const version = lifecycle;
      roomState().then(data => { if (active && lifecycle === version && client.role === 'host') client.send({ kind: 'geometry', ...data }); })
        .catch(() => {}).finally(() => { if (lifecycle === version) manifestPending = false; });
    }
    handoff.update(dt); shots.update(dt); requestRender(); return true;
  }

  function deactivate() {
    if (!active) return;
    active = false; lifecycle++; clearTimeout(geometryTimer); changeSerial++; pendingApartments = 0; applying = false; manifestPending = false;
    const m = getModules();
    m.walk.setNetwork(null); m.doors.setNetwork(null); m.tv.setNetwork(null); m.paper.setNetwork(null);
    m.hood?.setNetwork?.(null); getParty()?.setNetwork?.(null);
    m.social?.setNetwork?.(null); m.rc?.setNetwork?.(null);
    m.seats?.setNetwork?.(null); m.viewmodel.setNetwork(null); m.hunt?.setNetwork(false); m.life?.setNetwork?.(null);
    for (const avatar of avatars.values()) { scene.remove(avatar.root); avatar.dispose(); } avatars.clear(); shots.clear();
    samples.length = 0; inputs.length = 0; seenEvents.clear(); appliedHunt = null; appliedAmbient = ambientModule = null; epoch = revision = -1; started = false;
    damageModule = damageEffects = damageBroken = null;
    handoff.update(); delete document.body.dataset.multiplayerRole;
    const restore = previousState; previousState = null; sessionRole = null; lastSnapshot = null;
    if (restore) apartmentQueue = apartmentQueue.catch(() => {}).then(() => applyState(restore)).catch(() => {});
    requestRender();
  }

  const handoff = createHandoffUI({ getSelf: () => active && client.connected ? client.self : null, getPlayers: () => lastSnapshot?.players || [], request });
  const invite = new URL(location.href).searchParams.get('room');
  if (invite) whenReady.then(() => { if (!disposed) lobby.open({ room: invite }); }).catch(() => {});
  return { client, lobby, update, apartmentChanged, roomState,
    get active() { return active; }, get canEdit() { return !active || (client.role === 'host' && client.connected); },
    get applying() { return applying; },
    dispose() { disposed = true; clearTimeout(roomRequestTimer); deactivate(); client.dispose(); lobby.dispose(); shots.dispose(); handoff.dispose(); style.remove(); window.removeEventListener('kitchen:room-request', openRoom); } };
}
