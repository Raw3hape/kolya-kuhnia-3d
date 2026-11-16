// Exact, per-mesh acceleration for the lifetime of an impacts scene. No global
// Three prototype patch. Shared leases avoid duplicate trees and let overlapping
// owners stop independently without undoing another owner's acceleration.
import { isTransient } from './network-objects.js';

const geometryLeases = new WeakMap(), meshLeases = new WeakMap();
let libraryPromise;
const loadDefaultLibrary = () => libraryPromise ??= import('three-mesh-bvh').catch(error => { libraryPromise = null; throw error; });
const version = attribute => attribute?.data?.version ?? attribute?.version;
function geometryStamp(g) {
  return { position: g.attributes.position, positionVersion: version(g.attributes.position), index: g.index, indexVersion: version(g.index),
    start: g.drawRange.start, count: g.drawRange.count, groups: g.groups.map(p => [p.start, p.count, p.materialIndex]) };
}
function unchanged(record, geometry) {
  const s = record.stamp;
  return !record.invalid && geometry.boundsTree === record.tree && geometry.attributes.position === s.position && version(s.position) === s.positionVersion &&
    geometry.index === s.index && version(s.index) === s.indexVersion && geometry.drawRange.start === s.start && geometry.drawRange.count === s.count &&
    geometry.groups.length === s.groups.length && s.groups.every(([start, count, material], i) => {
      const p = geometry.groups[i]; return p.start === start && p.count === count && p.materialIndex === material;
    });
}
function invalidateGeometry(record) {
  record.invalid = true;
  if (record.owned && record.geometry.boundsTree === record.tree) record.geometry.boundsTree = record.previous;
  for (const mesh of record.meshes) for (const owner of mesh.owners) owner.changed();
}
function releaseGeometry(record, mesh) {
  record.meshes.delete(mesh);
  if (record.meshes.size) return;
  if (record.owned && record.geometry.boundsTree === record.tree) record.geometry.boundsTree = record.previous;
  if (geometryLeases.get(record.geometry) === record) geometryLeases.delete(record.geometry);
}
// 0.7.8 indirect BVHs can include undrawn triangles for partial ranges or group
// gaps. Keep those uncommon meshes on the exact authored raycast path.
function fullRange(g) {
  const size = g.index?.count ?? g.attributes.position.count;
  if (g.drawRange.start !== 0 || g.drawRange.count < size) return false;
  let end = 0;
  for (const p of g.groups) { if (p.start !== end) return false; end += p.count; }
  return !g.groups.length || end === size;
}
function orthogonal(matrix) {
  const e = matrix.elements, x = e[0] ** 2 + e[1] ** 2 + e[2] ** 2, y = e[4] ** 2 + e[5] ** 2 + e[6] ** 2, z = e[8] ** 2 + e[9] ** 2 + e[10] ** 2;
  return x > 0 && y > 0 && z > 0 && Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]) <= 1e-6 * Math.sqrt(x * y) &&
    Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]) <= 1e-6 * Math.sqrt(x * z) &&
    Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]) <= 1e-6 * Math.sqrt(y * z);
}

