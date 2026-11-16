// The same room-aware bilinear SH interpolation as lighting.js, packed for GPU
// linear filtering: one sample per coefficient instead of four plus zone tests.
// RGB holds accepted SH values, alpha their interpolation weight. Normalizing
// by alpha prevents any light leaking through a rejected room boundary.
export function packFilteredSHGrid(source, output, width, height, accepts) {
  const plane = width * (height + 1) * 4;
  for (let zone = 0; zone < accepts.length; zone++) {
    const accept = accepts[zone];
    for (let cell = 0; cell < width * height; cell++) {
      const base = cell * 40, valid = (accept >> source[base]) & 1;
      for (let coefficient = 0; coefficient < 9; coefficient++) {
        const src = base + (coefficient + 1) * 4, dst = (zone * 9 + coefficient) * plane + cell * 4;
        output[dst] = valid ? source[src] : 0;
        output[dst + 1] = valid ? source[src + 1] : 0;
        output[dst + 2] = valid ? source[src + 2] : 0;
        output[dst + 3] = valid;
      }
    }
    // One final row keeps this zone's mean SH in the same array sampler.
    // Display sampling clamps to the regular rows to exclude this fallback.
    for (let coefficient = 0; coefficient < 9; coefficient++) {
      const src = (height + zone) * width * 40 + (coefficient + 1) * 4;
      const row = (zone * 9 + coefficient) * plane + height * width * 4;
      for (let x = 0; x < width; x++) {
        const dst = row + x * 4;
        output[dst] = source[src]; output[dst + 1] = source[src + 1]; output[dst + 2] = source[src + 2]; output[dst + 3] = 1;
      }
    }
  }
  return output;
}

export function createFilteredSHGrid({ THREE, width, height, accepts }) {
  const data = new Float32Array(width * (height + 1) * accepts.length * 9 * 4);
  // Half-float linear filtering is core WebGL2, including phones without the
  // optional OES_texture_float_linear extension for full-float textures.
  const upload = new Uint16Array(data.length);
  const texture = new THREE.DataArrayTexture(upload, width, height + 1, accepts.length * 9);
  texture.type = THREE.HalfFloatType;
  texture.internalFormat = 'RGBA16F';
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, update(source) {
    packFilteredSHGrid(source, data, width, height, accepts);
    for (let i = 0; i < data.length; i++) upload[i] = THREE.DataUtils.toHalfFloat(data[i]);
    texture.needsUpdate = true;
  } };
}
