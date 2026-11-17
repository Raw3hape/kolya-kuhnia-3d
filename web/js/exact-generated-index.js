// Construction-time indexing for generated triangle soups only. Compare full
// Float32 bit tuples (including signed zero and NaN payloads), never positions
// alone. Triangle order and winding remain exactly the authored sequence.
export function indexExactGeneratedGeometry(THREE, geometry, { minSavingsBytes = 256, minSavingsRatio = .05 } = {}) {
  const position = geometry.attributes.position, count = position?.count;
  const entries = Object.entries(geometry.attributes);
  if (geometry.index || geometry.isInstancedBufferGeometry || geometry.groups.length || Object.keys(geometry.morphAttributes).length ||
    geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity || position?.itemSize !== 3 || !Number.isInteger(count) || !count || count % 3 ||
    entries.some(([,a]) => a.isInterleavedBufferAttribute || a.isInstancedBufferAttribute || !(a.array instanceof Float32Array) ||
      !Number.isInteger(a.itemSize) || a.itemSize < 1 || a.count !== count)) return geometry;
  const attributes = entries.map(([name, attribute]) => ({ name, attribute,
    bits: new Uint32Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.length) }));
  const words = attributes.reduce((n, item) => n + item.attribute.itemSize, 0), tuple = new Array(words);
  const indices = new Uint32Array(count), originals = [], unique = new Map();
  for (let vertex = 0; vertex < count; vertex++) {
    let at = 0;
    for (const { attribute, bits } of attributes) {
      const start = vertex * attribute.itemSize;
      for (let component = 0; component < attribute.itemSize; component++) tuple[at++] = bits[start + component];
    }
    const key = tuple.join(','), previous = unique.get(key);
    if (previous === undefined) { indices[vertex] = originals.length; unique.set(key, originals.length); originals.push(vertex); }
    else indices[vertex] = previous;
  }
  // Uint16 can address 65,536 unique vertices (last index 65,535).
  const indexBytes = originals.length <= 65536 ? 2 : 4;
  const beforeBytes = count * words * 4, afterBytes = originals.length * words * 4 + count * indexBytes, savings = beforeBytes - afterBytes;
  if (savings <= 0 || savings < minSavingsBytes || savings / beforeBytes < minSavingsRatio) return geometry;
  const result = new THREE.BufferGeometry(); result.name = geometry.name; result.userData = geometry.userData;
  for (const { name, attribute, bits } of attributes) {
    const values = new Float32Array(originals.length * attribute.itemSize), output = new Uint32Array(values.buffer);
    for (let vertex = 0; vertex < originals.length; vertex++) {
      const from = originals[vertex] * attribute.itemSize, to = vertex * attribute.itemSize;
      for (let component = 0; component < attribute.itemSize; component++) output[to + component] = bits[from + component];
    }
    const value = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
    value.name = attribute.name; value.gpuType = attribute.gpuType; value.setUsage(attribute.usage); result.setAttribute(name, value);
  }
  result.setIndex(new THREE.BufferAttribute(indexBytes === 2 ? new Uint16Array(indices) : indices, 1));
  result.boundingBox = geometry.boundingBox?.clone() || null; result.boundingSphere = geometry.boundingSphere?.clone() || null;
  return result;
}
