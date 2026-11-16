// Зеркала в растре: честное плоское отражение (как Reflector из three) — сцена снимается второй камерой, отражённой
// в плоскости зеркала, и ложится на стекло проекцией. Параллакс верный с любой точки, без «куба» из одной точки.
//
// Какие зеркала: меш с userData.mirror (ванная, bath.js; лицо зеркала — его +Z) и модели обстановки из
// web/spec/break.json → models[…].mirror (прихожая: стекло по имени материала или прямоугольник в координатах модели).
// Шкафов с зеркальными дверями в каталоге сейчас нет; появятся — та же запись в break.json.
//
// createMirrors({ THREE, scene, camera, renderer, pipe, requestRender, getDecor })
//   -> { update() -> bool  (ищет новые зеркала раз в полсекунды; true — нужен кадр), list (для проверок), dispose() }
//
// Как дёшево:
//   - Камера отражения — «окно» точно по стеклу (несимметричная пирамида от отражённого глаза через углы зеркала):
//     ближняя плоскость = плоскость зеркала, поэтому стена за зеркалом и всё за ним отсекаются сами, а видимость
//     вещей считается по тому, что видно в зеркале, а не по всей комнате.
//   - Снимается из onBeforeRender стекла: только когда зеркало в кадре (three не рисует его вне пирамиды камеры) и к нам
//     лицом. Камера не двигалась — не чаще раза в STATIC_MS (и один догоняющий кадр, чтобы ничего не застыло).
//   - Цель — по размеру зеркала на экране × SCALE[качество], не больше CAP[качество] пикселей по стороне, без MSAA.
//   - Рекурсии нет: на время съёмки все стёкла зеркал спрятаны (в отражении зеркало — своя рама и подложка).
//     Руки с оружием рисуются отдельной сценой (viewmodel.js) — в отражение не попадают.
//   - Слои камеры отражения = слои главной камеры: маски света lighting.js не пересчитываются.
// Стекло — отдельный меш поверх зеркала (userData.rasterOnly): фото-режим, снимок PNG и GLB видят исходное зеркало
// (трассировщик отражает честно сам). На время фото и снимка стекло спрятано (pipe.photo, pipe.onLive).
//
// Разбитое: пуля (impacts.js → shotHandlers) делит стекло на ячейки Вороного (гуще у попадания), ячейки вокруг пули
// выпадают осколками (breakables.slabShards), остальные держатся в раме и отражают каждая под своим углом,
// между ними тёмные трещины, на месте выпавших — подложка. Следующие пули выбивают ещё. «Убрать следы и осколки» — целое.
import { breakSpec, shotHandlers, networkDamageResetters, onRestore, voronoiCells, impactSeeds, decorHolderOf } from './breakables.js';
import { stableObjectId } from './network-objects.js';
import { decorPart } from './decor.js';

const SCALE = { eco: 0.6, fast: 0.7, high: 0.85, ultra: 1 };
const CAP = { eco: 640, fast: 768, high: 1024, ultra: 1536 };
const STATIC_MS = 150;     // камера стоит: снимать не чаще
const SCAN_MS = 500;       // поиск новых зеркал
const BREAK = { seeds: 26, hole: 0.15, extra: 0.15, tex: 256, thick: 0.004 };

