// Pure apartment/level boundary shared by the local view and the room Worker.
import { areaBeyond, WALK } from './multiplayer/collision.js';

export function serviceEntrance(plan) {
  const opening = plan.openings.find(value => value.type === 'entry');
  if (!opening) return null;
  const side = areaBeyond(plan, opening).side;
  const alongX = opening.along === 'x';
  const sign = side.endsWith('1') ? 1 : -1;
  const x = alongX ? (opening.x0 + opening.x1) / 2 : opening[side];
  const z = alongX ? opening[side] : (opening.z0 + opening.z1) / 2;
  const nx = alongX ? 0 : sign, nz = alongX ? sign : 0;
  const yaw = Math.atan2(-nx, -nz);
  const depth = pose => (pose.x - x) * nx + (pose.z - z) * nz;
  const lateral = pose => (pose.x - x) * -nz + (pose.z - z) * nx;
  return {
    id: opening.id, x, z, yaw, width: opening.width, height: opening.head,
    depth, lateral,
    crossed(pose, tolerance = 0) {
      return depth(pose) >= -tolerance && depth(pose) < WALK.radius * 2 &&
        Math.abs(lateral(pose)) < opening.width / 2 - WALK.radius / 2;
    },
    returnPose: { x: x - nx * (WALK.radius + opening.width), z: z - nz * (WALK.radius + opening.width), yaw, pitch: 0, y: 0 },
  };
}

export const newServiceSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
