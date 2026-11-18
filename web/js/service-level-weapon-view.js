import { weaponById } from './weapon-catalog.js';
import { createWeaponAim } from './weapon-aim.js';
import { clipPose, disposeWeaponModel, loadWeaponModel } from './weapon-models.js';
import { createShotSound, makeFlashTexture } from './weapon-fx.js';

const FLASH_SECONDS = 0.054;
const BASE_FOV = 50;
const RETRY_MS = 2000;

export function createServiceLevelWeaponView(T, getSound) {
  const scene = new T.Scene(), eye = new T.PerspectiveCamera(BASE_FOV, 1, 0.01, 5), rig = new T.Group();
  const key = new T.DirectionalLight('#fff5da', 2.2);
  key.position.set(-0.6, 1, 0.5);
  const rim = new T.DirectionalLight('#e6d7ae', 0.8);
  rim.position.set(1, 0.3, -1);
  scene.add(rig, new T.HemisphereLight('#fff5db', '#5b4b3c', 1.6), key, rim);
  const aim = createWeaponAim(T), models = new Map();
  const flashTexture = makeFlashTexture(T);
  const flashMaterial = new T.SpriteMaterial({
    map: flashTexture, color: new T.Color(2.8, 1.9, 1), blending: T.AdditiveBlending,
    depthWrite: false, depthTest: false, transparent: true,
  });
  const flash = new T.Sprite(flashMaterial);
  flash.position.x = 0.02; flash.renderOrder = 10;
  const light = new T.PointLight('#ffb36b', 0, 0.8, 2);
  light.position.x = flash.position.x;
  rig.visible = false;
  const audio = createShotSound();
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let mounted, disposed = false, blend = 0, raise = 0, phase = 0, swing = 0, recoil = Infinity;
  let seed, tick = -1, seenEvent = -1;
  let mechanicIndex = 0, activeMechanic = '';

  function preload(id) {
    const weapon = weaponById(id);
    const previous = models.get(id);
    if (!weapon.file || disposed || (previous && (!previous.retryAt || performance.now() < previous.retryAt))) return;
    const entry = {};
    models.set(id, entry);
    loadWeaponModel(T, weapon, aim).then(model => {
      if (disposed) disposeWeaponModel(model);
      else entry.model = model;
    }).catch(error => {
      if (!disposed) {
        entry.retryAt = performance.now() + RETRY_MS;
        console.warn('Служебный этаж: модель оружия', weapon.file, error);
      }
    });
  }

  function update(snapshot, me, { dt, moving, aiming, aspect, available, playerId }) {
    if (snapshot.seed !== seed || snapshot.tick < tick) {
      seed = snapshot.seed; seenEvent = -1; recoil = Infinity; raise = 0; activeMechanic = '';
    }
    tick = snapshot.tick;
    recoil += dt;
    const weapon = weaponById(me.weapon);
    for (const event of snapshot.events) {
      if (event.id <= seenEvent) continue;
      seenEvent = event.id;
      if (event.type !== 'shot') continue;
      const local = event.playerId === playerId;
      if (local && event.weapon === me.weapon) recoil = 0;
      if (!getSound()) continue;
      const sound = weaponById(event.weapon).sound;
      const attenuation = local ? 1 : 0.60 * Math.max(0, 1 - Math.hypot(event.x - me.x, event.z - me.z) / 24);
      if (sound && attenuation > 0) audio.play({ ...sound, gain: sound.gain * attenuation });
    }

    preload(weapon.id);
    const model = models.get(weapon.id)?.model;
    if (model !== mounted) {
      rig.clear(); mounted = model; raise = 0; blend = 0;
      activeMechanic = '';
      if (model) { rig.add(model.root); model.flash.add(flash, light); }
    }
    rig.visible = !!(model && available && !me.downed);

    const aimed = !!(rig.visible && aiming && !me.reloadLeft && !(weapon.cycle && me.shotAge < weapon.cycle));
    const response = weapon.ads?.time ?? 0.2;
    blend = T.MathUtils.lerp(blend, Number(aimed), 1 - Math.exp(-4 * dt / response));
    const zoom = 1 + ((weapon.ads?.zoom ?? 1) - 1) * blend;
    if (!rig.visible) return zoom;

    const cycle = weapon.cycle && me.shotAge < weapon.cycle;
    const action = me.reloadLeft ? 'reload' : cycle || recoil < weapon.shot ? 'shoot' : 'idle';
    const progress = me.reloadLeft ? 1 - me.reloadLeft / me.reloadDuration
      : cycle ? me.shotAge / weapon.cycle : action === 'shoot' ? recoil / weapon.shot : 0;
    clipPose(model, action, progress);
    const mechanic = me.reloadLeft ? 'reload' : cycle ? 'cycle' : '';
    if (activeMechanic !== mechanic) {
      activeMechanic = mechanic;
      mechanicIndex = 0;
    }
    const markers = mechanic === 'reload' ? weapon.reloadEv : mechanic === 'cycle' ? weapon.cycleEv : null;
    while (markers && mechanicIndex < markers.length && markers[mechanicIndex][0] <= progress) {
      if (getSound()) audio.mech(markers[mechanicIndex][1]);
      mechanicIndex++;
    }

    const fov = aspect >= 1 ? BASE_FOV : Math.min(105, 360 / Math.PI * Math.atan(Math.tan(BASE_FOV * Math.PI / 360) / aspect));
    const lens = fov / Math.sqrt(1 + (zoom - 1) * 0.5);
    if (eye.aspect !== aspect || Math.abs(eye.fov - lens) > .01) {
      eye.aspect = aspect; eye.fov = lens;
      eye.updateProjectionMatrix();
    }
    swing += (Number(moving && !reduced) - swing) * (1 - Math.exp(-10 * dt));
    phase += dt * 8;
    raise = Math.min(1, raise + dt * 5);
    const sway = swing * (1 - 0.85 * blend);
    const kick = reduced ? 0 : Math.max(0, 1 - recoil / 0.15) ** 2;
    rig.position.fromArray(weapon.pos);
    rig.position.x += 0.008 * sway * Math.sin(phase);
    rig.position.y += 0.006 * sway * Math.cos(phase * 2) - (1 - raise) ** 2 * 0.16;
    rig.position.z += weapon.kick.back * kick;
    rig.rotation.set(kick * 0.035, 0, (weapon.cant ?? 0) * (1 - blend) - 0.012 * sway * Math.sin(phase));
    rig.position.lerp(model.ads, blend);
    if (!mechanic) aim.align(rig, model.muzzle, eye, weapon.range);
    flash.visible = recoil < FLASH_SECONDS;
    flash.scale.setScalar(weapon.flash);
    light.intensity = flash.visible ? 2.6 * (1 - recoil / FLASH_SECONDS) : 0;
    return zoom;
  }

  function draw(renderer) {
    if (!rig.visible) return;
    const autoClear = renderer.autoClear, tone = renderer.toneMapping, exposure = renderer.toneMappingExposure;
    const target = renderer.getRenderTarget(), autoReset = renderer.info.autoReset;
    try {
      renderer.setRenderTarget(null);
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      renderer.toneMapping = T.NeutralToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.state.buffers.depth.setMask(true);
      renderer.clearDepth();
      renderer.render(scene, eye);
    } finally {
      renderer.setRenderTarget(target);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
      renderer.toneMapping = tone;
      renderer.toneMappingExposure = exposure;
    }
  }

  function dispose() {
    disposed = true;
    flash.removeFromParent();
    for (const { model } of models.values()) if (model) disposeWeaponModel(model);
    models.clear();
    flashTexture.dispose(); flashMaterial.dispose(); audio.dispose();
  }

  return { preload, update, draw, dispose, resumeAudio: () => { if (getSound()) audio.unlock(); } };
}
