// HP sight traces only solid world geometry. Sprites require a camera-aware
// raycast and skeletal/transient actors are not architectural occluders.
export function collectFieldOccluders(scene, eventRoot, output = []) {
  output.length = 0;
  // Prune whole actor/hidden subtrees instead of walking every skeleton and
  // climbing its ancestors again for every mesh.
  function visit(o) {
    const data = o.userData;
    if (!o.visible || o === eventRoot || data?.networkAvatar || data?.networkEntity || data?.networkEffect || data?.viewmodel) return;
    if (o.isMesh && !o.isSkinnedMesh && !data?.glass && !data?.passLight && !data?.shadowOnly && !data?.impact) output.push(o);
    for (const child of o.children) visit(child);
  }
  visit(scene);
  return output;
}

// Visibility asks whether any solid surface blocks the ray, not for all sorted
// intersections with every furnished room. Stop once a real blocker is found.
export function fieldRayBlocked(raycaster, objects, hits = []) {
  for (const object of objects) {
    hits.length = 0;
    raycaster.intersectObject(object, false, hits);
    for (const hit of hits) {
      const o = hit.object, material = Array.isArray(o.material) ? o.material[hit.face?.materialIndex || 0] : o.material;
      if (material && material.visible !== false && material.colorWrite !== false && !(material.transparent && material.opacity < 0.1)) return true;
    }
  }
  return false;
}
