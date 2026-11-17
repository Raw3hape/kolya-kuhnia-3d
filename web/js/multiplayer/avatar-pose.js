// Pure presentation solver. All phases use room seconds and authoritative accepted actions.
// No DOM, Three.js, wall clock, physics state, global RNG or network side effects.
import { AVATAR_RIG as R, WEAPON_PRESENTATION as W } from './avatar-rig.js';
import { actionDuration } from './action-contract.js';
// These prop families are rendered by their gameplay adapters. Avatars provide
// the pose and attachment sockets without constructing another visible prop.
export const EXTERNAL_AVATAR_PROPS = Object.freeze(['beer', 'energy', 'vape', 'hookah', 'pizza', 'controller']);
const HELD_PROPS = Object.freeze(['phone', 'newspaper', ...EXTERNAL_AVATAR_PROPS]);
const PARTY_PROPS = Object.freeze(['beer', 'energy', 'vape', 'hookah']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const lerp = (a, b, k) => a + (b - a) * k;
const mix = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const windowed = (v, start, end) => smooth((v - start) / Math.max(0.001, end - start));
const pulse = v => Math.sin(Math.PI * clamp(v, 0, 1));
const add = (a, b) => a.map((v, i) => v + b[i]);
const rotatePitch = (point, pitch, origin) => {
  const y = point[1] - origin[1], z = point[2] - origin[2], c = Math.cos(pitch), s = Math.sin(pitch);
  return [point[0], origin[1] + y * c - z * s, origin[2] + y * s + z * c];
};

export function solveArm(side, requested) {
  const shoulder = [side * R.shoulderX, R.shoulderY, 0];
  let delta = requested.map((v, i) => finite(v, shoulder[i]) - shoulder[i]);
  const reach = clamp(Math.hypot(...delta), 0.04, R.upperArm + R.forearm - 0.001);
  const rawLength = Math.hypot(...delta);
  delta = rawLength > 1e-6 ? delta.map(v => v / rawLength) : [0, -1, 0];
  const wrist = shoulder.map((v, i) => v + delta[i] * reach);
  let pole = [side, -0.15, 0.25];
  let dot = pole.reduce((sum, v, i) => sum + v * delta[i], 0);
  pole = pole.map((v, i) => v - dot * delta[i]);
  let poleLength = Math.hypot(...pole);
  // A reach parallel to the preferred elbow pole needs another bend plane;
  // normalizing floating-point residue can otherwise change limb lengths.
  if (poleLength < 1e-6) {
    pole = Math.abs(delta[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    dot = pole.reduce((sum, v, i) => sum + v * delta[i], 0);
    pole = pole.map((v, i) => v - dot * delta[i]); poleLength = Math.hypot(...pole);
  }
  pole = pole.map(v => v / poleLength);
  const along = (R.upperArm ** 2 - R.forearm ** 2 + reach ** 2) / (2 * reach);
  const height = Math.sqrt(Math.max(0, R.upperArm ** 2 - along ** 2));
  const elbow = shoulder.map((v, i) => v + delta[i] * along + pole[i] * height);
  return { shoulder, elbow, wrist, reach };
}

export function solveLeg(hipHeight, footZ, lift = 0) {
  const y = R.ankleY + finite(lift) - finite(hipHeight, R.hipY), z = finite(footZ);
  const distance = clamp(Math.hypot(y, z), 0.08, R.upperLeg + R.lowerLeg - 0.001);
  const forward = Math.atan2(-z, -y);
  const alpha = Math.acos(clamp((R.upperLeg ** 2 + distance ** 2 - R.lowerLeg ** 2) / (2 * R.upperLeg * distance), -1, 1));
  const bend = Math.PI - Math.acos(clamp((R.upperLeg ** 2 + R.lowerLeg ** 2 - distance ** 2) / (2 * R.upperLeg * R.lowerLeg), -1, 1));
  const hip = forward + alpha, knee = -bend;
  return { hip, knee, ankle: -hip - knee };
}

export function solveAvatarPose(state = {}, slot = 0) {
  const reclined = !!state.reclined;
  const time = finite(state.time), speed = reclined ? 0 : clamp(finite(state.speed), 0, 4.5), motion = smooth(speed / 0.5), running = smooth((speed - 1.8) / 1.2);
  const phase = time * 8 + slot * 0.43, step = Math.sin(phase), swing = 0.12 + running * 0.15;
  const action = state.action && typeof state.action === 'object' ? state.action : null;
  const kind = action?.kind || (typeof state.action === 'string' ? state.action : null);
  const duration = Math.max(0.001, finite(action?.duration, actionDuration(kind, state.weapon)));
  const elapsed = Math.max(0, finite(state.actionTime, action ? time - finite(action.at, time) : 0));
  const progress = clamp(elapsed / duration, 0, 1), activeAction = !!kind && elapsed < duration;
  const actionWave = activeAction ? pulse(progress) : 0;
  let seated = state.seated ? 1 : 0;
  if (activeAction && kind === 'sit') seated = smooth(progress);
  if (activeAction && kind === 'stand') seated = 1 - smooth(progress);
  const seatY = clamp(finite(state.seatY, 0.45), 0.2, 1.2);
  const grounded = state.grounded !== false;
  const landing = activeAction && kind === 'land' ? actionWave : 0;
  const walkBob = motion * (-0.035 - running * 0.025 + Math.cos(phase * 2) * 0.007);
  const offsetY = lerp(grounded ? walkBob - landing * 0.09 : 0, seatY - R.hipY, seated);
  const bodyPitch = lerp(-motion * (0.035 + running * 0.09) + landing * 0.08, -0.035, seated);
  const bodyRoll = (1 - seated) * (grounded ? step * motion * 0.018 : 0);
  const stride = swing * motion * (1 - seated);
  const leg = sign => {
    const p = phase + (sign > 0 ? Math.PI : 0), lift = Math.max(0, Math.sin(p)) * (0.065 + running * 0.065) * motion;
    let result = solveLeg(R.hipY + offsetY, Math.cos(p) * stride, lift);
    if (!grounded) {
      const ascending = finite(state.verticalSpeed) > 0;
      result = { hip: ascending ? 0.24 + sign * 0.08 : -0.08 + sign * 0.1, knee: ascending ? -0.68 : -0.32, ankle: 0.12 };
    }
    const sitHip = Math.acos(clamp((seatY - R.lowerLeg - R.ankleY) / R.upperLeg, -0.4, 0.4));
    return { hip: lerp(result.hip, sitHip, seated), knee: lerp(result.knee, -sitHip, seated), ankle: lerp(result.ankle, 0, seated) };
  };
  const leftLeg = reclined ? { hip: 0.03, knee: -0.04, ankle: -0.14 } : leg(-1);
  const rightLeg = reclined ? { hip: 0.06, knee: -0.08, ankle: -0.2 } : leg(1);
  let right = [R.shoulderX, 0.91, -0.025 - step * motion * 0.11], left = [-R.shoulderX, 0.91, -0.025 + step * motion * 0.11];
  if (reclined) { right = [0.25, 0.91, 0.07]; left = [-0.24, 0.93, 0.08]; }
  let handEuler = [0, 0, 0], leftEuler = [0, 0, 0], headPitch = clamp(finite(state.aimPitch) * 0.72, -0.65, 0.65);
  const held = EXTERNAL_AVATAR_PROPS.includes(state.carried) ? state.carried : HELD_PROPS.includes(state.held) ? state.held : null;
  let gear = held || (state.weapon && Object.hasOwn(W, state.weapon) ? state.weapon : 'none');
  if (!state.held && activeAction && kind === 'drop' && HELD_PROPS.includes(action?.targetId)) gear = action.targetId;
  if (!held && activeAction && kind === 'holster' && Object.hasOwn(W, action?.targetId)) gear = action.targetId;
  const aiming = clamp(finite(state.aiming), 0, 1), pitch = clamp(finite(state.aimPitch), -1.1, 1.1);
  const weapon = W[gear], isPhone = gear === 'phone', isPaper = gear === 'newspaper';
  const targetId = action?.targetId || state.interaction?.targetId;
  const partyItem = PARTY_PROPS.includes(gear), drinkItem = gear === 'beer' || gear === 'energy', isController = gear === 'controller';
  if (gear === 'pizza') { const center = state.heldGrip?.center || [0, 1.16, -0.42], half = (state.heldGrip?.width ?? 0.38) / 2; right = [center[0] + half, center[1], center[2]]; left = [center[0] - half, center[1], center[2]]; handEuler = leftEuler = [-0.2, 0, 0]; }
  if (isController) {
    const center = state.heldGrip?.center || [0, 1.14, -0.30], half = (state.heldGrip?.width ?? 0.22) / 2;
    right = [center[0] + half, center[1], center[2]]; left = [center[0] - half, center[1], center[2]];
    handEuler = leftEuler = [-0.12, 0, 0];
  }
  if (state.washing) { const rub = Math.sin(time * 7) * 0.035; right = [0.10 + rub, 1.57, -0.16]; left = [-0.10 + rub, 1.57, -0.16]; }
  const selfUse = partyItem && ['sip', 'puff'].includes(kind) || isPhone && targetId === 'phone' || isPaper && (kind === 'page' || targetId === 'newspaper');
  let gearVisible = gear !== 'none', gearScale = 1, page = 0, tap = 0, magazine = 0, bolt = 0, breakOpen = 0;
  let shotAge = Number.isFinite(state.shotAge) ? Math.max(0, state.shotAge) : activeAction && kind === 'fire' ? elapsed : state.shooting ? 0.035 : Infinity;
  const recoil = weapon ? Math.exp(-shotAge * 24) * Math.sin(Math.min(1, shotAge / 0.075) * Math.PI) * weapon.recoil : 0;
  if (weapon) {
    right = mix(weapon.right, weapon.aimed, aiming);
    right = rotatePitch(right, pitch, [R.shoulderX, R.shoulderY, 0]);
    right[2] += recoil * 0.035; right[1] += recoil * 0.015;
    handEuler = [pitch + recoil * 0.12, 0, 0];
    left = add(right, rotatePitch(weapon.support, handEuler[0], [0, 0, 0]));
    // Move the rigid two-hand grip inward when a pitched foregrip would exceed
    // the support arm's reach; never leave the hand floating beside the barrel.
    const support = solveArm(-1, left).wrist;
    right = add(right, support.map((v, i) => v - left[i])); left = support;
    leftEuler = [...handEuler];
    if (activeAction && kind === 'draw') {
      const raised = windowed(progress, 0.12, 0.95);
      right = mix([0.22, 0.9, 0.02], right, raised); left = mix([-0.18, 0.95, -0.03], left, raised);
      handEuler[0] -= (1 - raised) * 0.9; gearScale = windowed(progress, 0, 0.2);
    }
    if (activeAction && kind === 'holster') {
      const lowered = windowed(progress, 0, 0.8);
      right = mix(right, [0.22, 0.88, 0.025], lowered); left = mix(left, [-0.18, 0.92, -0.025], lowered);
      handEuler[0] -= lowered * 0.95; gearVisible = progress < 0.78; gearScale = 1 - windowed(progress, 0.55, 0.8);
    }
    const reload = state.reloading || activeAction && kind === 'reload';
    if (reload) {
      const u = clamp(finite(state.reloadProgress, progress), 0, 1), raise = pulse(u);
      right = mix(right, [0.15, 1.13, -0.25], raise);
      handEuler = [pitch * 0.12 + raise * 0.15, 0, raise * (gear === 'pistol' ? -0.24 : -0.12)];
      const withdraw = windowed(u, 0.14, 0.36) * (1 - windowed(u, 0.56, 0.82));
      left = mix(add(right, [-0.055, -0.09, 0.015]), [-0.20, 0.91, -0.13], withdraw);
      magazine = withdraw;
      if (gear === 'shotgun') { breakOpen = pulse(clamp((u - 0.08) / 0.82, 0, 1)); left = mix(left, add(right, [-0.05, -0.09, -0.10]), raise * 0.65); }
      if (gear === 'bolt') { bolt = pulse(clamp((u - 0.18) / 0.58, 0, 1)); left = mix(left, add(right, [-0.03, 0.075, -0.08]), raise * 0.7); }
    } else if (gear === 'bolt' && shotAge > 0.13 && shotAge < 0.85) bolt = pulse((shotAge - 0.13) / 0.72);
  } else if (isPhone) {
    right = [0.15, 1.15, -0.32]; handEuler = [-0.12, -0.10, 0.06]; headPitch = clamp(pitch * 0.65 - 0.34, -0.85, 0.55);
    if (activeAction && selfUse && (kind === 'use' || kind === 'page')) {
      tap = Math.sin(progress * Math.PI * 3) ** 2 * actionWave;
      left = mix(left, [0.10, 1.21, -0.295 - tap * 0.024], actionWave); leftEuler = [0, 0.05, -0.35];
    }
  } else if (isPaper) {
    right = [0.20, 1.13, -0.32]; left = [-0.20, 1.13, -0.32]; handEuler = [-0.12, 0, 0]; leftEuler = [-0.12, 0, 0]; headPitch = clamp(pitch * 0.65 - 0.30, -0.85, 0.55);
    if (activeAction && selfUse && (kind === 'page' || kind === 'use')) {
      page = smooth(progress); left = mix(left, [0.03 - page * 0.2, 1.19, -0.31], actionWave);
    }
  }
  if (partyItem) {
    right = [0.19, 1.12, -0.29]; handEuler = [0, 0, 0.08];
    if (activeAction && ['sip', 'puff'].includes(kind)) {
      const drink = windowed(progress, 0, 0.22) * (1 - windowed(progress, 0.72, 1));
      right = mix(right, [0.075, 1.51, -0.21], drink);
      handEuler = [drink * (drinkItem ? 1.65 : 0.3), 0, 0.08];
      headPitch -= drink * (drinkItem ? 0.23 : 0.04);
    }
  }
  if (activeAction && kind === 'throw') {
    right = mix([0.22, 1.45, 0.13], [0.13, 1.32, -0.57], windowed(progress, 0.1, 0.7));
    handEuler = [-progress * 1.4, 0, 0]; gearVisible = progress < 0.3;
  } else if (activeAction && (kind === 'pickup' || kind === 'drop')) {
    const holding = [...right];
    const target = Array.isArray(state.interactionTarget) && state.interactionTarget.length === 3 ? state.interactionTarget.map((v, i) => finite(v, holding[i])) : [0.15, 1.0, -0.47];
    if (kind === 'pickup') {
      const grasp = windowed(progress, 0.32, 0.85);
      right = mix(target, holding, grasp); gearScale *= windowed(progress, 0.24, 0.45);
      if (isPaper || isController) left = mix([-0.18, 0.98, -0.1], left, grasp);
    } else {
      right = mix(holding, target, windowed(progress, 0.05, 0.65));
      gearVisible = progress < 0.65; gearScale *= 1 - windowed(progress, 0.52, 0.68);
      left = mix(left, [-0.18, 0.94, -0.02], progress);
    }
    headPitch = lerp(headPitch, -0.42, actionWave * 0.7);
  } else if (activeAction && kind === 'use' && !selfUse) {
    const target = Array.isArray(state.interactionTarget) ? state.interactionTarget : [0.17, 1.36, -0.49];
    if (weapon || isPhone || isPaper) {
      left = mix(left, target, actionWave); leftEuler = [pitch * 0.25, 0, -0.15];
      if (weapon) { right = mix(right, [0.18, 1.05, -0.20], actionWave * 0.8); handEuler[0] -= actionWave * 0.45; }
    } else right = mix(right, target, actionWave);
    headPitch = lerp(headPitch, clamp(pitch * 0.8, -0.8, 0.8), actionWave);
  }
  const leftArm = solveArm(-1, left), rightArm = solveArm(1, right);
  const headYaw = reclined ? 0.7 : 1.2;
  if (reclined) headPitch = clamp(headPitch + 0.15, -0.1, 0.35);
  return { body: { y: offsetY, pitch: bodyPitch, roll: bodyRoll }, head: { pitch: headPitch, yaw: clamp(finite(state.aimYaw), -headYaw, headYaw) },
    legs: { left: leftLeg, right: rightLeg }, arms: { left: leftArm, right: rightArm }, hands: { left: leftEuler, right: handEuler },
    gear: { kind: gear, visible: gearVisible && gearScale > 0.001, scale: gearScale, page, tap, magazine, bolt, breakOpen,
      muzzle: !!weapon && shotAge < 0.075, recoil },
    action: { kind, elapsed, duration, progress, active: activeAction }, grounded, seated };
}
