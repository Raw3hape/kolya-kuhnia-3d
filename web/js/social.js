// Apartment activity adapter: inputs and Three.js presentation, never multiplayer authority.
import { createSocialSimulation, socialLocations } from './social-state.js';
import { createSocialModels } from './social-models.js';
import { createSocialAudio } from './social-audio.js';
import { acquireSceneIndex } from './scene-index.js';
import { buildColliders, roomOf } from './multiplayer/collision.js';
import { addHelp } from './help.js';
import { injectStyle } from './minimap.js';
import { afterRoom } from './loading.js';
import { stableObjectId } from './network-objects.js';

addHelp(
  { mode: 'walk', topic: 'social', keys: ['E'], text: 'пицца: открыть / закрыть; душ: включить / выключить; радио: питание', order: 66 },
  { mode: 'walk', topic: 'social', keys: ['G'], text: 'взять коробку пиццы', order: 66 },
  { mode: 'walk', topic: 'social', keys: ['Q'], text: 'с коробкой: наведите на поверхность и поставьте; X — вернуть', order: 67 },
  { mode: 'walk', topic: 'social', keys: ['ЛКМ'], text: 'съесть кусок из открытой коробки — пицца общая для всех', order: 68 },
  { mode: 'seat', topic: 'social', keys: ['ЛКМ'], text: 'можно есть пиццу, сидя рядом с открытой коробкой', order: 46 },
);
const typing = event => event.target?.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName);
export function createSocial({ THREE: T, scene, camera, canvas, pipe, plan, bathSpec, spec, getFurniture, getWalk, getSeats, getVM, getDoors, getParty, getTV, getPaper, getLife, requestRender }) {
  let sim, state, models, audio, locations, disposed = false, network = null, savedSolo = null, capturing = false;
  const offLive = pipe.onLive?.(live => { capturing = !live; if (models) models.root.visible = live && !pipe.photo; });
  let target = null, pending = false, generation = 0, aimClock = 0, lastBell = null, lastUI = '', noticeUntil = 0, notice = '', players = [], lastCommand = null;
  const index = acquireSceneIndex(scene), walls = buildColliders(plan).boxes;
  const ray = new T.Raycaster(); ray.layers.enableAll(); const direction = new T.Vector3();
  let worldMeshes = [], meshesRevision = -1, placement = null, placementSupport = null;
  const supportObjects = new Map();
  const showerPoint = [bathSpec.shower.mixer.x, bathSpec.shower.mixer.y, bathSpec.shower.z1 - bathSpec.shower.rain.reach];
  let showerTop = bathSpec.shower.rain.top;
  let radioPose = null, radioKey = [];
  function refreshRadio() {
    const console = getFurniture()?.items?.[spec.radio.mount.anchor], key = [console, console?.position.x, console?.position.z, console?.rotation.y, console?.userData.top];
    if (key.length === radioKey.length && key.every((value, i) => value === radioKey[i])) return;
    radioKey = key;
    if (console?.visible) { console.updateWorldMatrix(true, false); const offset = spec.radio.mount.offset; radioPose = { position: console.localToWorld(new T.Vector3(offset[0], (console.userData.top || 0) + offset[1], offset[2])).toArray(), yaw: console.rotation.y }; }
    else radioPose = null;
    if (!network) sim?.setRadioPose(radioPose);
  }
  const selfId = () => network?.selfId?.() || 'solo';
  const held = () => state?.pizza?.owner === selfId();
  const active = () => (getWalk()?.walking || getSeats()?.active) && !pipe.photo && !capturing && !document.body.classList.contains('kmp-modal-open');
  function pose() { return { id: 'solo', ...getWalk()?.getNetworkPose?.(), x: camera.position.x, z: camera.position.z, eyeY: camera.position.y, yaw: camera.rotation.y, lookYaw: Math.atan2(-direction.x, -direction.z) }; }
  function clearLine(from, to) {
    const distance = Math.hypot(to[0] - from.x, to[2] - from.z);
    if (distance < 0.01) return true;
    for (const box of walls) {
      let lo = 0, hi = 1;
      for (const [start, delta, min, max] of [[from.x, to[0] - from.x, box.x0, box.x1], [from.z, to[2] - from.z, box.z0, box.z1]]) {
        if (Math.abs(delta) < 1e-8) { if (start < min || start > max) { lo = 2; break; } }
        else { const a = (min - start) / delta, b = (max - start) / delta; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
      }
      if (lo <= hi && lo < 0.999) return false;
    }
    // Closed door leaves are physical segments. Test their swept narrow bounds.
    for (const door of getDoors()?.colliders?.() || []) {
      if (door.ax === undefined) continue;
      const rx = (to[0] - from.x) / distance, rz = (to[2] - from.z) / distance, sx = door.bx - door.ax, sz = door.bz - door.az, size = sx * sx + sz * sz;
      for (let along = 0.025; along < distance; along += 0.025) {
        const x = from.x + rx * along, z = from.z + rz * along, u = Math.max(0, Math.min(1, ((x - door.ax) * sx + (z - door.az) * sz) / size));
        if (Math.hypot(x - door.ax - sx * u, z - door.az - sz * u) < door.h + 0.015) return false;
      }
    }
    return true;
  }
  const hud = document.createElement('div'); hud.className = 'social-hud kw-float'; hud.setAttribute('role', 'status'); hud.hidden = true;
  const caption = document.createElement('b'), hint = document.createElement('span'), buttons = document.createElement('div'); buttons.className = 'social-actions'; hud.append(caption, hint, buttons);
  const actionButtons = new Map();
  for (const [verb, text] of [['take', 'Взять'], ['open', 'Открыть'], ['eat', 'Кусочек'], ['place', 'Поставить'], ['return', 'Вернуть'], ['shower', 'Душ']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.dataset.action = verb;
    button.addEventListener('click', () => command(verb)); buttons.append(button); actionButtons.set(verb, button);
  }
  const radioPanel = document.createElement('div'); radioPanel.className = 'social-radio'; radioPanel.hidden = true;
  const radioName = document.createElement('b'), radioGenre = document.createElement('span'), radioControls = document.createElement('div');
  const power = document.createElement('button'), previous = document.createElement('button'), next = document.createElement('button'), volume = document.createElement('input');
  power.type = previous.type = next.type = 'button'; previous.textContent = '‹'; next.textContent = '›'; previous.setAttribute('aria-label', 'Предыдущая радиостанция'); next.setAttribute('aria-label', 'Следующая радиостанция');
  volume.type = 'range'; volume.min = 0; volume.max = 100; volume.step = 5; volume.setAttribute('aria-label', 'Громкость радио');
  const changeStation = delta => command('radio', { station: (state.radio.station + delta + spec.radio.stations.length) % spec.radio.stations.length, playing: true });
  power.addEventListener('click', () => command('radio', { playing: !state.radio.playing })); previous.addEventListener('click', () => changeStation(-1)); next.addEventListener('click', () => changeStation(1));
  volume.addEventListener('change', () => command('radio', { volume: Number(volume.value) / 100 }));
  radioControls.append(previous, power, next); radioPanel.append(radioName, radioGenre, radioControls, volume); document.body.append(hud, radioPanel);
  injectStyle('social-style', CSS);
  function show(message) { notice = message; noticeUntil = performance.now() + 2200; lastUI = ''; }
  function accept(value, initial = false) {
    if (!value) return; state = value;
    if (!initial && lastBell !== null && value.bell > lastBell) { audio?.bell(); show('Дзынь! Курьер Żabka ждёт с пиццей'); } lastBell = value.bell;
    audio?.sync(value); requestRender();
  }
  async function command(verb, extra = {}) {
    if (!state || pending || !active()) return { ok: false };
    camera.getWorldDirection(direction);
    if (verb === 'place' && !placement) { show('Наведите на свободную поверхность'); return { ok: false }; }
    const payload = { kind: 'social', verb, ...extra, ...(verb === 'place' ? { point: placement } : {}), ...(verb === 'shower' ? { point: showerPoint } : {}) };
    pending = true; const version = generation;
    try {
      const result = network ? await network.request(payload) : { ok: sim.command(pose(), payload) };
      lastCommand = { verb, ok: !!result?.ok, error: result?.error || null };
      if (version !== generation) return { ok: false };
      if (!network) accept(sim.snapshot());
      if (result?.ok && verb === 'take') {
        getVM()?.setWeapon('none');
        if (!network) { if (getParty()?.held) await getParty().command('return'); getTV()?.hold(false); getPaper()?.drop(); }
      }
      if (!result?.ok) show('Уже занято или слишком далеко');
      return result;
    } catch { show('Связь прервалась · попробуйте ещё раз'); return { ok: false }; }
    finally { if (version === generation) pending = false; }
  }
  function meshes() {
    if (meshesRevision !== index.revision) {
      meshesRevision = index.revision;
      worldMeshes = [...index.materialObjects].filter(object => {
        if (!object.isMesh || object.userData.glass || object.userData.shadowOnly) return false;
        for (let p = object; p; p = p.parent) if (p === models?.root || p.userData.networkAvatar || p.userData.viewmodel || p.userData.networkEffect || p.userData.networkEntity) return false;
        return true;
      });
      supportObjects.clear(); for (const object of worldMeshes) supportObjects.set(stableObjectId(object), object);
    }
    return worldMeshes;
  }
  function aim() {
    target = null; placement = null; placementSupport = null;
    if (!active() || !state || getVM()?.armed || getParty()?.held || getTV()?.status?.held || getPaper()?.held) return;
    ray.setFromCamera({ x: 0, y: 0 }, camera); ray.far = spec.rules.reach;
    if (held()) {
      const hit = ray.intersectObjects(meshes().filter(object => index.visible(object)), false)[0];
      if (hit?.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.7 && clearLine(camera.position, hit.point.toArray()) && roomOf(plan, hit.point.x, hit.point.z)) {
        const box = new T.Box3().setFromObject(hit.object), margin = spec.pizza.size / 2 - 0.015;
        if (hit.point.x - margin >= box.min.x && hit.point.x + margin <= box.max.x && hit.point.z - margin >= box.min.z && hit.point.z + margin <= box.max.z) { placement = [hit.point.x, hit.point.y + 0.008, hit.point.z]; placementSupport = hit.object; }
      }
      return;
    }
    if (getDoors()?.target) return;
    const candidates = [models.radio]; if (state.pizza && !state.pizza.owner) candidates.push(models.pizza);
    const mixer = scene.getObjectByName('bath_shower_set'); if (mixer) candidates.push(mixer);
    const hits = ray.intersectObjects(candidates, true).filter(hit => index.visible(hit.object));
    const hit = hits.find(hit => clearLine(camera.position, hit.point.toArray()));
    if (!hit) return;
    let root = hit.object; while (root && !candidates.includes(root)) root = root.parent;
    target = root === models.radio ? 'radio' : root === models.pizza ? 'pizza' : 'shower';
  }
  function renderUI() {
    if (!state) return;
    const carrying = held(), live = active(), washing = state.shower.owner === selfId(), focused = live && (carrying || target || washing), coarse = matchMedia('(pointer:coarse)').matches;
    const pizza = state.pizza, note = performance.now() < noticeUntil ? notice : '';
    const key = [live, carrying, target, pizza?.open, pizza?.remaining, state.shower.owner, pending, state.radio.station, state.radio.playing, state.radio.volume, !!placement, note, audio.status].join('|');
    if (key === lastUI) return; lastUI = key;
    hud.hidden = !focused && !note;
    caption.textContent = note || (carrying ? 'Żabka · коробка в руках' : target === 'pizza' ? `Żabka Pizza · ${pizza.remaining} / ${spec.rules.slices} кусочков` : target === 'radio' ? 'Радио · музыка для всех' : washing ? 'Моемся · тёплая вода' : state.shower.owner ? 'Душ занят' : 'Тёплый душ');
    hint.textContent = note && !focused ? '' : carrying ? (placement ? 'Q — поставить здесь · X — вернуть' : 'Наведите на пол, стол или другую поверхность · X — вернуть') : target === 'pizza' ? (pizza.open ? 'ЛКМ — кусочек · E — закрыть · G — взять' : 'E — открыть · G — взять') : target === 'shower' || washing ? 'E — включить / закончить' : 'E — питание · выберите станцию и громкость';
    if (coarse && focused) hint.textContent = carrying ? 'Наведите на поверхность и нажмите «Поставить»' : target === 'pizza' ? (pizza.open ? 'Угощайтесь! Пицца общая для всех' : 'Откройте коробку или возьмите её с собой') : target === 'radio' ? 'Выберите станцию и громкость' : 'Нажмите «Душ», чтобы включить или закончить';
    for (const [verb, button] of actionButtons) {
      button.hidden = !coarse || !live || !(carrying ? ['place', 'return'].includes(verb) : target === 'pizza' ? ['take', 'open', ...(pizza.open && pizza.remaining ? ['eat'] : [])].includes(verb) : (target === 'shower' || washing) && verb === 'shower');
      button.disabled = pending; if (verb === 'open') button.textContent = pizza?.open ? 'Закрыть' : 'Открыть';
    }
    radioPanel.hidden = !live || target !== 'radio';
    const station = spec.radio.stations[state.radio.station]; radioName.textContent = station.name; radioGenre.textContent = audio.status || station.genre;
    power.textContent = state.radio.playing ? 'Выключить' : 'Включить'; volume.value = Math.round(state.radio.volume * 100);
  }
  const onKey = event => {
    if (event.repeat || typing(event) || event.metaKey || event.ctrlKey || event.altKey || !active() || !state) return;
    let verb = null;
    if (held()) { if (event.code === 'KeyQ') verb = 'place'; if (event.code === 'KeyX') verb = 'return'; }
    else if (target === 'pizza' && ['KeyE', 'KeyG'].includes(event.code)) verb = event.code === 'KeyG' ? 'take' : 'open';
    else if (target === 'shower' && event.code === 'KeyE') verb = 'shower';
    else if (!target && state.shower.owner === selfId() && event.code === 'KeyE' && !getDoors()?.target && !getSeats()?.target) verb = 'shower';
    else if (target === 'radio' && event.code === 'KeyE') { event.preventDefault(); event.stopImmediatePropagation(); command('radio', { playing: !state.radio.playing }); return; }
    if (verb) { event.preventDefault(); event.stopImmediatePropagation(); command(verb); }
  };
  const onClick = event => {
    if (event.button || !active() || target !== 'pizza' || !state.pizza?.open || getVM()?.armed) return;
    event.preventDefault(); event.stopImmediatePropagation(); command('eat');
  };
  addEventListener('keydown', onKey, { capture: true }); canvas.addEventListener('click', onClick, { capture: true });
  const ready = afterRoom(async () => {
    if (disposed) return;
    const head = scene.getObjectByName('shower_head');
    if (head) { const box = new T.Box3().setFromObject(head), center = box.getCenter(new T.Vector3()); showerPoint[0] = center.x; showerPoint[2] = center.z; showerTop = box.min.y; }
    locations = socialLocations(plan, spec);
    sim = createSocialSimulation({ spec, plan, blocked: (p, pos) => !clearLine(p, pos), validatePlacement(pos, kind) {
      if (kind === 'shower') return Math.hypot(...pos.map((n, i) => n - showerPoint[i])) < 0.02;
      if (!roomOf(plan, pos[0], pos[2])) return false;
      if (pos[1] < 0.03) return true;
      if (!placementSupport) return false;
      const bounds = new T.Box3().setFromObject(placementSupport);
      return { id: stableObjectId(placementSupport), bounds: [...bounds.min.toArray(), ...bounds.max.toArray()] };
    } });
    models = createSocialModels({ THREE: T, scene, spec, locations });
    audio = createSocialAudio({ camera, spec, locations, isAudible: () => active() && !getLife()?.muted && !document.hidden });
    accept(sim.snapshot(), true);
  });
  return { ready, command,
    get spec() { return spec; }, get target() { return target ? { id: `social:${target}`, label: target } : null; }, get held() { return held(); },
    metadata() { refreshRadio(); return { showerPoint, radioPose }; },
    update(dt) {
      if (!state || disposed) return false;
      camera.getWorldDirection(direction);
      refreshRadio();
      if (!network && active()) {
        sim.step(dt, [pose()]);
        sim.reconcileSupport(id => { meshes(); const object = supportObjects.get(id); if (!object || !index.visible(object)) return null; const box = new T.Box3().setFromObject(object); return [...box.min.toArray(), ...box.max.toArray()]; });
        state = sim.snapshot(); if (held() && (getVM()?.armed || getParty()?.held || getTV()?.status?.held || getPaper()?.held)) { sim.command(pose(), { verb: 'return' }); state = sim.snapshot(); }
      }
      if (lastBell !== null && state.bell > lastBell) { audio.bell(); show('Дзынь! Курьер Żabka ждёт с пиццей'); } lastBell = state.bell;
      audio.sync(state); audio.update(state, showerPoint);
      getLife()?.setShowerControlled(!!state.shower.owner);
      aimClock += dt; if (aimClock >= 0.12) { aimClock = 0; aim(); } renderUI();
      return models.update(state, dt, showerPoint, !pipe.photo && !capturing, { camera, selfId: selfId(), players, placement, showerTop });
    },
    setNetwork(adapter) {
      generation++; pending = false; target = null; lastBell = null; players = [];
      if (adapter && !network) savedSolo = sim?.snapshot(); network = adapter || null;
      if (!adapter && sim && savedSolo) { sim.restore(savedSolo); savedSolo = null; accept(sim.snapshot(), true); }
    },
    applyNetwork(value, roomPlayers = []) { players = roomPlayers; accept(value, lastBell === null); },
    get debug() { return { state, ready: !!state, target, pending, lastCommand, placement, audio: audio?.debug, showerPoint, locations, sliceCount: models?.pizza.children.filter(o => o.isMesh && o.material?.vertexColors && o.visible).length }; },
    dispose() { disposed = true; generation++; offLive?.(); removeEventListener('keydown', onKey, { capture: true }); canvas.removeEventListener('click', onClick, { capture: true }); hud.remove(); radioPanel.remove(); audio?.dispose(); models?.dispose(); index.release(); } };
}
const CSS = `
.social-hud{position:fixed;left:50%;bottom:150px;transform:translateX(-50%);max-width:min(520px,90vw);padding:12px 18px;border:1px solid #d6e5d522;border-radius:16px;background:#183c2cf0;color:#f5f1df;z-index:27;box-shadow:0 8px 28px #0003;text-align:center;font:13px/1.5 var(--f-body,Arial);backdrop-filter:blur(12px)}
.social-hud b,.social-hud span{display:block}.social-hud span{opacity:.8;font-size:12px}.social-actions{display:flex;justify-content:center;gap:6px;margin-top:6px}.social-actions:empty{display:none}
.social-actions button,.social-radio button{border:1px solid #ffffff30;background:#ffffff15;color:inherit;padding:9px 13px;border-radius:9px;min-height:40px;cursor:pointer;font:inherit}.social-radio button:hover,.social-actions button:hover{background:#ffffff30}
.social-radio{position:fixed;left:24px;bottom:200px;z-index:28;background:#172b25f5;color:#f5f1df;border:1px solid #a2c9ac44;border-radius:18px;padding:18px;width:240px;box-shadow:0 10px 32px #0004;font:13px/1.4 var(--f-body,Arial)}.social-radio b{display:block;letter-spacing:.08em;color:#9ce5b5}.social-radio span{display:block;opacity:.75;margin:5px 0 12px}.social-radio div{display:flex;gap:8px;justify-content:space-between}.social-radio input{width:100%;margin-top:16px;accent-color:#8ee5b0}.social-radio[hidden],.social-hud[hidden],.social-actions button[hidden]{display:none!important}
@media(pointer:coarse){.social-hud{bottom:230px;padding:10px 12px}.social-hud span{font-size:11px}.social-radio{left:12px;bottom:330px;width:220px}}`;