export function createNetworkRaycastAcceleration({ THREE, scene, loadLibrary = loadDefaultLibrary,
  scheduleIdle = callback => typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, { timeout: 500 }) : setTimeout(callback, 16),
  cancelIdle = id => typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id) }) {
  const meshes = new Map(), queued = new Set();
  let active = false, disposed = false, library = null, loading = null, handle = null, scanAt = -Infinity, retryAt = 0, dirty = false, queue = [];
  const owner = { changed() { dirty = true; } };
  const inScene = o => { for (let x = o; x; x = x.parent) if (x === scene) return true; return false; };
  function eligible(o) {
    const g = o.geometry, shared = meshLeases.get(o), position = g?.attributes?.position;
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || !position || g.morphAttributes?.position?.length ||
      o.raycast !== THREE.Mesh.prototype.raycast && o.raycast !== shared?.wrapper ||
      (position.data?.usage ?? position.usage) === THREE.DynamicDrawUsage || (position.data?.usage ?? position.usage) === THREE.StreamDrawUsage || !fullRange(g)) return false;
    for (let x = o; x && x !== scene; x = x.parent) if (isTransient(x)) return false;
    return (g.index?.count ?? position.count) >= 192;
  }
  function geometryRecord(geometry) {
    let record = geometryLeases.get(geometry);
    if (record && unchanged(record, geometry)) return record;
    if (record) {
      invalidateGeometry(record);
      // An externally owned stale tree belongs to its owner. Never replace it.
      if (!record.owned && geometry.boundsTree === record.tree) return null;
    }
    const previous = geometry.boundsTree, tree = previous || new library.MeshBVH(geometry, { indirect: true, maxLeafTris: 12, verbose: false });
    if (!previous) geometry.boundsTree = tree;
    record = { geometry, tree, previous, owned: !previous, stamp: geometryStamp(geometry), meshes: new Set(), invalid: false, library };
    geometryLeases.set(geometry, record); return record;
  }
  function acquire(mesh) {
    const record = geometryRecord(mesh.geometry); if (!record) return;
    let shared = meshLeases.get(mesh);
    if (!shared || mesh.raycast !== shared.wrapper) {
      shared = { original: mesh.raycast, record, owners: new Set(), mesh };
      shared.wrapper = function (raycaster, hits) {
        const current = shared.record;
        if (this.geometry !== current.geometry) {
          for (const owner of shared.owners) owner.changed();
          return shared.original.call(this, raycaster, hits);
        }
        if (!unchanged(current, this.geometry)) {
          invalidateGeometry(current); return shared.original.call(this, raycaster, hits);
        }
        // 0.7.8 converts near/far using per-axis world scales, which assumes
        // orthogonal basis columns. Sheared parents keep the authored query.
        if (!orthogonal(this.matrixWorld)) return shared.original.call(this, raycaster, hits);
        return current.library.acceleratedRaycast.call(this, raycaster, hits);
      };
      meshLeases.set(mesh, shared); mesh.raycast = shared.wrapper; record.meshes.add(shared);
    } else if (shared.record !== record) {
      releaseGeometry(shared.record, shared); shared.record = record; record.meshes.add(shared);
    }
    shared.owners.add(owner); meshes.set(mesh, shared);
  }
  function release(mesh, shared) {
    meshes.delete(mesh); shared.owners.delete(owner);
    if (shared.owners.size) return;
    if (mesh.raycast === shared.wrapper) mesh.raycast = shared.original;
    if (meshLeases.get(mesh) === shared) meshLeases.delete(mesh);
    releaseGeometry(shared.record, shared);
  }
  function schedule() {
    if (!active || !library || !queue.length || handle != null) return;
    handle = scheduleIdle(() => {
      handle = null; if (!active || disposed) return;
      const started = performance.now();
      do {
        const mesh = queue.shift(); queued.delete(mesh);
        if (!mesh || !inScene(mesh) || !eligible(mesh)) continue;
        try { acquire(mesh); } catch { /* Unsupported assets retain the exact standard path. */ }
      } while (queue.length && performance.now() - started < 5);
      schedule();
    });
  }
  function scan() {
    if (!active || !library || disposed) return;
    dirty = false; scanAt = performance.now();
    for (const [mesh, shared] of meshes) if (!inScene(mesh) || !eligible(mesh)) release(mesh, shared);
    function visit(o) {
      if (o !== scene && isTransient(o)) return;
      if (eligible(o)) {
        const shared = meshes.get(o);
        if ((!shared || shared.record.geometry !== o.geometry || !unchanged(shared.record, o.geometry)) && !queued.has(o)) { queued.add(o); queue.push(o); }
      }
      for (const child of o.children) visit(child);
    }
    visit(scene);
    schedule();
  }
  function ensureLibrary() {
    if (library) { scan(); return Promise.resolve(true); }
    if (loading) return loading;
    loading = Promise.resolve().then(loadLibrary).then(value => { library = value; if (active && !disposed) scan(); return true; })
      .catch(() => { retryAt = performance.now() + 5000; return false; }).finally(() => { loading = null; });
    return loading;
  }
  function start() { if (disposed) return Promise.resolve(false); if (active) return loading || Promise.resolve(!!library); active = true; return ensureLibrary(); }
  function stop() {
    active = false;
    if (handle != null) cancelIdle(handle);
    handle = null; queue = []; queued.clear();
    for (const [mesh, shared] of meshes) release(mesh, shared);
  }
  return { start, stop, dispose() { if (disposed) return; disposed = true; stop(); },
    update() { if (!active || disposed) return; const now = performance.now();
      if (!library) { if (!loading && now >= retryAt) ensureLibrary(); }
      else if (dirty || now - scanAt > 1000) scan(); },
    get status() { return { active, accelerated: meshes.size, geometries: new Set([...meshes.values()].map(mesh => mesh.record)).size, pending: queue.length }; } };
}
