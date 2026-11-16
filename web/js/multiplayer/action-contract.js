// Additive avatar state contract. All action timestamps use room simulation seconds.
// The authority creates cues only after accepting gameplay; renderers sample them, never request poses.
import { WEAPON_RULES } from './rules.js';

export const ACTION_DURATIONS = Object.freeze({
  draw: 0.35, holster: 0.35, fire: 0.15, reload: 0,
  pickup: 0.6, drop: 0.55, use: 0.55, page: 0.5, sip: 1.05, puff: 2.6, throw: 0.55,
  sit: 0.5, stand: 0.45, jump: 0.35, land: 0.22,
});
const clamp = (value, a, b) => Math.max(a, Math.min(b, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function actionDuration(kind, weapon = 'none') {
  const rule = Object.hasOwn(WEAPON_RULES, weapon) ? WEAPON_RULES[weapon] : null;
  if (kind === 'reload') return rule?.reload || 0;
  if (kind === 'fire') return Math.max(ACTION_DURATIONS.fire, rule?.cycle || 0, rule?.rate ? 1 / rule.rate : 0);
  return Object.hasOwn(ACTION_DURATIONS, kind) ? ACTION_DURATIONS[kind] : 0;
}

export function makeAvatarAction(kind, at, { weapon, targetId, target } = {}) {
  const duration = actionDuration(kind, weapon);
  if (!duration || !Number.isFinite(at)) return null;
  return { kind, at, duration,
    ...(typeof targetId === 'string' ? { targetId } : {}),
    ...(Array.isArray(target) && target.length === 3 && target.every(Number.isFinite) ? { target: [...target] } : {}) };
}

// Discrete equipment/ownership changes must start with their action, rather than
// arriving one interpolation frame early and snapping back into the reach pose.
export function selectAvatarPresentation(before, after, roomTime, beforeTime, afterTime) {
  const future = before && before !== after && Number.isFinite(after.action?.at) && after.action.at > roomTime;
  return { player: future ? before : after, snapshotTime: future ? beforeTime : afterTime };
}

// actionTime is elapsed seconds, clamped to duration. The renderer obtains its phase by
// dividing actionTime / action.duration. Expired latest actions remain available for late join.
export function sampleAvatarAction(player, roomTime, snapshotTime = roomTime) {
  const time = Math.max(0, finite(roomTime)), at = finite(snapshotTime, time), offset = time - at;
  const cue = player.action;
  const action = cue && Object.hasOwn(ACTION_DURATIONS, cue.kind) && Number.isFinite(cue.at) &&
    Number.isFinite(cue.duration) && cue.duration > 0 && cue.at <= time ? cue : null;
  const actionTime = action ? clamp(time - action.at, 0, action.duration) : 0;
  const shotAt = Number.isFinite(player.shotAge) ? at - Math.max(0, player.shotAge) : null;
  const shotAge = shotAt !== null && shotAt <= time ? Math.max(0, time - shotAt) : null;
  const reloadDuration = actionDuration('reload', player.weapon);
  const progress = clamp(finite(player.reloadProgress) + (reloadDuration ? offset / reloadDuration : 0), 0, 1);
  // The next snapshot may already say "finished" while interpolation is still
  // before the reload end. Keep the accepted cue on its simulation-time boundary.
  const reloadCue = action?.kind === 'reload' && action.targetId === player.weapon;
  const cueProgress = reloadCue ? clamp((time - action.at) / action.duration, 0, 1) : 0;
  const reloading = reloadCue ? cueProgress < 1 : !!player.reloading && reloadDuration > 0 && progress < 1 &&
    time >= at - clamp(finite(player.reloadProgress), 0, 1) * reloadDuration;
  const interaction = action && actionTime < action.duration && ['pickup', 'drop', 'use', 'page', 'sip', 'puff', 'throw'].includes(action.kind) ? action : null;
  return { time, aiming: clamp(finite(player.aiming), 0, 1),
    grounded: typeof player.grounded === 'boolean' ? player.grounded : finite(player.y) <= 0.001 && finite(player.vy) <= 0,
    verticalSpeed: finite(player.verticalSpeed, finite(player.vy)), action, actionTime,
    reloading, reloadProgress: reloading ? reloadCue ? cueProgress : progress : 0, shotAge,
    shooting: shotAge !== null && shotAge < actionDuration('fire', player.weapon), interaction };
}
