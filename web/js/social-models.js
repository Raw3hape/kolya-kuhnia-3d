// Procedural apartment props. Shared materials/geometries, twelve removable pizza slices.
import { createAvatar } from './multiplayer/avatars.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export function createSocialModels({ THREE: T, scene, spec, locations }) {
  const root = new T.Group(); root.name = 'social_activities'; root.userData.rasterOnly = true; root.userData.networkEffect = true; scene.add(root);
  const owned = [], own = value => (owned.push(value), value);
  const mat = color => own(new T.MeshStandardMaterial({ color, roughness: 0.68 }));
  const cardboard = mat('#c29965'), cream = mat('#f4e7c6'), green = mat(spec.courier.color), dark = mat('#212a27'), cone = mat('#363936');
  const cube = own(new T.BoxGeometry(1, 1, 1)), cylinder = own(new T.CylinderGeometry(1, 1, 1, 24));
  function mesh(group, geometry, material, position, size) {
    const object = new T.Mesh(geometry, material); object.position.set(...position); if (size) object.scale.set(...size); object.receiveShadow = true; group.add(object); return object;
  }
  const box = (group, material, position, size) => mesh(group, cube, material, position, size);
  function label(group, text, width, height, position, flat = false) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const c = canvas.getContext('2d'); c.fillStyle = '#108b46'; c.fillRect(0, 0, 512, 256); c.fillStyle = '#fff9df';
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 64px Arial'; c.fillText(text, 256, 116, 480);
    c.font = '24px Arial'; c.fillText('DOBRZE, ŻE JESTEŚ', 256, 187);
    const texture = own(new T.CanvasTexture(canvas)); texture.colorSpace = T.SRGBColorSpace;
    const face = own(new T.MeshStandardMaterial({ map: texture, roughness: 0.8, side: T.DoubleSide }));
    const plane = mesh(group, own(new T.PlaneGeometry(width, height)), face, position); if (flat) plane.rotation.x = -Math.PI / 2; return plane;
  }
  const pizza = new T.Group(); pizza.name = 'social_pizza'; root.add(pizza);
  const size = spec.pizza.size, h = spec.pizza.height;
  box(pizza, cardboard, [0, 0.006, 0], [size, 0.012, size]);
  box(pizza, cream, [0, 0.013, 0], [size - 0.012, 0.002, size - 0.012]);
  for (const s of [-1, 1]) { box(pizza, cardboard, [s * size / 2, h / 2, 0], [0.006, h, size]); box(pizza, cardboard, [0, h / 2, s * size / 2], [size, h, 0.006]); }
  const lid = new T.Group(); lid.position.set(0, h, -size / 2); pizza.add(lid);
  box(lid, cardboard, [0, 0, size / 2], [size + 0.008, 0.008, size]);
  label(lid, 'żabka pizza', size * 0.82, size * 0.55, [0, 0.005, size / 2], true);
  const sliceMaterial = own(new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }));
  function tint(geometry, color, position = [0, 0, 0], rotation = null) {
    const g = geometry.toNonIndexed(); geometry.dispose(); if (rotation) g.rotateX(rotation); g.translate(...position);
    const c = new T.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(colors, 3)); return g;
  }
  const slices = [];
  for (let i = 0; i < spec.rules.slices; i++) {
    const start = i * Math.PI * 2 / spec.rules.slices, span = Math.PI * 2 / spec.rules.slices - 0.025, r = spec.pizza.radius;
    const parts = [tint(new T.CylinderGeometry(r, r, 0.012, 8, 1, false, start, span), '#dea749', [0, 0.023, 0]),
      tint(new T.CylinderGeometry(r * 0.94, r * 0.94, 0.004, 8, 1, false, start, span), '#f0c458', [0, 0.031, 0]),
      tint(new T.TorusGeometry(r - 0.006, 0.009, 5, 8, span), '#bb7938', [0, 0.029, 0], Math.PI / 2)];
    // Torus starts on +X; rotate its crust to the wedge's +Z convention.
    parts[2].rotateY(Math.PI / 2 - start - span);
    for (const [distance, delta] of [[0.07, 0], [0.12, 0.06]]) {
      const angle = start + span / 2 + delta;
      parts.push(tint(new T.CylinderGeometry(0.013, 0.013, 0.003, 10), '#a74729', [Math.sin(angle) * distance, 0.035, Math.cos(angle) * distance]));
    }
    const geometry = own(mergeGeometries(parts)); parts.forEach(part => part.dispose());
    slices.push(mesh(pizza, geometry, sliceMaterial, [0, 0, 0]));
  }
  const radio = new T.Group(); radio.name = 'social_radio'; radio.position.fromArray(spec.radio.position); root.add(radio);
  const [w, rh, d] = spec.radio.size;
  box(radio, dark, [0, rh / 2, 0], [w, rh, d]);
  for (const x of [-w * 0.31, w * 0.31]) {
    const speaker = mesh(radio, cylinder, cone, [x, rh * 0.51, d / 2 + 0.002], [0.085, 0.009, 0.085]); speaker.rotation.x = Math.PI / 2;
    const cap = mesh(radio, cylinder, dark, [x, rh * 0.51, d / 2 + 0.008], [0.037, 0.01, 0.037]); cap.rotation.x = Math.PI / 2;
  }
  const screen = own(new T.MeshBasicMaterial({ color: '#77ebaf' })); box(radio, screen, [0, rh * 0.63, d / 2 + 0.006], [0.09, 0.045, 0.003]);
  box(radio, green, [0, rh * 0.24, d / 2 + 0.007], [0.027, 0.027, 0.016]);
  const courier = createAvatar({ slot: 2, name: spec.courier.label, host: false }); courier.root.position.fromArray(locations.courier);
  // The landing has no daylight probes. Vertex colours remain readable there
  // without adding another light/shader variant to the apartment renderer.
  const courierMaterial = own(new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  courier.root.traverse(object => { if (object.isMesh && object.material?.vertexColors) object.material = courierMaterial; });
  courier.root.name = 'social_courier'; root.add(courier.root); label(courier.root, 'żabka', 0.28, 0.13, [0, 1.15, -0.143]);
  const bag = box(courier.root, green, [0, 1.05, 0.28], [0.45, 0.48, 0.32]); bag.name = 'delivery_bag';
  const showerGeometry = own(new T.BufferGeometry()), rain = new Float32Array(96 * 3);
  showerGeometry.setAttribute('position', new T.BufferAttribute(rain, 3));
  const dropCanvas = document.createElement('canvas'); dropCanvas.width = dropCanvas.height = 64;
  const dropContext = dropCanvas.getContext('2d'), dropGradient = dropContext.createLinearGradient(0, 0, 0, 64);
  dropGradient.addColorStop(0, '#ffffff00'); dropGradient.addColorStop(.55, '#ffffffe0'); dropGradient.addColorStop(1, '#ffffff00');
  dropContext.fillStyle = dropGradient; dropContext.beginPath(); dropContext.ellipse(32, 32, 5, 31, 0, 0, Math.PI * 2); dropContext.fill();
  const dropTexture = own(new T.CanvasTexture(dropCanvas));
  const shower = new T.Points(showerGeometry, own(new T.PointsMaterial({ map: dropTexture, color: '#d8f5ff', size: 0.045, transparent: true, opacity: 0.65, depthWrite: false, alphaTest: 0.015 })));
  shower.frustumCulled = false; root.add(shower);
  const bites = new T.InstancedMesh(slices[0].geometry, sliceMaterial, 10); bites.count = 0; bites.frustumCulled = false; root.add(bites);
  const dummy = new T.Object3D();
  const previewMaterial = own(new T.MeshBasicMaterial({ color: '#70e3a2', transparent: true, opacity: 0.3, depthWrite: false }));
  const preview = box(root, previewMaterial, [0, 0, 0], [size, 0.008, size]); preview.visible = false;
  let animation = 0;
  function update(state, dt, showerPoint, live, { camera, selfId, players = [], placement = null, showerTop } = {}) {
    animation += dt; root.visible = live; if (!live) return false;
    radio.visible = !!state.radio.position;
    if (radio.visible) { radio.position.fromArray(state.radio.position); radio.rotation.y = state.radio.yaw; }
    pizza.visible = !!state.pizza;
    if (state.pizza) {
      pizza.position.fromArray(state.pizza.position);
      const target = state.pizza.open ? -Math.PI * 0.65 : 0;
      lid.rotation.x += (target - lid.rotation.x) * Math.min(1, dt * 12);
      slices.forEach((slice, i) => { slice.visible = lid.rotation.x < -0.1 && i < state.pizza.remaining; });
    }
    preview.visible = !!placement && state.pizza?.owner === selfId;
    if (preview.visible) preview.position.fromArray(placement);
    let count = 0;
    for (const eater of state.pizza?.eaters || []) {
      const age = state.time - eater.at; if (age >= spec.rules.eatSeconds || age < 0) continue;
      const progress = age / spec.rules.eatSeconds;
      const other = players.find(p => p.id === eater.id);
      if (eater.id === selfId && camera) {
        dummy.position.set(0.13, -0.35 + Math.sin(progress * Math.PI) * 0.25, -0.28).applyMatrix4(camera.matrixWorld);
        dummy.quaternion.copy(camera.quaternion); dummy.rotateX(0.5);
      } else if (other) {
        dummy.position.set(other.x, (other.eyeY ?? 1.68) - 0.18, other.z); dummy.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), other.lookYaw ?? other.yaw);
        dummy.translateZ(-0.23);
      } else continue;
      dummy.scale.setScalar(1 - Math.max(0, progress - 0.55) * 1.5); dummy.updateMatrix(); bites.setMatrixAt(count++, dummy.matrix);
    }
    bites.count = count; if (count) bites.instanceMatrix.needsUpdate = true;
    courier.root.visible = !!state.courier;
    if (state.courier) {
      const leave = state.courier.leaving === null ? 0 : Math.min(1, (state.time - state.courier.leaving) / 3);
      courier.root.position.set(locations.courier[0] + leave * 1.6, 0, locations.courier[2]);
      courier.update({ time: state.time, speed: leave ? 1 : 0, weapon: 'none' });
    }
    shower.visible = !!state.shower.owner && !!showerPoint;
    if (shower.visible) {
      for (let i = 0; i < 96; i++) { const angle = i * 2.39996, radius = 0.18 * Math.sqrt((i % 23) / 23); rain[i * 3] = showerPoint[0] + Math.sin(angle) * radius; rain[i * 3 + 1] = showerTop - ((animation * 2.8 + i * 0.041) % (showerTop - 0.02)); rain[i * 3 + 2] = showerPoint[2] + Math.cos(angle) * radius; }
      showerGeometry.attributes.position.needsUpdate = true;
    }
    return !!state.courier || shower.visible || !!count || !!state.pizza?.owner || Math.abs(lid.rotation.x - (state.pizza?.open ? -Math.PI * 0.65 : 0)) > 0.001;
  }
  return { root, pizza, radio, courier: courier.root, update,
    dispose() { root.removeFromParent(); courier.dispose(); bites.dispose(); for (const value of owned) value.dispose(); } };
}
