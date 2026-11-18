// Surface finish and water presentation for the authored alpine bathhouse.
const TEXTURE_SIZE = 128;
const TAU = Math.PI * 2;
const clamp = value => Math.min(255, Math.max(0, Math.round(value)));
const hash = (x, y, key) => {
  let n = Math.imul(x + key, 0x45d9f3b) ^ Math.imul(y + 1, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 16), 0x119de1f3);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

function dataTexture(T, seed, pixel) {
  const n = TEXTURE_SIZE;
  const pixels = new Uint8Array(n * n * 4);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const at = 4 * (z * n + x);
    const [r, g, b] = pixel(x / n, z / n, hash(x, z, seed) - 0.5);
    pixels[at] = clamp(r); pixels[at + 1] = clamp(g); pixels[at + 2] = clamp(b); pixels[at + 3] = 255;
  }
  const map = new T.DataTexture(pixels, n, n);
  map.colorSpace = T.SRGBColorSpace;
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.magFilter = T.LinearFilter;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

export function saunaFinishes(T, seed) {
  const timber = dataTexture(T, seed, (u, v, salt) => {
    const grain = 9 * Math.sin(TAU * (29 * u + 0.4 * Math.sin(TAU * v))) +
      4 * Math.sin(TAU * (58 * u + 0.25 * Math.sin(TAU * (2 * v - u))));
    const value = grain + salt * 9 + 11 * Math.sin(TAU * (3 * u + 0.2 * Math.cos(TAU * v)));
    return [181 + value, 127 + value * 0.76, 81 + value * 0.63];
  });
  const stone = dataTexture(T, seed ^ 0x1737, (u, v, salt) => {
    const strata = Math.sin(TAU * (u * 3 + v * 4 + .36 * Math.sin(TAU * (u - v)))) * 4;
    const mineral = Math.sin(TAU * (v * 7 - u * 13)) * Math.cos(TAU * (u * 5 + v * 6));
    const vein = (mineral > 0.75 ? (mineral - .75) * 21 : 0);
    const tone = 143 + strata + salt * 20 + vein;
    const joint = (u < .013 || v < .013) ? 0.77 : 1;
    return [tone * joint, (tone + 1) * joint, (tone + 3) * joint];
  });
  const solid = (color, roughness = .74, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });
  const mapped = (color, map, roughness = .8) => new T.MeshStandardMaterial({ color, map, roughness });
  const lum = (color, strength) => new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: .6 });
  return {
    cedar: mapped('#fff0d5', timber, .69), ash: mapped('#d0aa85', timber, .65),
    burnt: mapped('#6d5141', timber), trim: solid('#342c27', .5, .14),
    floor: mapped('#d7d4ca', stone, .72), basalt: mapped('#64656c', stone, .84), darkStone: mapped('#77736c', stone, .72),
    coping: solid('#928d78', .55), liner: mapped('#40858a', stone, .52),
    brass: solid('#936745', .46, .42), ink: solid('#1b2729', .58, .18),
    linen: solid('#afa38b', .94), moss: solid('#5f7867', .91), sand: solid('#a67f64', .92),
    leaf: solid('#40664f'), leafPale: solid('#5b8067'),
    warm: lum('#ffc891', 1.48), amber: lum('#f58a44', 1.27), cool: lum('#99e8e9', .79),
    glow: lum('#ffd7a3', .44),
    glass: new T.MeshBasicMaterial({ color: '#9dcbd1', transparent: true, opacity: .06, depthWrite: false, side: T.DoubleSide }),
    hotGlass: new T.MeshBasicMaterial({ color: '#e7bb81', transparent: true, opacity: .10, depthWrite: false, side: T.DoubleSide }),
    textures: [timber, stone],
  };
}

