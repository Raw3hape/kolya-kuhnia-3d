// The complete authored state consumed by the flat eco representation. Shared
// by per-object substitutes and direct Lambert GPU batches so their pixels agree.
export const ECO_MAPS = ['map', 'alphaMap', 'emissiveMap', 'aoMap', 'lightMap'];
export const ECO_VALUES = ['vertexColors', 'side', 'shadowSide', 'opacity', 'alphaTest', 'alphaHash', 'alphaToCoverage',
  'depthWrite', 'depthTest', 'depthFunc', 'colorWrite', 'blending', 'blendSrc', 'blendDst', 'blendEquation',
  'blendSrcAlpha', 'blendDstAlpha', 'blendEquationAlpha', 'blendAlpha', 'premultipliedAlpha',
  'stencilWrite', 'stencilWriteMask', 'stencilFunc', 'stencilRef', 'stencilFuncMask', 'stencilFail', 'stencilZFail', 'stencilZPass',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'fog', 'dithering', 'toneMapped', 'precision',
  'clippingPlanes', 'clipIntersection', 'clipShadows', 'visible', 'wireframe', 'wireframeLinewidth', 'flatShading',
  'forceSinglePass', 'aoMapIntensity', 'lightMapIntensity', 'emissiveIntensity'];
export const ECO_DEFINES = ['vertexColors', 'side', 'shadowSide', 'alphaHash', 'alphaToCoverage', 'premultipliedAlpha',
  'fog', 'dithering', 'toneMapped', 'precision', 'clipIntersection', 'clipShadows', 'wireframe', 'flatShading'];
// Diffuse color is supplied independently for each batched instance.
export const ECO_BATCH_KEYS = [...ECO_MAPS, ...ECO_VALUES, 'emissive', 'blendColor'];

export function ecoMaterialEligible(THREE, material) {
  return !!(material?.isMeshStandardMaterial && !material.userData?.ecoMaterial && material.userData?.roomLightingBatchSafe &&
    material.userData?.roomLightingPatched && !material.transparent && !(material.transmission > 0) && !(material.opacity < 1) &&
    material.onBeforeRender === THREE.Material.prototype.onBeforeRender);
}

export function createEcoMaterial(THREE, original, white = false) {
  const flat = new THREE.MeshLambertMaterial();
  flat.name = `${original.name || 'material'}:eco`;
  flat.userData = { ecoMaterial: true, roomLightingPatched: true, roomLightingBatchSafe: false };
  if (!white) flat.color.copy(original.color);
  flat.emissive.copy(original.emissive); flat.blendColor.copy(original.blendColor);
  for (const key of ECO_MAPS) flat[key] = original[key];
  for (const key of ECO_VALUES) flat[key] = original[key];
  flat.onBeforeCompile = original.onBeforeCompile;
  flat.customProgramCacheKey = original.customProgramCacheKey;
  return flat;
}
