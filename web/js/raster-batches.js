// Raster-only proxies. The authored scene remains the gameplay/raycast/export
// source of truth and is restored synchronously after every draw, including errors.
import { warmRasterPrograms } from './shader-warmup.js';

const SCAN_MS = 750, MAX_VERTICES = 1_500_000;

export function createRasterBatches({ THREE, scene, renderer }) {
  const supported = !!renderer.extensions?.has?.('WEBGL_multi_draw');
  const root = new THREE.Group(); root.name = 'raster_batches'; root.visible = false;
  root.matrixAutoUpdate = root.matrixWorldAutoUpdate = false; // proxy matrices are already in world coordinates.
  Object.assign(root.userData, { networkEntity: true, rasterOnly: true, noPick: true, noNetwork: true });
  const groups = new Map(), ids = new WeakMap();
  const materialKeys = new WeakMap();
  let sources = [], serial = 0, lastScan = -Infinity, dirty = true, disposed = false, depth = 0;
  let vertices = 0, rebuilds = 0, camera = null, materialFrame = 0;
  const id = object => { if (!ids.has(object)) ids.set(object, ++serial); return ids.get(object); };
  const marked = o => {
    const u = o.userData || {};
    return u.networkEntity || u.networkAvatar || u.networkEffect || u.viewmodel || u.impact || u.shard || u.decorStub ||
      u.mirror || u.mirrorGlass || u.networkMirror || u.glass || u.screen || u.tvScreen || u.shadowOnly || u.noPick || u.noNetwork || u.context;
  };
  const plainCallbacks = o => ['onBeforeRender', 'onAfterRender', 'onBeforeShadow', 'onAfterShadow']
    .every(key => o[key] === THREE.Object3D.prototype[key]);
  const opaque = m => m && !m.isShaderMaterial && !m.isRawShaderMaterial && !m.transparent && !(m.transmission > 0) && !(m.opacity < 1);
  const ignoredMaterialKeys = new Set(['id', 'uuid', 'name', 'version', 'userData', '_listeners', 'color', 'onBeforeCompile', 'customProgramCacheKey']);
  function captureValue(v) {
    if (!v || typeof v !== 'object' || v.isTexture) return { kind: 0, value: v };
    let keys;
    if (v.isColor) keys = ['r', 'g', 'b'];
    else if (v.isVector2) keys = ['x', 'y'];
    else if (v.isVector3) keys = ['x', 'y', 'z'];
    else if (v.isVector4 || v.isQuaternion) keys = ['x', 'y', 'z', 'w'];
    else if (v.isEuler) keys = ['x', 'y', 'z', 'order'];
    else if (v.isMatrix3 || v.isMatrix4) keys = ['elements'];
    else if (v.isPlane) keys = ['normal', 'constant'];
    else if (Array.isArray(v)) return { kind: 2, values: v.map(captureValue) };
    else if (Object.getPrototypeOf(v) === Object.prototype) {
      keys = Object.keys(v); return { kind: 3, keys, values: keys.map(key => captureValue(v[key])) };
    } else return { kind: 0, value: v };
    return { kind: 1, proto: Object.getPrototypeOf(v), keys, values: keys.map(key => captureValue(v[key])) };
  }
  function valueMatches(v, s) {
    if (s.kind === 0) return Object.is(v, s.value);
    if (!v || typeof v !== 'object') return false;
    if (s.kind === 2) {
      if (!Array.isArray(v) || v.length !== s.values.length) return false;
      for (let i = 0; i < s.values.length; i++) if (!valueMatches(v[i], s.values[i])) return false;
      return true;
    }
    if (s.kind === 1 && Object.getPrototypeOf(v) !== s.proto || s.kind === 3 &&
      (Object.getPrototypeOf(v) !== Object.prototype || Object.keys(v).length !== s.keys.length)) return false;
    for (let i = 0; i < s.keys.length; i++) if (!valueMatches(v[s.keys[i]], s.values[i])) return false;
    return true;
  }
  function semanticValue(v) {
    if (typeof v === 'number' && !Number.isFinite(v)) return ['number', String(v)];
    if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (v.isTexture) return ['texture', id(v)];
    if (v.isColor) return ['color', v.r, v.g, v.b];
    if (v.isVector2 || v.isVector3 || v.isVector4 || v.isMatrix3 || v.isMatrix4 || v.isEuler || v.isQuaternion) return v.toArray();
    if (v.isPlane) return ['plane', v.normal.x, v.normal.y, v.normal.z, v.constant];
    if (Array.isArray(v)) return v.map(semanticValue);
    if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype)
      return Object.keys(v).sort().map(key => [key, semanticValue(v[key])]);
    return ['identity', id(v)]; // unknown objects/functions never become accidentally equivalent.
  }
  function semanticKey(m) {
    let cached = materialKeys.get(m);
    if (cached?.frame === materialFrame) return cached.key;
    const defaultHooks = m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey;
    const roomHooks = m.userData.roomLightingPatched && m.userData.roomLightingBatchSafe;
    let key = null;
    if (m.isMeshStandardMaterial && opaque(m) && m.color?.isColor && (defaultHooks || roomHooks) &&
      m.onBeforeRender === THREE.Material.prototype.onBeforeRender) {
      if (cached?.checks && cached.hook === m.onBeforeCompile && cached.programKey === m.customProgramCacheKey && cached.roomHooks === !!roomHooks) {
        let unchanged = true;
        for (const check of cached.checks) {
          const next = m[check.name], state = check.state;
          if (state.kind === 0 ? !Object.is(next, state.value) : !valueMatches(next, state)) { unchanged = false; break; }
        }
        if (unchanged) { cached.frame = materialFrame; return cached.key; }
      }
      const values = [];
      // Include every own BRDF/render/texture/define/clipping parameter. Only the
      // diffuse multiplier is moved into the per-instance color texture.
      const checks = [];
      for (const name of Object.keys(m).sort()) if (!ignoredMaterialKeys.has(name)) {
        values.push([name, semanticValue(m[name])]); checks.push({ name, state: captureValue(m[name]) });
      }
      values.push(['roomLighting', !!roomHooks]); key = JSON.stringify(values);
      materialKeys.set(m, { frame: materialFrame, key, checks, hook: m.onBeforeCompile, programKey: m.customProgramCacheKey, roomHooks: !!roomHooks }); return key;
    }
    materialKeys.set(m, { frame: materialFrame, key }); return key;
  }
  function safeMatrix(m) {
    const e = m.elements, a = e[0] ** 2 + e[1] ** 2 + e[2] ** 2, b = e[4] ** 2 + e[5] ** 2 + e[6] ** 2, c = e[8] ** 2 + e[9] ** 2 + e[10] ** 2;
    return a > 1e-20 && b > 1e-20 && c > 1e-20 && m.determinant() >= 0 &&
      Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) <= 1e-5 * Math.sqrt(a * b) &&
      Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) <= 1e-5 * Math.sqrt(a * c) &&
      Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) <= 1e-5 * Math.sqrt(b * c);
  }
  function eligible(o) {
    if (!o.isMesh || o.children.length || o.frustumCulled === false || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || !plainCallbacks(o) ||
      !o.geometry?.attributes.position || o.morphTargetInfluences?.length || Object.keys(o.geometry.morphAttributes).length) return false;
    for (let p = o; p && p !== scene; p = p.parent) if (marked(p)) return false;
    if (!safeMatrix(o.matrixWorld)) return false; // batching normals require orthogonal basis columns and preserved winding.
    if (!(Array.isArray(o.material) ? o.material : [o.material]).every(opaque)) return false;
    for (const a of Object.values(o.geometry.attributes)) if (a.isInstancedBufferAttribute ||
      (a.data?.usage ?? a.usage) === THREE.DynamicDrawUsage || (a.data?.usage ?? a.usage) === THREE.StreamDrawUsage) return false;
    return !o.customDepthMaterial && !o.customDistanceMaterial;
  }
  function geometryKey(g) {
    return Object.entries(g.attributes).sort(([a], [b]) => a.localeCompare(b)).map(([key, a]) =>
      `${key}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}:${a.gpuType}`).join(',');
  }
  function geometryVersion(g) {
    let version = `${id(g)}:${g.index?.version ?? 0}:${g.drawRange.start}:${g.drawRange.count}`;
    for (const [key, a] of Object.entries(g.attributes)) version += `:${key}:${id(a)}:${a.data?.version ?? a.version}`;
    for (const p of g.groups) version += `:${p.start},${p.count},${p.materialIndex}`;
    return version;
  }
  function describe(o) {
    const g = o.geometry, size = g.index?.count ?? g.attributes.position.count;
    const start = Math.max(0, g.drawRange.start), end = Math.min(size, start + g.drawRange.count);
    const ranges = new Map();
    const add = (m, from, count) => {
      const lo = Math.max(start, from), hi = Math.min(end, from + count);
      if (hi <= lo || !m) return;
      if (!ranges.has(m)) ranges.set(m, []);
      ranges.get(m).push([lo, hi - lo]);
    };
    if (Array.isArray(o.material)) for (const p of g.groups) add(o.material[p.materialIndex], p.start, p.count);
    else add(o.material, start, end - start);
    const source = { object: o, geometry: g, material: o.material, materials: Array.isArray(o.material) ? [...o.material] : null,
      version: geometryVersion(g), entries: [], matrix: new THREE.Matrix4(), matrixValid: false,
      attributes: Object.entries(g.attributes).map(([key, a]) => [key, a, a.data?.version ?? a.version]), index: g.index, indexVersion: g.index?.version,
      ranges: g.groups.map(p => [p.start, p.count, p.materialIndex]),
      start: g.drawRange.start, count: g.drawRange.count, cast: o.castShadow, receive: o.receiveShadow, layers: o.layers.mask, order: o.renderOrder };
    const layout = geometryKey(g);
    for (const [material, parts] of ranges) {
      const whole = parts.length === 1 && parts[0][0] === 0 && parts[0][1] === size;
      const indexed = !!g.index || !whole;
      const semantic = semanticKey(material);
      const key = `${semantic == null ? 'material:' + id(material) : 'semantic:' + semantic}|${layout}|${indexed}|${o.castShadow}|${o.receiveShadow}|${o.layers.mask}|${o.renderOrder}`;
      source.entries.push({ source, material, semantic, parts, whole, indexed, key,
        viewKey: `${source.version}|${parts.map(p => p.join(',')).join(';')}`,
        indexCount: indexed ? parts.reduce((n, p) => n + p[1], 0) : 0, draws: parts.length });
    }
    return source;
  }
  function viewGeometry(entry) {
    const original = entry.source.geometry;
    if (entry.whole) return original;
    // Temporary view shares read-only attributes. BatchedMesh copies them; the
    // authored index/groups (including faceSlots and network IDs) never change.
    const view = new THREE.BufferGeometry();
    for (const [key, a] of Object.entries(original.attributes)) view.setAttribute(key, a);
    const indices = new (original.attributes.position.count > 65535 ? Uint32Array : Uint16Array)(entry.indexCount);
    let at = 0;
    for (const [from, count] of entry.parts) for (let i = from; i < from + count; i++)
      indices[at++] = original.index ? original.index.getX(i) : i;
    view.setIndex(new THREE.BufferAttribute(indices, 1)); return view;
  }
  function release(group) { group.dead = true; group.mesh.removeFromParent(); group.mesh.dispose(); if (group.ownedMaterial) group.mesh.material.dispose(); vertices -= group.vertices; }
  function compile(group) {
    if (group.pending || group.ready || !camera || group.requiresLighting && !group.mesh.material.userData.roomLightingPatched) return;
    group.pending = true;
    const material = group.mesh.material, version = material.version;
    // compile traverses hidden objects. Use the complete scene for its lights/GI.
    let promise;
    try { promise = warmRasterPrograms(renderer, group.mesh, camera, scene,
      { cancelled: () => disposed || group.dead || material.version !== version }); }
    catch { group.ready = false; group.pending = false; return; }
    Promise.resolve(promise).then(ready => {
      if (!disposed && !group.dead && material.version === version) group.ready = ready === true;
    }).catch(() => { if (!group.dead) group.ready = false; }).finally(() => { group.pending = false; });
  }
  function build(key, entries, signature) {
    const views = new Map(); let vertexCount = 0, indexCount = 0;
    for (const e of entries) if (!views.has(e.viewKey)) {
      views.set(e.viewKey, null); vertexCount += e.source.geometry.attributes.position.count; indexCount += e.indexCount;
    }
    if (vertices + vertexCount > MAX_VERTICES) return null;
    const first = entries[0], o = first.source.object;
    const useColor = first.semantic != null, requiresLighting = useColor && !!first.material.userData.roomLightingPatched;
    const material = useColor ? first.material.clone() : first.material;
    if (useColor) {
      material.color.setRGB(1, 1, 1);
      // Material.clone deliberately restores default hooks. Let lighting.patch
      // wrap the new material once on its next update, before compilation/use.
      delete material.userData.roomLightingPatched; delete material.userData.roomLightingBatchSafe;
    }
    const mesh = new THREE.BatchedMesh(entries.length, vertexCount, Math.max(1, indexCount), material);
    mesh.name = 'raster_batch'; mesh.visible = false; mesh.frustumCulled = false;
    mesh.castShadow = o.castShadow; mesh.receiveShadow = o.receiveShadow; mesh.layers.mask = o.layers.mask; mesh.renderOrder = o.renderOrder;
    Object.assign(mesh.userData, { networkEntity: true, rasterOnly: true, noPick: true, noNetwork: true }); mesh.raycast = () => {};
    const group = { mesh, signature, entries, vertices: vertexCount, ready: false, pending: false, dead: false,
      materialVersion: material.version, useColor, requiresLighting, ownedMaterial: useColor };
    try {
      for (const entry of entries) {
        let geometryId = views.get(entry.viewKey);
        if (geometryId == null) {
          const view = viewGeometry(entry); geometryId = mesh.addGeometry(view); views.set(entry.viewKey, geometryId);
          if (view !== entry.source.geometry) view.dispose();
        }
        entry.instance = mesh.addInstance(geometryId); entry.group = group;
        mesh.setMatrixAt(entry.instance, entry.source.object.matrixWorld);
        if (useColor) { mesh.setColorAt(entry.instance, entry.material.color); entry.lastColor = entry.material.color.clone(); }
      }
    } catch { mesh.dispose(); if (useColor) material.dispose(); return null; }
    root.add(mesh); vertices += vertexCount; rebuilds++; compile(group); return group;
  }
  function discover() {
    materialFrame++;
    if (!root.parent) scene.add(root);
    scene.updateMatrixWorld();
    const previous = new Map(sources.map(s => [s.object, s]));
    const next = [], candidates = new Map();
    function visit(o) {
      if (o === root || marked(o)) return;
      if (eligible(o)) {
        const s = describe(o), before = previous.get(o);
        if (before && before.geometry === s.geometry && before.version === s.version && before.material === s.material) {
          s.matrix.copy(before.matrix); s.matrixValid = before.matrixValid;
        }
        if (s.entries.length) next.push(s);
      }
      for (const child of o.children) visit(child);
    }
    visit(scene);
    for (const s of next) for (const e of s.entries) {
      if (!candidates.has(e.key)) candidates.set(e.key, []); candidates.get(e.key).push(e);
    }
    // A source is replaced completely, including any small material group, so a
    // multi-material wall can never be half-proxied and drawn twice.
    sources = next.filter(s => s.entries.some(e => candidates.get(e.key).length > 1 || e.draws > 1));
    const wanted = new Map();
    for (const s of sources) for (const e of s.entries) { if (!wanted.has(e.key)) wanted.set(e.key, []); wanted.get(e.key).push(e); }
    for (const [key, old] of groups) {
      const entries = wanted.get(key), signature = entries?.map(e => `${id(e.source.object)}:${e.viewKey}`).join('|');
      if (signature !== old.signature) { release(old); groups.delete(key); }
    }
    for (const [key, entries] of wanted) {
      let group = groups.get(key);
      if (!group) {
        group = build(key, entries, entries.map(e => `${id(e.source.object)}:${e.viewKey}`).join('|'));
        if (group) groups.set(key, group);
      } else {
        const before = group.entries;
        group.entries = entries;
        // Signature equality guarantees stable geometry/instance order.
        entries.forEach((e, i) => { e.group = group; e.instance = i; e.lastColor = before[i].lastColor; });
      }
    }
    lastScan = performance.now(); dirty = false;
  }
  function update(nextCamera) {
    if (disposed || !supported) return;
    if (nextCamera) camera = nextCamera;
    if (dirty || performance.now() - lastScan >= SCAN_MS) discover();
    for (const group of groups.values()) {
      if (group.materialVersion !== group.mesh.material.version) {
        group.materialVersion = group.mesh.material.version; group.ready = false; group.failed = false;
      }
      if (!group.failed) compile(group);
    }
  }
  function draw(fn) {
    if (disposed || !supported || depth || !sources.length) return fn();
    const hidden = [], shown = [], auto = scene.matrixWorldAutoUpdate;
    materialFrame++;
    if (auto) scene.updateMatrixWorld();
    depth++;
    try {
      for (const source of sources) {
        const o = source.object;
        let inScene = false, visible = true, excluded = false;
        for (let p = o; p; p = p.parent) {
          if (!p.visible) visible = false;
          if (marked(p)) excluded = true;
          if (p === scene) { inScene = true; break; }
        }
        const materialSame = o.material === source.material && (!source.materials || source.materials.every((m, i) => o.material[i] === m) && o.material.length === source.materials.length);
        const g = source.geometry, moved = !source.matrixValid || !source.matrix.equals(o.matrixWorld);
        const geometrySame = o.geometry === g && g.index === source.index && g.index?.version === source.indexVersion &&
          g.drawRange.start === source.start && g.drawRange.count === source.count &&
          Object.keys(g.attributes).length === source.attributes.length && g.groups.length === source.ranges.length &&
          source.ranges.every(([start, count, material], i) => g.groups[i].start === start && g.groups[i].count === count && g.groups[i].materialIndex === material) &&
          source.attributes.every(([key, a, version]) => g.attributes[key] === a && (a.data?.version ?? a.version) === version);
        const valid = inScene && !excluded && !o.children.length && o.frustumCulled !== false && materialSame && geometrySame && plainCallbacks(o) &&
          !o.customDepthMaterial && !o.customDistanceMaterial && !o.morphTargetInfluences?.length && !Object.keys(g.morphAttributes).length &&
          (source.materials ? source.materials.every(opaque) : opaque(o.material)) &&
          o.castShadow === source.cast && o.receiveShadow === source.receive && o.layers.mask === source.layers && o.renderOrder === source.order &&
          (!moved || safeMatrix(o.matrixWorld));
        if (!valid) dirty = true;
        const ready = valid && source.entries.every(e => e.group?.ready && !e.group.dead);
        const equivalent = source.entries.every(e => e.semantic == null || semanticKey(e.material) === e.semantic);
        if (!equivalent) dirty = true;
        const replace = ready && equivalent;
        for (const entry of source.entries) if (entry.group && !entry.group.dead) {
          const batch = entry.group.mesh; batch.setVisibleAt(entry.instance, replace && visible);
          if (moved) batch.setMatrixAt(entry.instance, o.matrixWorld);
          if (entry.group.useColor && !entry.lastColor.equals(entry.material.color)) {
            batch.setColorAt(entry.instance, entry.material.color); entry.lastColor.copy(entry.material.color);
          }
        }
        if (moved) { source.matrix.copy(o.matrixWorld); source.matrixValid = true; }
        if (replace) { hidden.push([o, o.visible]); o.visible = false; }
      }
      for (const group of groups.values()) if (group.ready) { shown.push(group.mesh); group.mesh.visible = true; }
      root.visible = true;
      // Matrices were updated immediately above; avoid walking the full authored
      // hierarchy a second time inside renderer.render (including nested mirrors).
      scene.matrixWorldAutoUpdate = false;
      return fn();
    } finally {
      scene.matrixWorldAutoUpdate = auto; root.visible = false;
      for (const mesh of shown) mesh.visible = false;
      for (const [o, visible] of hidden) o.visible = visible;
      depth--;
    }
  }
  return {
    update, draw,
    get stats() { return { supported, sources: sources.length, groups: groups.size, ready: [...groups.values()].filter(g => g.ready).length,
      vertices, maxVertices: MAX_VERTICES, rebuilds }; },
    dispose() { if (disposed) return; disposed = true; for (const group of groups.values()) release(group); groups.clear(); sources = []; root.removeFromParent(); },
  };
}
