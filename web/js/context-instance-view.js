// Scoped camera-specific views of explicitly static, non-shadow-casting site
// instances. Authored buffers remain canonical for gameplay, export and probes.
import { acquireSceneIndex } from './scene-index.js';

const registrations = new WeakMap();
// Trusted site-factory contract: instance matrices come from Matrix4.compose
// (affine, orthogonal local axes). Arbitrary instance matrices are not opt-ins;
// sheared ancestors are covered by the conservative world-space bound below.
export function markContextInstances(mesh) {
  if (!mesh.castShadow) {
    mesh.userData.rasterCullInstances = true;
    registrations.set(mesh, Array.isArray(mesh.material) ? mesh.material.slice() : [mesh.material]);
  }
  return mesh;
}

export function createContextInstanceView({ THREE, scene, maxCameras = 3 }) {
  const cameraLimit = Math.max(1, Math.min(3, Math.floor(Number(maxCameras) || 3)));
  const index = acquireSceneIndex(scene), states = new Map(), cameras = new Map(), canonical = new Map();
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), matrix = new THREE.Matrix4(), world = new THREE.Matrix4(), point = new THREE.Vector3();
  let revision = -1, candidates = [], disposed = false, depth = 0, selections = 0, builds = 0;
  let liveCandidates = new Set(), prunePending = false;
  const materialsOf = object => Array.isArray(object.material) ? object.material : [object.material];
  function attributes(snapshot) {
    if (!Number.isInteger(snapshot.count) || snapshot.count < 0) return null;
    if (snapshot.instanceMatrix.itemSize !== 16 || snapshot.instanceMatrix.normalized || !(snapshot.instanceMatrix.array instanceof Float32Array)) return null;
    const result = [['instanceMatrix', snapshot.instanceMatrix]];
    if (snapshot.instanceColor) result.push(['instanceColor', snapshot.instanceColor]);
    for (const [key, value] of Object.entries(snapshot.geometry.attributes)) {
      if (value.isInterleavedBufferAttribute && value.data?.isInstancedInterleavedBuffer) return null;
      if (value.isInstancedBufferAttribute) result.push([key, value]);
    }
    for (const [, a] of result) if (!a?.isInstancedBufferAttribute || a.meshPerAttribute !== 1 || a.isInterleavedBufferAttribute || a.count < snapshot.count) return null;
    return result;
  }
  function eligible(object, snapshot, state) {
    if (!object.isInstancedMesh || object.castShadow || object.morphTexture || !object.userData.rasterCullInstances || !snapshot.geometry?.attributes.position) return false;
    const materials = materialsOf(object), registered = registrations.get(object);
    if (Object.values(snapshot.geometry.morphAttributes).some(values => values.length) || materials.some(m => !m || m.isShaderMaterial || m.isRawShaderMaterial || m.displacementMap || m.onBeforeRender !== THREE.Material.prototype.onBeforeRender)) return false;
    if (state?.shaders) return state.shaders.length === materials.length && state.shaders.every((s, i) => s.material === materials[i] && s.hook === materials[i].onBeforeCompile && s.key === materials[i].customProgramCacheKey);
    return materials.every((m, i) => registered?.[i] === m || m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey || m.userData?.roomLightingBatchSafe === true);
  }
  function stamp(a) { return [a, a.data, a.array, a.data?.version ?? a.version, a.itemSize, a.normalized, a.gpuType, a.count, a.offset, a.data?.stride]; }
  function matches(a, s, version = true) { return !!a && a === s[0] && a.data === s[1] && a.array === s[2] && (!version || (a.data?.version ?? a.version) === s[3]) && a.itemSize === s[4] && a.normalized === s[5] && a.gpuType === s[6] && a.count === s[7] && a.offset === s[8] && a.data?.stride === s[9]; }
  function signature(snapshot, attrs) {
    return { geometry: snapshot.geometry, count: snapshot.count, matrix: snapshot.object.matrixWorld.clone(),
      attributes: Object.entries(snapshot.geometry.attributes).map(([key, a]) => [key, stamp(a)]),
      instance: attrs.map(([key, a]) => [key, stamp(a)]), index: snapshot.geometry.index && stamp(snapshot.geometry.index),
      groups: snapshot.geometry.groups.map(group => [group.start, group.count, group.materialIndex]), start: snapshot.geometry.drawRange.start, end: snapshot.geometry.drawRange.count };
  }
  function current(s, snapshot, attrs) {
    const g = snapshot.geometry;
    if (!s || s.geometry !== g || s.count !== snapshot.count || !s.matrix.equals(snapshot.object.matrixWorld) || s.start !== g.drawRange.start || s.end !== g.drawRange.count || s.groups.length !== g.groups.length ||
      s.attributes.length !== Object.keys(g.attributes).length || s.instance.length !== attrs.length || !!s.index !== !!g.index || g.index && !matches(g.index, s.index)) return false;
    for (const [key, value] of s.attributes) if (!matches(g.attributes[key], value)) return false;
    for (let i = 0; i < attrs.length; i++) if (attrs[i][0] !== s.instance[i][0] || !matches(attrs[i][1], s.instance[i][1])) return false;
    for (let i = 0; i < s.groups.length; i++) if (g.groups[i].start !== s.groups[i][0] || g.groups[i].count !== s.groups[i][1] || g.groups[i].materialIndex !== s.groups[i][2]) return false;
    return true;
  }
  function dropViews(state) { for (const view of state.views.values()) view.geometry.dispose(); state.views.clear(); }
  function sameViewLayout(s, snapshot, attrs) {
    const g = snapshot.geometry;
    if (!s || s.geometry !== g || s.start !== g.drawRange.start || s.end !== g.drawRange.count || s.groups.length !== g.groups.length ||
      s.attributes.length !== Object.keys(g.attributes).length || s.instance.length !== attrs.length || !!s.index !== !!g.index || g.index && !matches(g.index, s.index)) return false;
    for (const [key, value] of s.attributes) if (!matches(g.attributes[key], value, !g.attributes[key]?.isInstancedBufferAttribute)) return false;
    for (let i = 0; i < attrs.length; i++) if (attrs[i][0] !== s.instance[i][0] || !matches(attrs[i][1], s.instance[i][1], false)) return false;
    return s.groups.every((group,i) => group[0] === g.groups[i].start && group[1] === g.groups[i].count && group[2] === g.groups[i].materialIndex);
  }
  function prepare(snapshot, attrs, state) {
    if (!state) {
      state = { views: new Map(), shaders: materialsOf(snapshot.object).map(material => ({ material, hook: material.onBeforeCompile, key: material.customProgramCacheKey })) };
      states.set(snapshot.object, state);
    }
    if (current(state.signature, snapshot, attrs)) return state;
    const previous = state.signature, positionBefore = previous?.attributes.find(([key]) => key === 'position')?.[1], matrixBefore = previous?.instance.find(([key]) => key === 'instanceMatrix')?.[1];
    const sameBounds = previous && previous.count === snapshot.count && previous.matrix.equals(snapshot.object.matrixWorld) &&
      matches(snapshot.geometry.attributes.position, positionBefore) && matches(snapshot.instanceMatrix, matrixBefore);
    if (!sameViewLayout(previous, snapshot, attrs)) dropViews(state);
    state.signature = signature(snapshot, attrs); state.attrs = attrs; state.epoch = (state.epoch || 0) + 1;
    if (sameBounds) return state;
    const position = snapshot.geometry.attributes.position, box = new THREE.Box3(); box.makeEmpty();
    for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i));
    const center = box.getCenter(new THREE.Vector3()); let radius = 0;
    for (let i = 0; i < position.count; i++) radius = Math.max(radius, center.distanceToSquared(point.fromBufferAttribute(position, i)));
    const sphere = new THREE.Sphere(center, Math.sqrt(radius));
    state.spheres = new Float64Array(snapshot.count * 4);
    state.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
    for (let i = 0; i < snapshot.count; i++) {
      matrix.fromArray(snapshot.instanceMatrix.array, i * 16); world.multiplyMatrices(snapshot.object.matrixWorld, matrix);
      state.boundingSphere.union(sphere.clone().applyMatrix4(matrix));
      const transformed = sphere.clone().applyMatrix4(world), at = i * 4;
      // Sphere.applyMatrix4's max-column scale is exact for site's orthogonal
      // transforms; a sheared ancestor needs a conservative operator-norm bound.
      const e = world.elements, dot = (a,b) => e[a]*e[b]+e[a+1]*e[b+1]+e[a+2]*e[b+2];
      if (Math.abs(dot(0,4))+Math.abs(dot(0,8))+Math.abs(dot(4,8)) > 1e-8)
        transformed.radius = sphere.radius * Math.sqrt(dot(0,0)+dot(4,4)+dot(8,8));
      transformed.center.toArray(state.spheres, at); state.spheres[at + 3] = transformed.radius;
    }
    builds++; return state;
  }
  function attributeView(a, interleaved) {
    let value;
    if (a.isInterleavedBufferAttribute) {
      let data = interleaved.get(a.data);
      if (!data) { data = new THREE.InterleavedBuffer(a.data.array, a.data.stride); data.setUsage(a.data.usage); interleaved.set(a.data, data); }
      value = new THREE.InterleavedBufferAttribute(data, a.itemSize, a.offset, a.normalized);
    } else { value = new THREE.BufferAttribute(a.array, a.itemSize, a.normalized); value.setUsage(a.usage); }
    value.name = a.name; if (a.gpuType !== undefined) value.gpuType = a.gpuType; return value;
  }
  function createView(snapshot, state) {
    const geometry = new THREE.BufferGeometry(), packed = new Map(), interleaved = new Map(), streams = [];
    for (const [key, a] of Object.entries(snapshot.geometry.attributes)) if (!a.isInstancedBufferAttribute) geometry.setAttribute(key, attributeView(a, interleaved));
    if (snapshot.geometry.index) geometry.setIndex(attributeView(snapshot.geometry.index, interleaved));
    geometry.groups = snapshot.geometry.groups.map(group => ({ ...group })); geometry.setDrawRange(snapshot.geometry.drawRange.start, snapshot.geometry.drawRange.count);
    for (const [key, a] of state.attrs) {
      const value = new THREE.InstancedBufferAttribute(new a.array.constructor(a.array.length), a.itemSize, a.normalized, 1); value.setUsage(THREE.DynamicDrawUsage); value.gpuType = a.gpuType;
      packed.set(key, value); geometry.setAttribute(key, value);
      streams.push({ source: a.array, target: value.array, size: a.itemSize });
    }
    // Matrix/color are object-level inputs, but also registered on this owned
    // geometry so its dispose event releases their GPU buffers safely.
    const buffers = new Set(); let gpuBytes = 0, packedBytes = 0;
    for (const a of [...Object.values(geometry.attributes), geometry.index].filter(Boolean)) {
      const buffer = a.isInterleavedBufferAttribute ? a.data : a;
      if (!buffers.has(buffer)) { buffers.add(buffer); gpuBytes += buffer.array.byteLength; }
    }
    for (const value of packed.values()) packedBytes += value.array.byteLength;
    return { geometry, packed, streams, gpuBytes, packedBytes, world: new THREE.Matrix4(), projection: new THREE.Matrix4(), epoch: -1, count: 0 };
  }
  function select(camera, snapshot, state) {
    let view = state.views.get(camera);
    if (!view) { view = createView(snapshot, state); state.views.set(camera, view); }
    if (view.epoch === state.epoch && view.world.equals(camera.matrixWorld) && view.projection.equals(camera.projectionMatrix)) return view;
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(projection, camera.coordinateSystem ?? THREE.WebGLCoordinateSystem);
    const spheres = state.spheres, planes = frustum.planes; let count = 0;
    for (let i = 0; i < snapshot.count; i++) {
      const at = i * 4, x = spheres[at], y = spheres[at + 1], z = spheres[at + 2], radius = spheres[at + 3];
      let visible = true;
      for (let p = 0; p < 6; p++) { const plane = planes[p]; if (plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.constant < -radius) { visible = false; break; } }
      if (!visible) continue;
      for (let a = 0; a < view.streams.length; a++) {
        const stream = view.streams[a], from = i * stream.size, to = count * stream.size;
        for (let component = 0; component < stream.size; component++) stream.target[to + component] = stream.source[from + component];
      }
      count++;
    }
    for (const value of view.packed.values()) {
      value.clearUpdateRanges(); if (count) { value.addUpdateRange(0, count * value.itemSize); value.needsUpdate = true; }
    }
    view.count = count; view.world.copy(camera.matrixWorld); view.projection.copy(camera.projectionMatrix); view.epoch = state.epoch; selections++;
    return view;
  }
  function prune() {
    prunePending = false;
    for (const [object, state] of states) if (!liveCandidates.has(object)) {
      if (canonical.has(object)) { prunePending = true; continue; }
      dropViews(state); states.delete(object);
    }
  }
  function refresh() {
    if (revision === index.revision) return;
    revision = index.revision; candidates = [...index.materialObjects].filter(object => object.isInstancedMesh && object.userData.rasterCullInstances);
    liveCandidates = new Set(candidates); prune();
  }
  function trim() {
    while (cameras.size > cameraLimit) {
      const camera = cameras.keys().next().value; cameras.delete(camera);
      for (const state of states.values()) { const view = state.views.get(camera); if (view) { view.geometry.dispose(); state.views.delete(camera); } }
    }
  }
  function draw(camera, fn) {
    if (disposed) return fn();
    refresh(); if (camera.matrixWorldAutoUpdate !== false) camera.updateMatrixWorld();
    cameras.delete(camera); cameras.set(camera, true);
    const saved = [], ownedCanonical = []; depth++;
    try {
      for (const object of candidates) {
        let snapshot = canonical.get(object);
        if (!snapshot) { snapshot = { object, geometry: object.geometry, instanceMatrix: object.instanceMatrix, instanceColor: object.instanceColor, count: object.count, visible: object.visible }; }
        if (!snapshot.visible) continue;
        let shown = true;
        for (let ancestor = object.parent; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) { shown = false; break; }
        if (!shown) continue;
        const known = states.get(object), attrs = attributes(snapshot);
        if (!attrs || !eligible(object, snapshot, known)) continue;
        if (!canonical.has(object)) { canonical.set(object, snapshot); ownedCanonical.push(object); }
        const state = prepare(snapshot, attrs, known), view = select(camera, snapshot, state);
        saved.push({ object, geometry: object.geometry, instanceMatrix: object.instanceMatrix, instanceColor: object.instanceColor, count: object.count, visible: object.visible, boundingSphere: object.boundingSphere });
        object.geometry = view.geometry; object.instanceMatrix = view.packed.get('instanceMatrix'); object.instanceColor = view.packed.get('instanceColor') || null; object.count = view.count;
        object.boundingSphere = state.boundingSphere;
        object.visible = snapshot.visible && view.count > 0;
      }
      return fn();
    } finally {
      for (let i = saved.length - 1; i >= 0; i--) { const state = saved[i]; Object.assign(state.object, { geometry: state.geometry, instanceMatrix: state.instanceMatrix, instanceColor: state.instanceColor, count: state.count, visible: state.visible, boundingSphere: state.boundingSphere }); }
      for (const object of ownedCanonical) canonical.delete(object);
      depth--;
      if (!depth) {
        // A nested draw may already have observed a removal while the outer
        // view was still live on the GPU. Release it after canonical restore,
        // without waiting for another scene revision or a future render.
        refresh(); if (prunePending) prune(); trim();
      }
    }
  }
  return { draw,
    get stats() { let gpuBytesUpperBound = 0, packedBytes = 0; for (const state of states.values()) for (const view of state.views.values()) { gpuBytesUpperBound += view.gpuBytes; packedBytes += view.packedBytes; }
      return { sources: states.size, cameras: cameras.size, selections, builds, gpuBytesUpperBound, packedBytes }; },
    dispose() { if (disposed) return; disposed = true; for (const state of states.values()) dropViews(state); states.clear(); cameras.clear(); candidates = []; liveCandidates.clear(); prunePending = false; index.release(); },
  };
}
