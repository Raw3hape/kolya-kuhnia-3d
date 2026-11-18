// Lazy apartment adapter. The current canvas and WebGL context serve both scenes.
import { serviceEntrance, newServiceSeed } from './service-level-entrance.js';
import { NETWORK_RULES } from './multiplayer/rules.js';

const LOAD_DISTANCE = 5;
const PREVIEW_DISTANCE = 3.6;
const PREVIEW_WIDTH = 640;
const AIM_LIMIT = Math.PI * 0.42;
const JOYSTICK_RADIUS = 50;
const SEND_INTERVAL = 1 / NETWORK_RULES.inputHz;
const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function createServiceLevelEntrance({
  THREE: T, scene, camera, canvas, renderer, walk, doors, plan, canEnter, courier, net,
  config, onMode, requestRender, notify,
}) {
  const entrance = serviceEntrance(plan);
  const soloId = 'solo';
  let soloSeed = newServiceSeed(), nextSeed, roomState = null, selfId = soloId;
  let entryRequest = false, rejected = false, active = false, kit, loading, retryAt = 0;
  let world, worldSeed, environment, actors, hud, state, solo, predicted, target, dirtyResize = true;
  let controls, yaw = 0, pitch = 0, seq = 0, sendClock = 0, sentAt = 0;
  let renderedPreview = false, fire = false, tap = 0, reload = false, interact = false, paused = false, leaving = false;
  let portal, previewTarget, previewSignature = '', lastPhase = null;
  let touch = matchMedia('(pointer: coarse)').matches;
  const touches = new Map(), keys = new Set();
  let joyX = 0, joyZ = 0, mouseLook = null;
  const level = new T.Scene();
  level.background = new T.Color(0x494034);
  level.fog = new T.Fog(0x504637, 14, 37);
  const fill = new T.HemisphereLight(0xfff8dc, 0x765442, 1.6);
  const key = new T.DirectionalLight(0xfff6de, 1.2);
  key.position.set(2, 4, -1);
  level.add(fill, key);
  const eye = new T.PerspectiveCamera(61, 1, 0.06, 46);
  eye.rotation.order = 'YXZ';
  level.add(eye);
  const previewCamera = new T.PerspectiveCamera();
  const frustum = new T.Frustum(), projection = new T.Matrix4();
  const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -(entrance?.yaw ?? 0));

  function load() {
    if (loading || performance.now() < retryAt) return;
    loading = Promise.all([
      import('./service-level-simulation.js'), import('./service-level-world.js'),
      import('./service-level-environment.js'), import('./service-level-actors.js'), import('./service-level-hud.js'), config(),
    ]).then(([simulator, topology, scenery, cast, ui, rules]) => {
      kit = { ...simulator, ...topology, ...scenery, ...cast, ...ui, rules };
      if (!entrance) return;
      const material = new T.ShaderMaterial({
        uniforms: { corridor: { value: null }, sceneExposure: { value: 0 } },
        side: T.FrontSide, toneMapped: false,
        vertexShader: `
          varying vec4 screen;
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
            screen = gl_Position;
          }`,
        fragmentShader: `
          #include <common>
          ${T.ShaderChunk.tonemapping_pars_fragment.replace('uniform float toneMappingExposure;', 'const float toneMappingExposure = 1.0;')}
          uniform sampler2D corridor;
          uniform float sceneExposure;
          varying vec4 screen;
          void main() {
            vec2 uv = screen.xy / screen.w * .5 + .5;
            vec3 color = texture2D(corridor, clamp(uv, 0., 1.)).rgb;
            color = sceneExposure > 0.0 ? color / sceneExposure : NeutralToneMapping(color);
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }`,
      });
      portal = new T.Mesh(new T.PlaneGeometry(entrance.width, entrance.height), material);
      portal.name = 'service_level_threshold'; portal.userData.rasterOnly = true;
      portal.onBeforeRender = renderer => {
        // The apartment compositor applies exposure after the scene pass on high/ultra.
        material.uniforms.sceneExposure.value = renderer.getRenderTarget() ? Math.max(0.01, renderer.toneMappingExposure) : 0;
        material.uniformsNeedUpdate = true;
      };
      portal.position.set(entrance.x, entrance.height / 2, entrance.z);
      portal.rotation.y = entrance.yaw; portal.visible = false;
      scene.add(portal);
      requestRender();
    }).catch(error => {
      console.warn('Служебный этаж:', error);
      loading = null; retryAt = performance.now() + 1500;
    });
  }

  function setWorld(seed) {
    if (world && worldSeed === seed) return;
    environment?.dispose();
    worldSeed = seed;
    world = kit.createServiceLevelWorld(seed);
    environment = kit.createServiceLevelEnvironment(world);
    level.add(environment.group);
    previewSignature = '';
  }

  function drawScene(view, renderTarget = null) {
    const original = renderer.getRenderTarget();
    const exposure = renderer.toneMappingExposure, toneMapping = renderer.toneMapping;
    try {
      renderer.setRenderTarget(renderTarget);
      renderer.toneMappingExposure = 1; renderer.toneMapping = T.NeutralToneMapping;
      renderer.render(level, view);
    } finally {
      renderer.toneMappingExposure = exposure; renderer.toneMapping = toneMapping;
      renderer.setRenderTarget(original);
    }
  }

  function preview(seed, depth, lateral) {
    camera.updateMatrixWorld();
    portal.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!frustum.setFromProjectionMatrix(projection).intersectsObject(portal) || depth > 0.08) return hide();
    const ratio = camera.aspect;
    const width = Math.round(Math.min(PREVIEW_WIDTH, canvas.width, canvas.height * ratio));
    const height = Math.max(1, Math.round(width / ratio));
    if (width < 2) return false;
    const signature = [seed, width, height, camera.fov, ...camera.matrixWorld.elements].join('/');
    if (portal.visible && signature === previewSignature) return false;
    previewSignature = signature;
    setWorld(seed);
    if (!previewTarget) {
      previewTarget = new T.WebGLRenderTarget(width, height, { depthBuffer: true, samples: 0 });
      portal.material.uniforms.corridor.value = previewTarget.texture;
    } else if (previewTarget.width !== width || previewTarget.height !== height) previewTarget.setSize(width, height);
    previewCamera.copy(camera, false);
    previewCamera.far = eye.far;
    previewCamera.position.set(lateral, camera.position.y, -depth);
    previewCamera.quaternion.copy(turn).multiply(camera.quaternion);
    previewCamera.updateProjectionMatrix();
    environment.update(lateral, -depth);
    drawScene(previewCamera, previewTarget);
    portal.visible = renderedPreview = true;
    return true;
  }

  function hide() {
    if (!portal?.visible) return false;
    portal.visible = false;
    return true;
  }

  function releaseScenery() {
    hide();
    environment?.dispose(); environment = world = null;
    if (previewTarget) {
      previewTarget.dispose(); previewTarget = null;
      portal.material.uniforms.corridor.value = null;
    }
    previewSignature = '';
  }

  function unlockAudio() { actors?.resumeAudio?.(); }
  function lock() {
    unlockAudio();
    if (touch || document.pointerLockElement === canvas) return;
    try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag look remains available */ }
  }

  function resetInput() {
    keys.clear(); fire = reload = interact = false; tap = 0; mouseLook = null; joyX = joyZ = 0;
    for (const id of touches.keys()) { try { canvas.releasePointerCapture(id); } catch { /* already released */ } }
    touches.clear();
    controls?.joy.classList.remove('visible');
  }

  function activate(incoming, id) {
    state = incoming; selfId = id;
    const me = state.players.find(p => p.id === selfId);
    if (!me || !kit) return;
    setWorld(state.seed);
    hide();
    predicted = { ...me }; target = null; seq = 0; sentAt = sendClock = 0;
    yaw = me.yaw; pitch = me.pitch;
    if (active) return;
    const approach = walk.getNetworkPose();
    yaw = Math.atan2(Math.sin(approach.yaw - entrance.yaw), Math.cos(approach.yaw - entrance.yaw));
    pitch = T.MathUtils.clamp(approach.pitch, -AIM_LIMIT, AIM_LIMIT);
    eye.fov = camera.fov; dirtyResize = true;
    active = true; entryRequest = false;
    const joy = document.createElement('div');
    joy.className = 'service-level-joystick'; joy.setAttribute('aria-hidden', 'true');
    joy.append(document.createElement('i'));
    document.body.append(joy);
    document.body.classList.add('service-level-active');
    canvas.setAttribute('aria-label', 'Служебный этаж · камера игрока');
    walk.setSuspended(true);
    onMode(true);
    controls = { joy };
    actors = kit.createServiceLevelActors({ THREE: T, scene: level, camera: eye });
    hud = kit.createServiceLevelHud({
      onExit: () => exit(),
      onRestart: restart,
      onLock: lock,
      onFire: held => { fire = held; if (held) { tap = 0.12; unlockAudio(); } },
      onReload: () => { reload = true; unlockAudio(); },
      onRevive: held => { interact = held; unlockAudio(); },
    });
    hud.setTouch?.(touch);
    hud.setLocked(document.pointerLockElement === canvas);
    unlockAudio();
  }

  function finish(restore) {
    if (!active) return;
    active = entryRequest = leaving = paused = false;
    resetInput();
    hud?.dispose(); hud = null;
    actors?.dispose(); actors = null;
    controls?.joy.remove(); controls = null;
    releaseScenery();
    state = solo = target = predicted = lastPhase = null;
    renderedPreview = false; previewSignature = '';
    document.body.classList.remove('service-level-active');
    canvas.setAttribute('aria-label', '3D-квартира · управление камерой');
    walk.setSuspended(false);
    onMode(false);
    if (restore) walk.reconcileNetwork(restore, restore.ack, { snap: true });
    requestRender();
  }

  function enter() {
    if (active || entryRequest || !kit) return;
    const room = net();
    if (room?.active) {
      if (!room.client.connected) return;
      entryRequest = true;
      room.serviceRequest('enter').then(result => {
        entryRequest = false;
        if (!result?.ok && !active) { rejected = true; notify('Вход пока закрыт. Попробуйте снова.'); }
      });
    } else {
      solo = kit.createServiceLevel({ seed: soloSeed, config: kit.rules });
      solo.join(soloId);
      activate(solo.snapshot(), soloId);
    }
  }

  function exit() {
    if (!active || leaving) return;
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    resetInput();
    if (solo) {
      soloSeed = newServiceSeed();
      finish(entrance.returnPose);
    } else if (!net()?.client.connected) {
      net()?.client.leave();
    } else {
      leaving = true;
      net().serviceRequest('leave').then(result => {
        if (!result?.ok) { leaving = false; hud?.setStatus('Не удалось вернуться. Повторите попытку.'); }
      });
    }
  }

  function restart() {
    if (!active || leaving || paused || !['victory', 'defeat'].includes(state?.phase)) return;
    resetInput();
    if (solo) {
      soloSeed = newServiceSeed();
      solo = kit.createServiceLevel({ seed: soloSeed, config: kit.rules });
      solo.join(soloId); activate(solo.snapshot(), soloId);
    } else net()?.serviceRequest('restart');
  }

  function applyNetwork(snapshot, seed, id, apartmentPose) {
    roomState = snapshot ?? null; nextSeed = seed;
    const me = roomState?.players.find(p => p.id === id);
    if (!me) {
      if (active && !solo) finish(apartmentPose || entrance.returnPose);
      return;
    }
    if (!active || state?.seed !== seedForRun()) {
      activate(roomState, id);
      return;
    }
    state = roomState;
    const estimate = sentAt ? Math.min(0.11, Math.max(0, (performance.now() - sentAt) / 2000)) : 0;
    target = { ...me, ...kit.moveServicePlayer(world, me, readInput(), estimate, kit.rules) };
  }

  function seedForRun() { return roomState?.seed ?? nextSeed ?? soloSeed; }

  function updateApartment() {
    if (!entrance || !canEnter()) return hide();
    const position = walk.getNetworkPose();
    const depth = entrance.depth(position), lateral = entrance.lateral(position);
    const distance = Math.hypot(depth, lateral);
    if (distance < LOAD_DISTANCE && !document.hidden && !kit) load();
    if (distance >= LOAD_DISTANCE && environment) { releaseScenery(); return true; }
    if (depth < -0.2) rejected = false;
    if (!doors.list.find(d => d.id === entrance.id)?.open || courier() || !kit) return hide();
    if (!rejected && entrance.crossed(position)) { enter(); return false; }
    if (depth > 0.1 || Math.hypot(depth, lateral) > PREVIEW_DISTANCE) return hide();
    return preview(seedForRun(), entrance.depth(camera.position), entrance.lateral(camera.position));
  }

  const signed = (plus, minus) => Number(keys.has(plus)) - Number(keys.has(minus));
  function readInput() {
    return {
      moveX: T.MathUtils.clamp(signed('KeyD', 'KeyA') + joyX, -1, 1),
      moveZ: T.MathUtils.clamp(signed('KeyW', 'KeyS') + signed('ArrowUp', 'ArrowDown') + joyZ, -1, 1),
      yaw, pitch, fire: fire || tap > 0, reload, interact: interact || keys.has('KeyE'),
    };
  }

  function update(dt) {
    if (!active || document.hidden || renderer.getContext().isContextLost()) return;
    paused = !solo && !net()?.client.connected;
    hud.setStatus(paused ? 'Связь с комнатой прервалась' : leaving ? 'Возвращаемся в квартиру…' : '');
    yaw += signed('ArrowLeft', 'ArrowRight') * 1.65 * dt;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    const input = readInput();
    const step = Math.min(0.05, dt);
    if (solo) {
      solo.input(selfId, { ...input, seq: ++seq });
      solo.tick(step);
      state = solo.snapshot(); reload = false;
    } else if (!paused && !leaving) {
      sendClock += step;
      if (sendClock >= SEND_INTERVAL || reload) {
        if (net()?.serviceInput({ ...input, seq: ++seq })) sentAt = performance.now();
        sendClock %= SEND_INTERVAL; reload = false;
      }
    }
    tap = Math.max(0, tap - step);
    if (lastPhase !== state.phase) {
      lastPhase = state.phase;
      if (['victory', 'defeat'].includes(lastPhase) && document.pointerLockElement === canvas) document.exitPointerLock?.();
    }
    const me = state.players.find(p => p.id === selfId);
    if (!me) return;
    if (solo || me.downed) predicted = me;
    else if (!paused && !leaving) {
      const local = { ...me, x: predicted.x, z: predicted.z };
      predicted = kit.moveServicePlayer(world, local, input, step, kit.rules);
      if (target) {
        target = { ...me, ...kit.moveServicePlayer(world, target, input, step, kit.rules) };
        const dx = target.x - predicted.x, dz = target.z - predicted.z;
        const blend = Math.hypot(dx, dz) > 1 ? 1 : 1 - Math.exp(-10 * step);
        const corrected = world.move(predicted.x, predicted.z, dx * blend, dz * blend, kit.rules.player.radius);
        predicted = { ...predicted, ...corrected };
      }
    }
    if (dirtyResize) {
      const alt = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      eye.aspect = Math.max(0.1, alt);
      eye.fov = alt < 1 ? Math.min(90, camera.fov + 6) : camera.fov;
      eye.updateProjectionMatrix(); dirtyResize = false;
    }
    eye.position.set(predicted.x, me.downed ? kit.rules.player.downedEyeHeight : kit.rules.player.eyeHeight, predicted.z);
    eye.rotation.set(pitch, yaw, 0, 'YXZ');
    environment.update(predicted.x, predicted.z);
    actors.update(state, { playerId: selfId, dt: step });
    const canRevive = !me.downed && state.players.some(player => player.downed &&
      Math.hypot(player.x - me.x, player.z - me.z) <= kit.rules.player.reviveRadius &&
      world.hasLineOfSight(me.x, me.z, player.x, player.z));
    hud.update(state, { playerId: selfId, canRevive, canRestart: !paused && !leaving });
    drawScene(eye);
  }

  function topLevelInput(event) {
    if (!active || event.metaKey || event.altKey || event.ctrlKey) return;
    if (event.code === 'Escape') {
      // Native Esc releases pointer lock first. Use the visible return control to leave.
      resetInput(); event.stopImmediatePropagation(); return;
    }
    const inHud = event.target?.closest?.('button,input,textarea');
    if (inHud && !KEYS.has(event.code)) return;
    event.stopImmediatePropagation();
    if (!KEYS.has(event.code)) return;
    event.preventDefault();
    if (event.type === 'keyup') keys.delete(event.code);
    else {
      keys.add(event.code); unlockAudio();
      if (event.code === 'KeyR' && !event.repeat) reload = true;
    }
  }

  function rotate(dx, dy, speed) {
    yaw -= dx * speed;
    pitch = T.MathUtils.clamp(pitch - dy * speed, -AIM_LIMIT, AIM_LIMIT);
  }

  canvas.addEventListener('pointerdown', event => {
    if (!active) return;
    event.stopImmediatePropagation(); unlockAudio();
    if (event.pointerType === 'touch') {
      touch = true; hud?.setTouch?.(true);
      const side = event.clientX < canvas.clientWidth * 0.47 ? 'move' : 'look';
      if ([...touches.values()].some(value => value.side === side)) return;
      const { clientX: x, clientY: y, pointerId: id } = event;
      touches.set(id, { side, x, y });
      if (side === 'move') {
        controls.joy.style.left = x + 'px'; controls.joy.style.top = y + 'px';
        controls.joy.classList.add('visible');
      }
      try { canvas.setPointerCapture(id); } catch { /* no capture */ }
    } else if (event.button === 0) {
      if (document.pointerLockElement === canvas) { fire = true; tap = 0.12; }
      else { mouseLook = { x: event.clientX, y: event.clientY, left: true, distance: 0 }; lock(); }
    } else if (event.button === 2) mouseLook = { x: event.clientX, y: event.clientY };
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (!active) return;
    event.stopImmediatePropagation();
    const tracked = touches.get(event.pointerId);
    if (tracked?.side === 'move') {
      const x = event.clientX - tracked.x, y = event.clientY - tracked.y;
      const distance = Math.max(JOYSTICK_RADIUS, Math.hypot(x, y));
      joyX = x / distance; joyZ = -y / distance;
      controls.joy.firstChild.style.transform = `translate(${joyX * 32}px, ${-joyZ * 32}px)`;
    } else if (tracked?.side === 'look') {
      rotate(event.clientX - tracked.x, event.clientY - tracked.y, 0.005);
      tracked.x = event.clientX; tracked.y = event.clientY;
    } else if (mouseLook && document.pointerLockElement !== canvas) {
      const dx = event.clientX - mouseLook.x, dy = event.clientY - mouseLook.y;
      rotate(dx, dy, 0.004);
      if (mouseLook.left) mouseLook.distance += Math.hypot(dx, dy);
      mouseLook.x = event.clientX; mouseLook.y = event.clientY;
    }
  }, true);
  function releasePointer(event) {
    if (!active) return;
    const tracked = touches.get(event.pointerId); touches.delete(event.pointerId);
    if (tracked?.side === 'move') {
      joyX = joyZ = 0; controls.joy.classList.remove('visible'); controls.joy.firstChild.style.transform = '';
    }
    if (event.pointerType !== 'touch') {
      if (event.type === 'pointerup' && mouseLook?.left && mouseLook.distance < 4) tap = 0.12;
      fire = false; mouseLook = null;
    }
  }
  for (const event of ['pointerup', 'pointercancel']) addEventListener(event, releasePointer, true);
  addEventListener('keydown', topLevelInput, true);
  addEventListener('keyup', topLevelInput, true);
  addEventListener('blur', resetInput);
  canvas.addEventListener('contextmenu', event => { if (active) event.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); else previewSignature = ''; });
  document.addEventListener('pointerlockchange', () => {
    if (!active) return;
    fire = false; tap = 0; mouseLook = null;
    hud?.setLocked(document.pointerLockElement === canvas);
  });
  document.addEventListener('mousemove', event => {
    if (active && document.pointerLockElement === canvas) rotate(event.movementX, event.movementY, 0.0023);
  });
  new ResizeObserver(() => { dirtyResize = true; }).observe(canvas);
  const style = document.createElement('style');
  style.textContent = `
    .service-level-active > :is(.title-card,#hud-bottom,#panel,#panel-toggle,#coach,.kw-float,.kh-score,.kh-hud,.social-hud,.social-radio,.party-hud,.party-touch,.tv-layer,#ab-badge,#kw-dock,.kvm-hit-marker) { display: none !important }
    .service-level-joystick { position: fixed; z-index: 88; pointer-events: none; display: none; width: 100px; height: 100px; border: 1px solid #e1dcb376; border-radius: 50%; translate: -50% -50%; align-items:center; justify-content:center; background: #19170d47 }
    .service-level-joystick.visible { display: flex }
    .service-level-joystick i { width: 39px; height: 39px; border: 1px solid #ece1bfad; border-radius: 50%; background: #cfc0955e }
  `;
  document.head.append(style);
  return { updateApartment, update, applyNetwork, resetNetwork() { roomState = nextSeed = null; if (active && !solo) finish(entrance.returnPose); },
    get active() { return active; }, get transitioning() { return entryRequest; }, get previewVisible() { return !!portal?.visible && renderedPreview; },
    get snapshot() { return state; },
    get view() { return active ? { x: eye.position.x, y: eye.position.y, z: eye.position.z, yaw, pitch } : null; },
  };
}
