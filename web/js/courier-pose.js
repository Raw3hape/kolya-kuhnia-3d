// Shared delivery choreography in metres and simulation seconds. No Three.js or wall clock.
const clamp = n => Math.max(0, Math.min(1, n));
export const deliveryEase = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
export function courierPose(spec, locations, courier, time) {
  const c = spec.courier, position = [...locations.courier]; let yaw = 0;
  if (courier?.phase === 'arriving') {
    const t = deliveryEase((time - courier.phaseAt) / c.arriveSeconds);
    position[0] -= c.sideStep * (1 - t); yaw = -Math.PI / 2 * (1 - t);
  } else if (courier?.phase === 'leaving') {
    const t = deliveryEase((time - courier.phaseAt) / c.leaveSeconds);
    position[0] += c.sideStep * t; yaw = -Math.PI / 2 * t;
  } else if (courier && ['offering', 'handoff', 'thanks'].includes(courier.phase)) position[2] -= c.offerStep;
  const [x, y, z] = c.boxOffset, sin = Math.sin(yaw), cos = Math.cos(yaw);
  return { position, yaw, box: [position[0] + x * cos + z * sin, position[1] + y, position[2] - x * sin + z * cos] };
}