const VERT = /* glsl */`
uniform mat4 textureMatrix;
varying vec4 vMirror;
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  vMirror = textureMatrix * modelMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const FRAG = /* glsl */`
uniform sampler2D tMirror;
uniform sampler2D tBreak;
uniform vec3 uTint;
uniform vec3 uBacking;
uniform float uBroken;
uniform vec4 uRect;      // x0, y0, ширина, высота стекла в его координатах
varying vec4 vMirror;
varying vec2 vLocal;
void main() {
  float keep = 1.0, line = 1.0;
  vec2 off = vec2( 0.0 );
  if ( uBroken > 0.5 ) {
    vec4 b = texture2D( tBreak, ( vLocal - uRect.xy ) / uRect.zw );
    keep = step( 0.5, b.r );
    off = ( b.gb - 0.5 ) * 0.07;   // каждый осколок в раме чуть повёрнут — своё отражение
    line = b.a;
  }
  vec2 uv = vMirror.xy / vMirror.w + off;
  vec3 c = texture2D( tMirror, uv ).rgb * uTint * line;
  gl_FragColor = vec4( mix( uBacking, c, keep ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createMirrors({ THREE, scene, camera, renderer, pipe, requestRender, getDecor }) {
  let SPEC = null;
  breakSpec().then(s => { SPEC = s; lastScan = 0; });
  const mirrors = [];
  const known = new WeakSet();   // источники, у которых уже есть стекло (меш или часть обстановки)
  const shardMat = new THREE.MeshStandardMaterial({ color: 0xd9dfdf, metalness: 1, roughness: 0.06 });
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  let hidden = false, capturing = false, busy = false, lastScan = 0;
  const offLive = pipe?.onLive?.(live => { capturing = !live; syncHidden(); if (live) requestRender?.(); });
  const offRestore = onRestore(() => mirrors.forEach(unbreak));

  // ---------- стекло ----------
  function makeMirror({ geometry, parent, position = null, rect, round = false }) {
    const breakTex = new THREE.DataTexture(new Uint8Array(BREAK.tex * BREAK.tex * 4), BREAK.tex, BREAK.tex);
    breakTex.magFilter = THREE.NearestFilter; breakTex.minFilter = THREE.NearestFilter;
    const rt = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, samples: 0 });
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tMirror: { value: rt.texture }, tBreak: { value: breakTex }, textureMatrix: { value: new THREE.Matrix4() },
        uTint: { value: new THREE.Color(0.9, 0.92, 0.92) }, uBacking: { value: new THREE.Color(0.006, 0.0055, 0.005) },
        uBroken: { value: 0 }, uRect: { value: new THREE.Vector4(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0) },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const surface = new THREE.Mesh(geometry, mat);
    surface.name = 'mirror_glass';
    if (position) surface.position.copy(position);
    surface.castShadow = false; surface.receiveShadow = false;
    surface.visible = !hidden;
    Object.assign(surface.userData, { rasterOnly: true, mirrorGlass: true, noPick: true,
      networkId: `${stableObjectId(parent)}/mirror` });
    parent.add(surface);
    const vcam = new THREE.PerspectiveCamera();
    vcam.matrixAutoUpdate = false; vcam.matrixWorldAutoUpdate = false;
    const m = { surface, mat, rt, vcam, rect, round, breakTex, st: null, last: 0, follow: null, force: true,
      lastCam: new THREE.Matrix4(), lastProj: new THREE.Matrix4(), lastWorld: new THREE.Matrix4(), size: [64, 64] };
    surface.onBeforeRender = (r, sc, cam, geo, material) => { if (material === mat && cam === camera && !busy) draw(m); };
    shotHandlers.set(surface, (hit, dir, api) => shoot(m, hit, dir, api));
    networkDamageResetters.set(surface, () => unbreak(m));
    mirrors.push(m);
    return m;
  }

  function fromMesh(mesh, round = false) {
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    const m = makeMirror({ geometry: g, parent: mesh, rect: { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z: b.max.z }, round });
    m.source = mesh; mesh.userData.networkMirror = true;
    m.surface.userData.networkId = stableObjectId(mesh);
    shotHandlers.set(mesh, shotHandlers.get(m.surface));   // стекло совпадает с исходным мешем: луч может найти любой из них
    networkDamageResetters.set(mesh, () => unbreak(m));
    return m;
  }
  function fromRect(root, r, round = false) {
    const [w, h] = r.size;
    return makeMirror({ geometry: new THREE.PlaneGeometry(w, h), parent: root, position: new THREE.Vector3(...r.center),
      rect: { x0: -w / 2, x1: w / 2, y0: -h / 2, y1: h / 2, z: 0 }, round });
  }

  function drop(m) {
    m.surface.removeFromParent();
    if (m.surface.geometry.type === 'PlaneGeometry') m.surface.geometry.dispose();   // свой прямоугольник; геометрию меша-источника не трогаем
    m.mat.dispose(); m.rt.dispose(); m.breakTex.dispose();
    clearTimeout(m.follow);
  }

  // ---------- поиск ----------
  const inScene = o => { while (o) { if (o === scene) return true; o = o.parent; } return false; };
  const findByMaterial = (o, name) => { let f = null; o.traverse(x => { if (!f && x.isMesh && x.material?.name === name && !x.userData.mirrorGlass) f = x; }); return f; };
  function scan() {
    for (let i = mirrors.length - 1; i >= 0; i--) if (!inScene(mirrors[i].surface)) { drop(mirrors[i]); mirrors.splice(i, 1); }
    let added = false;
    scene.traverse(o => {
      if (o.isMesh && o.userData.mirror && !known.has(o)) { known.add(o); fromMesh(o); added = true; }
    });
    const decor = getDecor?.();
    if (decor && SPEC) for (const holder of decor.holders ?? []) {
      if (known.has(holder) || !holder.children.length) continue;
      const info = decorPart(holder), model = info?.option?.parts?.[info.index]?.model;
      const spec = model && SPEC.models?.[model]?.mirror;
      known.add(holder);
      if (!spec) continue;
      const root = holder.children[0];
      if (spec.material) { const mesh = findByMaterial(root, spec.material); if (mesh) { fromMesh(mesh, !!spec.round); added = true; } }
      else if (spec.rect) { fromRect(root, spec.rect, !!spec.round); added = true; }
    }
    return added;
  }

  // ---------- съёмка отражения ----------
  const c00 = new THREE.Vector3(), c10 = new THREE.Vector3(), c01 = new THREE.Vector3(), c11 = new THREE.Vector3();
  const n = new THREE.Vector3(), e = new THREE.Vector3(), ev = new THREE.Vector3(), vr = new THREE.Vector3(), vu = new THREE.Vector3(), vn = new THREE.Vector3();
  const t1 = new THREE.Vector3(), buf = new THREE.Vector2(), ndc = new THREE.Vector3();
  function draw(m) {
    const now = performance.now(), s = m.surface;
    const still = camera.matrixWorld.equals(m.lastCam) && camera.projectionMatrix.equals(m.lastProj) && s.matrixWorld.equals(m.lastWorld);
    if (still && !m.force) {
      if (now - m.last < STATIC_MS) {
        if (!m.follow) m.follow = setTimeout(() => { m.follow = null; m.force = true; requestRender?.(); }, STATIC_MS + 20);
        return;
      }
    }
    const { x0, x1, y0, y1, z } = m.rect;
    c00.set(x0, y0, z).applyMatrix4(s.matrixWorld); c10.set(x1, y0, z).applyMatrix4(s.matrixWorld);
    c01.set(x0, y1, z).applyMatrix4(s.matrixWorld); c11.set(x1, y1, z).applyMatrix4(s.matrixWorld);
    vu.subVectors(c01, c00); vr.subVectors(c10, c00);
    const wM = vr.length(), hM = vu.length();
    if (wM < 1e-4 || hM < 1e-4) return;
    n.crossVectors(vr, vu).normalize();
    e.setFromMatrixPosition(camera.matrixWorld);
    const side = t1.subVectors(e, c00).dot(n);
    if (side < 0.003) return;   // смотрим на зеркало сзади или вплотную
    ev.copy(e).addScaledVector(n, -2 * side);   // отражённый глаз — за зеркалом
    vn.copy(n).negate();
    vu.normalize(); vr.crossVectors(vu, vn).normalize(); vu.crossVectors(vn, vr);
    let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
    for (const c of [c00, c10, c01, c11]) {
      t1.subVectors(c, ev);
      const a = t1.dot(vr), u = t1.dot(vu);
      l = Math.min(l, a); r = Math.max(r, a); b = Math.min(b, u); t = Math.max(t, u);
    }
    const cam = m.vcam;
    cam.projectionMatrix.makePerspective(l, r, t, b, side, Math.max(camera.far, side + 1));
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.matrixWorld.makeBasis(vr, vu, vn).setPosition(ev);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.layers.mask = camera.layers.mask;
    // размер цели — по зеркалу на экране
    renderer.getDrawingBufferSize(buf);
    let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
    for (const c of [c00, c10, c01, c11]) {
      ndc.copy(c).project(camera);
      sx0 = Math.min(sx0, ndc.x); sx1 = Math.max(sx1, ndc.x); sy0 = Math.min(sy0, ndc.y); sy1 = Math.max(sy1, ndc.y);
    }
    const q = pipe?.quality ?? 'eco';
    const ppm = Math.max((Math.min(sx1, 1) - Math.max(sx0, -1)) * buf.x / 2 / wM, (Math.min(sy1, 1) - Math.max(sy0, -1)) * buf.y / 2 / hM, 1) * (SCALE[q] ?? 0.5);
    const k = Math.min(1, (CAP[q] ?? 512) / (Math.max(wM, hM) * ppm));
    const W = Math.max(64, Math.round(wM * ppm * k / 32) * 32), H = Math.max(64, Math.round(hM * ppm * k / 32) * 32);
    if (Math.abs(W - m.size[0]) > m.size[0] * 0.2 || Math.abs(H - m.size[1]) > m.size[1] * 0.2) { m.size = [W, H]; m.rt.setSize(W, H); }
    m.mat.uniforms.textureMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // съёмка: все стёкла зеркал спрятаны (без рекурсии)
    busy = true;
    const vis = mirrors.map(x => x.surface.visible);
    mirrors.forEach(x => { x.surface.visible = false; });
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(m.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    mirrors.forEach((x, i) => { x.surface.visible = vis[i]; });
    busy = false;
    m.lastCam.copy(camera.matrixWorld); m.lastProj.copy(camera.projectionMatrix); m.lastWorld.copy(s.matrixWorld);
    m.last = now; m.force = false;
  }

  // ---------- разбить ----------
  const lp = new THREE.Vector3(), ws = new THREE.Vector3();
  // описанный многоугольник (не вписанный): между хордой и кромкой круглого стекла не остаётся щелей без ячейки
  function circle(w, h, n = 32) { const k = 1 / Math.cos(Math.PI / n), out = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([Math.cos(a) * w / 2 * k, Math.sin(a) * h / 2 * k]); } return out; }
  function shoot(m, hit, dir, api) {
    m.surface.userData.networkDamaged = true;
    if (m.source) m.source.userData.networkDamaged = true;
    const { x0, x1, y0, y1, z } = m.rect, w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    m.surface.updateWorldMatrix(true, false);
    lp.copy(hit.point); m.surface.worldToLocal(lp);
    const u = lp.x - cx, v = lp.y - cy;
    const sc = m.surface.getWorldScale(ws), k = 2 / Math.max(1e-4, sc.x + sc.y);   // метры мира -> координаты стекла
    if (!m.st) {
      const seeds = impactSeeds(w, h, u, v, BREAK.seeds, api.random);
      m.st = { seeds, cells: voronoiCells(w, h, seeds, m.round ? circle(w, h) : null), gone: seeds.map(() => false),
        off: seeds.map(() => [api.random(), api.random()]) };
    }
    const st = m.st;
    // выпадают: ячейка под пулей, ячейки ближе hole к пуле и немного случайных
    let nearest = -1, nd = Infinity;
    st.seeds.forEach(([sx, sy], i) => { const d = Math.hypot(sx - u, sy - v); if (d < nd) { nd = d; nearest = i; } });
    const fall = st.seeds.map(([sx, sy], i) => !st.gone[i] && (i === nearest || Math.hypot(sx - u, sy - v) < BREAK.hole * k || api.random() < BREAK.extra));
    if (!fall.some(Boolean)) return true;
    fall.forEach((f, i) => { if (f) st.gone[i] = true; });
    // осколки падают от стены в комнату (по нормали зеркала), а не за пулей в стену
    const out = new THREE.Vector3(0, 0, 1).transformDirection(m.surface.matrixWorld);
    api.slabShards({ object: m.surface, rect: { cx, cy, w, h }, z0: z - BREAK.thick * k, z1: z, cells: st.cells, fall, material: shardMat,
      point: hit.point, dir: out, keep: false, kind: 'glass', exclude: decorHolderOf(m.surface)?.holder ?? m.surface.parent });
    paint(m);
    api.sound('glass', hit.point);
    requestRender?.();
    return true;   // пуля остановлена (за зеркалом стена)
  }
  // текстура разбитого: R — ячейка на месте, G, B — её наклон, A — затемнение у трещин
  function paint(m) {
    const { x0, x1, y0, y1 } = m.rect, w = x1 - x0, h = y1 - y0, N = BREAK.tex, st = m.st, d = m.breakTex.image.data;
    const S = st.seeds, line = Math.min(w, h) * 0.006;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -w / 2 + ((i + 0.5) / N) * w, y = -h / 2 + ((j + 0.5) / N) * h;
      let a = -1, da = Infinity, db = Infinity;
      for (let s = 0; s < S.length; s++) {
        const dd = (S[s][0] - x) ** 2 + (S[s][1] - y) ** 2;
        if (dd < da) { db = da; da = dd; a = s; } else if (dd < db) db = dd;
      }
      const edge = Math.sqrt(db) - Math.sqrt(da) < line;
      const o = (j * N + i) * 4, keep = !st.gone[a];
      d[o] = keep ? 255 : 0;
      d[o + 1] = st.off[a][0] * 255; d[o + 2] = st.off[a][1] * 255;
      d[o + 3] = edge ? 40 : 255;
    }
    m.breakTex.needsUpdate = true;
    m.mat.uniforms.uBroken.value = 1;
    m.force = true;
  }
  function unbreak(m) {
    m.surface.userData.networkDamaged = false;
    if (m.source) m.source.userData.networkDamaged = false;
    m.st = null;
    m.mat.uniforms.uBroken.value = 0;
    m.force = true;
  }

  // ---------- кадр ----------
  function syncHidden() {
    const h = !!pipe?.photo || capturing;
    if (h === hidden) return false;
    hidden = h;
    for (const m of mirrors) m.surface.visible = !h;
    return true;
  }
  function update() {
    let changed = syncHidden();
    const now = performance.now();
    if (now - lastScan > SCAN_MS) { lastScan = now; if (scan()) changed = true; }
    return changed;
  }

  function dispose() {
    offLive?.(); offRestore();
    mirrors.forEach(drop); mirrors.length = 0;
    shardMat.dispose();
  }

  return { update, dispose, get list() { return mirrors; } };
}
