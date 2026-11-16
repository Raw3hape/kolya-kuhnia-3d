// Shared anatomical hit volumes, independent of Three.js and the DOM.
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const px = ox - cx, py = oy - cy, pz = oz - cz, b = px * dx + py * dy + pz * dz, c = px * px + py * py + pz * pz - r * r, h = b * b - c;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : (c < 0 ? 0 : -1);
}
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az, oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz, bard = bax * dx + bay * dy + baz * dz, baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h < 0 || a < 1e-9) return -1;
  const t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard;
  if (y > 0 && y < baba) return t >= 0 ? t : -1;
  return y <= 0 ? raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r) : raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
}


export function rayAnimalPose(b, bird, origin, direction, S, ground, pad = 0, pose = b) {
  let hitZone = null;
  function boarPose(b, x, z, yaw, ox, oy, oz, dx, dy, dz, pad) {
    const s = b.scale, P = S.boars.hitPad, e = pad / s;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const rx = ox - x, ry = oy - ground, rz = oz - z;
    const lx = (c * rx - sn * rz) / s, ly = ry / s, lz = (sn * rx + c * rz) / s;
    const ldx = c * dx - sn * dz, ldy = dy, ldz = sn * dx + c * dz;
    // голова поворачивается у шеи (0, 0.62, 0.36) на тот же угол, что в BOAR_VERT: пасётся — вниз, тревога и галоп — вверх
    const a = b.graze * 0.72 - b.alert * 0.32 + clamp(b.gait - 2, 0, 1) * 0.12, ca = Math.cos(a), sa = Math.sin(a);
    const hy = 0.62 + ca * -0.09 - sa * 0.24, hz = 0.36 + sa * -0.09 + ca * 0.24;
    const tHead = raySphere(lx, ly, lz, ldx, ldy, ldz, 0, hy, hz, 0.19 * P + e);
    const tBody = rayCapsule(lx, ly, lz, ldx, ldy, ldz, 0, 0.62, -0.58, 0, 0.62, 0.34, 0.28 * P + e);
    const tHeart = raySphere(lx, ly, lz, ldx, ldy, ldz, 0, 0.5, 0.2, 0.14 * P + e * 0.5);
    const tLegF = rayCapsule(lx, ly, lz, ldx, ldy, ldz, -0.12, 0.2, 0.2, 0.12, 0.2, 0.2, 0.17 * P + e);
    const tLegR = rayCapsule(lx, ly, lz, ldx, ldy, ldz, -0.12, 0.2, -0.5, 0.12, 0.2, -0.5, 0.18 * P + e);
    hitZone = null;
    let t = -1;
    if (tHead >= 0 && (tBody < 0 || tHead <= tBody + 0.05)) { hitZone = 'head'; t = tHead; }
    else if (tBody >= 0) { hitZone = tHeart >= 0 ? 'heart' : 'body'; t = tBody; }
    else {
      const tl = tLegF >= 0 && (tLegR < 0 || tLegF < tLegR) ? tLegF : tLegR;
      if (tl >= 0) { hitZone = 'legs'; t = tl; }
    }
    return t < 0 ? -1 : t * s;
  }
  // Птица в (x, y, z, yaw): эллипсоид по размаху крыльев, длине и взмаху (× hitPad), голова — шар впереди
  function birdPose(b, x, y, z, yaw, ox, oy, oz, dx, dy, dz, pad) {
    const sp = b.scale, P = S.birds.hitPad, c = Math.cos(yaw), sn = Math.sin(yaw);
    const rx = ox - x, ry = oy - y, rz = oz - z;
    const ax = 0.5 * sp * P + pad, ay = 0.22 * sp * P + pad, az = 0.3 * sp * P * Math.max(1, b.fat * 0.85) + pad;
    const px = (c * rx - sn * rz) / ax, py = ry / ay, pz = (sn * rx + c * rz) / az;
    const qx = (c * dx - sn * dz) / ax, qy = dy / ay, qz = (sn * dx + c * dz) / az;
    const A = qx * qx + qy * qy + qz * qz, B2 = px * qx + py * qy + pz * qz, C = px * px + py * py + pz * pz - 1, h = B2 * B2 - A * C;
    hitZone = null;
    if (h < 0) return -1;
    let t = (-B2 - Math.sqrt(h)) / A;
    if (t < 0) { if (C >= 0) return -1; t = 0; }
    const f = (0.2 + (b.fat - 1) * 0.12) * sp;
    hitZone = raySphere(ox, oy, oz, dx, dy, dz, x + sn * f, y + 0.035 * sp, z + c * f, 0.09 * sp * P + pad) >= 0 ? 'head' : 'body';
    return t;
  }
  const [ox, oy, oz] = origin, [dx, dy, dz] = direction;
  const t = bird ? birdPose(b, pose.x, pose.y, pose.z, pose.yaw, ox, oy, oz, dx, dy, dz, pad) : boarPose(b, pose.x, pose.z, pose.yaw, ox, oy, oz, dx, dy, dz, pad);
  return t < 0 ? null : { distance: t, zone: hitZone };
}