// One water mesh per pool. The reflection samples the same panorama that is
// visible beyond the glazing, projected along the ripple-deflected ray. Near
// the normal, a refracted ray meets the actual basin floor and entry slope.
export function saunaWater(T, pool, architecture, vista, panorama, eco) {
  const [x0, z0, x1, z1] = pool.rect;
  const uniforms = {
    uTime: { value: 0 },
    uBounds: { value: new T.Vector4(x0, z0, x1, z1) },
    uBasin: { value: new T.Vector3(pool.surface, pool.depth, pool.steps) },
    uVista: { value: new T.Vector4(vista.z, vista.y, vista.width, vista.height) },
    uCeiling: { value: new T.Vector2(architecture.ceiling, architecture.roofBay) },
    uColor: { value: new T.Color(pool.color) },
    uPanorama: { value: panorama },
    uPhoto: { value: 0 },
    uRipple: { value: [new T.Vector4(), new T.Vector4(), new T.Vector4(), new T.Vector4()] },
  };
  const material = new T.ShaderMaterial({
    uniforms,
    side: T.DoubleSide,
    defines: eco ? { ECONOMY: 1 } : {},
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
      }`,
    fragmentShader: `
      varying vec3 vWorld;
      uniform float uTime, uPhoto;
      uniform vec4 uBounds, uVista, uRipple[4];
      uniform vec2 uCeiling;
      uniform vec3 uBasin, uColor;
      uniform sampler2D uPanorama;

      vec3 reflectedColor(vec3 ray) {
        vec3 ceiling = vec3(.20, .129, .090);
        float ceilingT = (uCeiling.x - vWorld.y) / max(ray.y, .025);
        vec3 hit = vWorld + ray * ceilingT;
        float rib = abs(fract(hit.x / uCeiling.y) - .5);
        float slats = .34 + .66 * smoothstep(.06, .23, rib);
        float strip = (1. - smoothstep(.021, .057, abs(fract(hit.x / (uCeiling.y * 3.)) - .5))) *
          smoothstep(1.2, 2.8, -hit.z) * (1. - smoothstep(20., 24., -hit.z));
        vec3 timber = ceiling * slats + vec3(1., .65, .34) * .94 * strip;
        float panoT = (uVista.x - vWorld.z) / min(-.001, ray.z);
        vec2 uv = vec2(vWorld.x + panoT * ray.x, vWorld.y + panoT * ray.y - uVista.y) / uVista.zw + .5;
        float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
        vec3 photo = texture2D(uPanorama, clamp(uv, vec2(.001), vec2(.999))).rgb;
        vec3 cool = mix(vec3(.25, .35, .47), photo, uPhoto * inside);
        float window = (1. - smoothstep(ceilingT - 5., ceilingT + 4., panoT)) * (1. - step(0., ray.z));
        return mix(timber, cool, window);
      }

      float waveMotion(vec2 slope) { return .055 * (slope.x + slope.y); }

      void main() {
        vec2 xy = vWorld.xz;
        float t = uTime;
        float a = dot(xy, vec2(3.9, 2.7)) + t * 1.75;
        float b = dot(xy, vec2(-2.1, 5.8)) - t * 2.15;
        float c = dot(xy, vec2(9., -.9)) + t * 3.1;
        vec2 slope = vec2(3.9, 2.7) * cos(a) * .0052 + vec2(-2.1, 5.8) * cos(b) * .0036 +
          vec2(9., -.9) * cos(c) * .0015;
        #ifndef ECONOMY
          float d = dot(xy, vec2(8.9, 13.4)) - t * 4.6;
          slope += vec2(8.9, 13.4) * cos(d) * .0009;
        #endif
        for (int i = 0; i < 4; i++) {
          vec2 offset = xy - uRipple[i].xy;
          float distanceToStep = max(length(offset), .025);
          float rings = cos(distanceToStep * 18. - t * 8.);
          slope += offset / distanceToStep * rings * uRipple[i].z * exp(-distanceToStep * 1.28) * .048;
        }
        vec3 normal = normalize(vec3(slope.x, 1., slope.y));
        vec3 eye = normalize(cameraPosition - vWorld);
        vec3 reflection = reflect(-eye, normal);
        float fresnel = .026 + .91 * pow(1. - clamp(dot(normal, eye), 0., 1.), 3.3);
        vec3 through = refract(-eye, normal, 0.7519);
        float rampDepth = uBasin.y * clamp((uBounds.w - xy.y) / uBasin.z, 0., 1.);
        vec2 bottom = xy + through.xz * min(2.2, rampDepth / max(-through.y, .14));
        float grout = min(abs(fract(bottom.x * 3.125) - .5), abs(fract(bottom.y * 3.125) - .5));
        float tiles = mix(.82, 1., smoothstep(.008, .035, grout));
        vec2 refracted = bottom * 7.8 + slope * 4.2;
        refracted += .54 * vec2(sin(refracted.y * .43 + t * .39), cos(refracted.x * .41 - t * .44));
        float veins = sin(dot(refracted, vec2(.86, .63)) + t * .39) *
          sin(dot(refracted, vec2(-.52, 1.13)) - t * .40) +
          .39 * cos(dot(refracted, vec2(1.17, 1.86)) + t * .59);
        float web = 1. - smoothstep(.055, .24, abs(veins));
        float caustic = web * (.045 + .11 * (1. - rampDepth / uBasin.y));
        float side = min(min(xy.x - uBounds.x, uBounds.z - xy.x), xy.y - uBounds.y);
        float edge = 1. - smoothstep(.015, .2, side);
        float meniscus = 1. - smoothstep(.006, .054, side + waveMotion(slope));
        vec3 clear = uColor * (1.32 - rampDepth * .27) * tiles + vec3(.014,.083,.098);
        clear += vec3(.36, .72, .70) * (caustic + edge * .10);
        vec3 color = mix(clear, reflectedColor(reflection), fresnel);
        color += vec3(.32, .54, .61) * meniscus * (.16 + .16 * fresnel);
        float specular = pow(max(0., dot(reflection, normalize(vec3(-.21,.82,-.53)))), 82.);
        color += vec3(.47, .81, .91) * specular * .22;
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geometry = new T.PlaneGeometry(x1 - x0, z1 - z0);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'sauna-water-' + pool.id;
  mesh.position.set((x0 + x1) / 2, pool.surface, (z0 + z1) / 2);
  return { mesh, uniforms, material, geometry };
}
