// Short-lived shared traces, bounded independently of persistent world damage.
export function createShotRenderer({ THREE, scene, requestRender }) {
  const root = new THREE.Group(); root.name = 'network-shots';
  root.userData.networkEffect = true; root.userData.rasterOnly = true; scene.add(root);
  const material = new THREE.LineBasicMaterial({ color: '#ffcf7a', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
  const pool = [];
  function shot(event, { origin } = {}) {
    if (!event?.origin) return;
    // Remote traces leave the visible grip-mounted muzzle. Their endpoint still
    // comes from the accepted authoritative ray, preserving actual hit results.
    const muzzle = Array.isArray(origin) && origin.length === 3 && origin.every(Number.isFinite) ? origin : null;
    for (const ray of event.rays || []) {
      if (pool.length >= 96) { const old = pool.shift(); root.remove(old.mesh); old.mesh.geometry.dispose(); }
      const hit = ray.hit || ray.externalHit || ray.effects?.at(-1), max = hit?.distance || 100;
      const end = hit?.point || event.origin.map((n, i) => n + ray.direction[i] * max);
      const a = new THREE.Vector3(...(muzzle || event.origin)), b = new THREE.Vector3(...end);
      if (!muzzle) a.addScaledVector(new THREE.Vector3(...ray.direction), 0.35);
      const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
      const mesh = new THREE.Line(geometry, material); mesh.raycast = () => {}; root.add(mesh);
      pool.push({ mesh, t: 0.08 });
    }
    requestRender();
  }
  return { shot, update(dt) {
    for (let i = pool.length - 1; i >= 0; i--) if ((pool[i].t -= dt) <= 0) { const item = pool.splice(i, 1)[0]; root.remove(item.mesh); item.mesh.geometry.dispose(); }
    return !!pool.length;
  }, clear() { for (const item of pool) item.mesh.geometry.dispose(); pool.length = 0; root.clear(); },
  dispose() { this.clear(); material.dispose(); scene.remove(root); } };
}
