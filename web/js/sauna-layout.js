/** Authored horizontal plan shared by scene, client and room Worker. x/z in metres, floor y=0. */
export function createSaunaLayout(config) {
  const { bounds, spawn, architecture, walls, pools, zones, furniture } = config;
  const seats = [], obstacles = walls.map(wall => wall.rect);
  const byZone = new Map(zones.map(zone => [zone.id, zone]));
  for (const item of furniture) {
    const [x, z] = item.at, [width, depth] = item.size;
    const c = Math.cos(item.yaw), s = Math.sin(item.yaw);
    const halfX = (Math.abs(c) * width + Math.abs(s) * depth) / 2;
    const halfZ = (Math.abs(s) * width + Math.abs(c) * depth) / 2;
    obstacles.push([x - halfX, z - halfZ, x + halfX, z + halfZ]);
    const world = (u, v) => [x + u * c + v * s, z - u * s + v * c];
    for (let i = 0; i < item.places; i++) {
      const along = (i - (item.places - 1) / 2) * width / item.places;
      const [sx, sz] = world(along, 0);
      const side = item.standSide ?? 1;
      // A lounger is approached from the side, a panorama bench from behind.
      // Every other seat fronts the aisle directly.
      const stand = item.kind === 'lounger'
        ? world(side * (width / 2 + 0.46), 0.22)
        : world(along, (item.kind === 'window' ? 1 : -1) * (depth / 2 + 0.59));
      seats.push({ id: item.id + '-' + (i + 1), label: item.label, x: sx, y: item.seatY, z: sz,
        yaw: item.yaw, stand, zone: item.zone, kind: item.kind });
    }
  }
  return { bounds, spawn, architecture, walls, pools, zones, furniture, obstacles, seats, byZone };
}
