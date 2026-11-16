// Per-instance acceleration for the host's exact world raycasts. No global Three
// prototype changes. Every idle callback, override and created tree is owned here.
import { isTransient } from './network-objects.js';

export function createNetworkRaycastAcceleration({ THREE, scene }) {
  const overrides = new Map(), trees = new Map();
  let active = false, library = null, loading = null, handle = null, scanAt = 0;
  let queue = [], queued = new WeakSet();
  const idle = callback => typeof requestIdleCallback === 'function' ? requestIdleCallback(callback, { timeout: 500 }) : setTimeout(callback, 16);
  const cancel = id => typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id);
  const inScene = o => { for (let x = o; x; x = x.parent) if (x === scene) return true; return false; };
  const eligible = o => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.geometry?.attributes?.position ||
      o.geometry.morphAttributes?.position?.length || o.raycast !== THREE.Mesh.prototype.raycast && !overrides.has(o)) return false;
    for (let x = o; x && x !== scene; x = x.parent) if (isTransient(x)) return false;
    return (o.geometry.index?.count ?? o.geometry.attributes.position.count) >= 192;
  };

  function schedule() {
    if (!active || !library || !queue.length || handle != null) return;
    handle = idle(() => {
      handle = null;
      if (!active) return;
      const started = performance.now();
      do {
        const mesh = queue.shift();
        if (!mesh) break;
        if (!inScene(mesh)) continue;
        const geometry = mesh.geometry;
        try {
          if (!geometry.boundsTree) {
            geometry.boundsTree = new library.MeshBVH(geometry, { indirect: true, maxLeafTris: 12, verbose: false });
            trees.set(geometry, geometry.boundsTree);
          }
          if (!overrides.has(mesh)) { overrides.set(mesh, mesh.raycast); mesh.raycast = library.acceleratedRaycast; }
        } catch { /* unsupported geometry retains its exact standard raycast */ }
      } while (queue.length && performance.now() - started < 5);
      schedule();
    });
  }

  function scan() {
    if (!active || !library) return;
    for (const [mesh, original] of overrides) if (!inScene(mesh)) { mesh.raycast = original; overrides.delete(mesh); }
    const used = new Set();
    scene.traverse(o => {
      if (!eligible(o)) return;
      used.add(o.geometry);
      if (!queued.has(o)) { queued.add(o); queue.push(o); }
    });
    for (const [geometry, tree] of trees) if (!used.has(geometry)) {
      if (geometry.boundsTree === tree) geometry.boundsTree = null;
      trees.delete(geometry);
    }
    schedule();
  }

  function start() {
    active = true;
    loading ??= import('three-mesh-bvh').then(value => { library = value; if (active) scan(); }).catch(() => {});
    if (library) scan();
  }
  function stop() {
    active = false;
    if (handle != null) cancel(handle);
    handle = null; queue = []; queued = new WeakSet();
    for (const [mesh, original] of overrides) mesh.raycast = original;
    overrides.clear();
    for (const [geometry, tree] of trees) if (geometry.boundsTree === tree) geometry.boundsTree = null;
    trees.clear();
  }
  return { start, stop, dispose: stop,
    update() { if (active && performance.now() - scanAt > 1000) { scanAt = performance.now(); scan(); } },
    get status() { return { active, accelerated: overrides.size, geometries: trees.size, pending: queue.length }; } };
}
