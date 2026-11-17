// Poll scene references as before, but revisit lighting's idempotent patcher
// only when the unique material identities change. Property edits stay live.
export function createMaterialPatchPass(index, patch) {
  let patchedRevision = -1;
  return function patchMaterials(force = false) {
    const materials = index.materials(force), revision = index.materialsRevision;
    if (revision === patchedRevision) return false;
    for (const material of materials) patch(material);
    patchedRevision = revision;
    return true;
  };
}
