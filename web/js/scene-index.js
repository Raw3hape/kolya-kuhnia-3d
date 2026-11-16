// Shared structural index for rendering/lighting. Only local Object3D listeners,
// no prototype patches or changes to authored objects/materials. Temporary raster
// material swaps are over before the next refresh, so gameplay stays authoritative.
const indices = new WeakMap();

function makeIndex(scene) {
  const nodes = new Set(), materialObjects = new Set(), lightObjects = new Set();
  const materialRefs = new WeakMap(), materials = new Set();
  let revision = 0, orderedRevision = -1, orderedLights = [], orderedShadows = [], refreshRevision = -1, fresh = false;
  const expire = () => { fresh = false; };
  function addTree(object) {
    if (nodes.has(object)) return;
    nodes.add(object);
    if (object.isMesh || object.isPoints || object.isLine || object.isSprite || object.material) materialObjects.add(object);
    if (object.isLight) lightObjects.add(object);
    object.addEventListener('childadded', added); object.addEventListener('childremoved', removed);
    for (const child of object.children) addTree(child);
    revision++; fresh = false;
  }
  function removeTree(object) {
    if (!nodes.delete(object)) return;
    object.removeEventListener('childadded', added); object.removeEventListener('childremoved', removed);
    materialObjects.delete(object); lightObjects.delete(object); materialRefs.delete(object);
    for (const child of object.children) removeTree(child);
    revision++; fresh = false;
  }
  const added = event => addTree(event.child), removed = event => removeTree(event.child);
  addTree(scene);
  function refreshMaterials(force = false) {
    if (fresh && !force) return materials;
    let changed = refreshRevision !== revision;
    for (const object of materialObjects) {
      const value = object.material;
      let previous = materialRefs.get(object);
      if (!previous || previous.value !== value) {
        previous = { value, items: Array.isArray(value) ? value.slice() : null }; materialRefs.set(object, previous); changed = true;
      } else if (previous.items) {
        let same = previous.items.length === value.length;
        if (same) for (let i = 0; i < value.length; i++) if (previous.items[i] !== value[i]) { same = false; break; }
        if (!same) { previous.items = value.slice(); changed = true; }
      }
    }
    if (changed) {
      materials.clear();
      for (const object of materialObjects) {
        const value = object.material;
        if (Array.isArray(value)) { for (const material of value) if (material) materials.add(material); }
        else if (value) materials.add(value);
      }
      refreshRevision = revision;
    }
    if (!fresh) { fresh = true; queueMicrotask(expire); }
    return materials;
  }
  function order() {
    // The shader's indices must follow Three's depth-first order, including when
    // an existing light is reparented or a nested subtree arrives asynchronously.
    if (orderedRevision !== revision) {
      orderedLights = [];
      orderedShadows = [];
      const visit = object => {
        if (lightObjects.has(object)) orderedLights.push(object);
        if (object.isMesh || object.isLight) orderedShadows.push(object);
        for (const child of object.children) visit(child);
      };
      visit(scene); orderedRevision = revision;
    }
  }
  const lights = () => { order(); return orderedLights; };
  const shadowObjects = () => { order(); return orderedShadows; };
  function visible(object) {
    for (let node = object; node; node = node.parent) { if (!node.visible) return false; if (node === scene) return true; }
    return false;
  }
  return { refs: 0, materialObjects, materials: refreshMaterials, lights, shadowObjects, visible,
    get revision() { return revision; },
    dispose() { removeTree(scene); materialObjects.clear(); lightObjects.clear(); materials.clear(); orderedLights = []; orderedShadows = []; } };
}

export function acquireSceneIndex(scene) {
  let index = indices.get(scene);
  if (!index) { index = makeIndex(scene); indices.set(scene, index); }
  index.refs++; let released = false;
  return { materialObjects: index.materialObjects, materials: index.materials, lights: index.lights, shadowObjects: index.shadowObjects, visible: index.visible,
    get revision() { return index.revision; },
    release() { if (released) return; released = true; if (--index.refs === 0) { index.dispose(); indices.delete(scene); } } };
}
