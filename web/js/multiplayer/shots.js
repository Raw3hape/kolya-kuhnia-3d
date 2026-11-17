// The visible streak is presentation only. Its endpoint comes from the resolved shot.
const STYLE = {
  pistol: { speed: 290, width: .014, tail: 7, color: '#ff9c40' },
  rifle: { speed: 520, width: .012, tail: 17, color: '#ffb04f' },
  bolt: { speed: 660, width: .018, tail: 24, color: '#ffd17f' },
  shotgun: { speed: 260, width: .009, tail: 5, color: '#ffac55' },
};
const LIMIT = 96;
const FADE = .045;

export function shotEndpoint(origin, ray, range) {
  const solid = ray.effects?.find(effect => effect.kind === 'surface');
  const stop = [solid, ray.hit, ray.externalHit, ray.vehicleHit]
    .filter(hit => hit?.point && Number.isFinite(hit.distance))
    .reduce((nearest, hit) => !nearest || hit.distance < nearest.distance ? hit : nearest, null);
  return stop?.point ?? origin.map((value, i) => value + ray.direction[i] * range);
}

export function createShotRenderer({ THREE, scene, requestRender }) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,-1,0, 0,1,0, 1,-1,0, 1,1,0], 3));
  function attribute(name, size) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(LIMIT * size), size).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    return attr;
  }
  const start = attribute('aStart', 3), end = attribute('aEnd', 3);
  const tint = attribute('aTint', 3), shape = attribute('aShape', 2);
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: `
      attribute vec3 aStart, aEnd, aTint;
      attribute vec2 aShape;
      varying vec2 vShape;
      varying vec3 vTint;
      varying float vFade;
      void main() {
        vec3 a = (modelViewMatrix * vec4(aStart, 1.)).xyz;
        vec3 b = (modelViewMatrix * vec4(aEnd, 1.)).xyz;
        vec3 center = mix(a, b, position.x);
        vec3 side = cross(b - a, -center);
        side = length(side) < 1e-7 ? vec3(1., 0., 0.) : normalize(side);
        float width = max(aShape.x, -center.z * .0016) * mix(.45, 1., position.x);
        gl_Position = projectionMatrix * vec4(center + side * width * position.y, 1.);
        vShape = position.xy;
        vTint = aTint;
        vFade = aShape.y;
      }`,
    fragmentShader: `
      varying vec2 vShape;
      varying vec3 vTint;
      varying float vFade;
      void main() {
        float crossSection = abs(vShape.y);
        float glow = pow(1. - crossSection, 2.8);
        float core = 1. - smoothstep(.1, .32, crossSection);
        float trail = smoothstep(0., .7, vShape.x) * (1. - smoothstep(.94, 1., vShape.x));
        gl_FragColor = vec4(mix(vTint, vec3(1., .94, .8), core), max(glow * .68, core) * trail * vFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'bullet-tracers'; mesh.visible = false; mesh.frustumCulled = false; mesh.raycast = () => {};
  Object.assign(mesh.userData, { impact: true, rasterOnly: true, noPick: true });
  scene.add(mesh);
  const pool = Array.from({ length: LIMIT }, () => ({
    from: new THREE.Vector3(), direction: new THREE.Vector3(), color: new THREE.Color(),
    age: Infinity, length: 0, speed: 0, width: 0, tail: 0, flight: 0, lead: 0,
  }));
  let cursor = 0;
  const point = new THREE.Vector3();

  function draw() {
    let index = 0;
    for (const streak of pool) {
      if (streak.age >= streak.flight + FADE) continue;
      const head = Math.min(streak.length, streak.lead + streak.age * streak.speed);
      const tail = Math.max(0, head - streak.tail);
      point.copy(streak.from).addScaledVector(streak.direction, tail);
      start.setXYZ(index, point.x, point.y, point.z);
      point.copy(streak.from).addScaledVector(streak.direction, head);
      end.setXYZ(index, point.x, point.y, point.z);
      tint.setXYZ(index, streak.color.r, streak.color.g, streak.color.b);
      shape.setXY(index, streak.width, 1 - Math.max(0, streak.age - streak.flight) / FADE);
      index++;
    }
    geometry.instanceCount = index;
    mesh.visible = index > 0;
    if (index) for (const attr of [start, end, tint, shape]) attr.needsUpdate = true;
  }

  function trace(from, to, weapon = 'rifle') {
    const streak = pool[cursor], style = STYLE[weapon] ?? STYLE.rifle;
    point.subVectors(to, from);
    const length = point.length();
    if (length < .05) return;
    cursor = (cursor + 1) % LIMIT;
    streak.from.copy(from); streak.direction.copy(point).divideScalar(length);
    streak.age = 0; streak.length = length; streak.lead = Math.min(1.5, length);
    streak.speed = Math.max(style.speed, length / .42);
    streak.flight = (length - streak.lead) / streak.speed;
    streak.width = style.width; streak.tail = style.tail; streak.color.set(style.color);
    requestRender();
  }

  function shot(event, { origin, range = 100 } = {}) {
    if (!event?.origin) return;
    const muzzle = origin?.length === 3 && origin.every(Number.isFinite) ? origin : null;
    const from = new THREE.Vector3().fromArray(muzzle ?? event.origin);
    const to = new THREE.Vector3(), direction = new THREE.Vector3(), delta = new THREE.Vector3();
    for (const ray of event.rays || []) {
      direction.fromArray(ray.direction);
      if (!muzzle) from.fromArray(event.origin).addScaledVector(direction, .35);
      to.fromArray(shotEndpoint(event.origin, ray, range));
      if (delta.subVectors(to, from).dot(direction) > .03) trace(from, to, event.weapon);
    }
  }

  function clear() {
    for (const streak of pool) streak.age = Infinity;
    geometry.instanceCount = 0; mesh.visible = false;
  }

  return { trace, shot, clear, update(dt, visible = true) {
    if (!pool.some(streak => streak.age < streak.flight + FADE) && !mesh.visible) return false;
    // Draw the first sample at the muzzle even on a slow frame.
    draw();
    for (const streak of pool) streak.age += dt;
    mesh.visible &&= visible;
    return mesh.visible;
  }, dispose() { scene.remove(mesh); geometry.dispose(); material.dispose(); } };
}
