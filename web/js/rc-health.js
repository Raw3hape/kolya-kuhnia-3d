export function createRCHealthBadge(THREE, id) {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 52;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'rc_health_' + id;
  sprite.visible = false; sprite.raycast = () => {};
  Object.assign(sprite.userData, { impact: true, noPick: true, rasterOnly: true });
  let shown = -1, previous = 1, drawnTrail = -1;
  function paint(hp, maxHp, dt, reset) {
    const fraction = hp / maxHp;
    if (reset || shown < 0) previous = fraction;
    previous = Math.max(fraction, previous - dt * .88);
    const trail = Math.round(previous * 134);
    if (shown === hp && drawnTrail === trail) return;
    shown = hp; drawnTrail = trail;
    ctx.clearRect(0, 0, 160, 52);
    ctx.fillStyle = '#11191fe8';
    ctx.beginPath(); ctx.roundRect(5, 2, 150, 48, 13); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 23px system-ui';
    ctx.fillText(String(hp), 80, 19);
    ctx.fillStyle = '#394650';
    ctx.fillRect(13, 35, 134, 7);
    ctx.fillStyle = '#f9694f';
    ctx.fillRect(13, 35, trail, 7);
    ctx.fillStyle = fraction > .5 ? '#b6f387' : fraction > .25 ? '#ffd069' : '#fc624e';
    ctx.fillRect(13, 35, Math.round(fraction * 134), 7);
    texture.needsUpdate = true;
  }
  return { sprite, paint, dispose() { texture.dispose(); material.dispose(); } };
}
