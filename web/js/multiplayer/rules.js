// Shared gameplay limits. Imported by both the browser and the room authority.
export const NETWORK_RULES = Object.freeze({
  version: 4, maxPlayers: 10, tickHz: 60, snapshotHz: 20,
  inputHz: 20, interpolationMs: 100, staleMs: 3000,
  heartbeatMs: 1500, timeoutMs: 6500, resumeMs: 60000,
  maxMessageBytes: 192000, maxObjects: 4096, maxEffects: 192,
  maxEffectsBytes: 32768, maxAmbientBytes: 32768,
  maxInputBatch: 12, maxInputDt: 0.05, inputBudget: 0.16,
  maxCollisionBoxes: 1024, maxRays: 9, maxEffectsPerRay: 16,
  itemReach: 2.4, doorReach: 2.5, hoodReach: 2.9, originTolerance: 0.8,
  roomIdleMs: 86400000, maxRoomMs: 21600000,
});

export const WEAPON_RULES = Object.freeze({
  none: Object.freeze({}),
  pistol: Object.freeze({ rate: 6, mag: 12, reserve: 48, infiniteReserve: true, reload: 1.7, pellets: 1, damage: 34, range: 150 }),
  rifle: Object.freeze({ rate: 10, mag: 30, reserve: 120, infiniteReserve: true, reload: 2.3, pellets: 1, damage: 28, range: 400 }),
  bolt: Object.freeze({ rate: 1.5, mag: 5, reserve: 30, infiniteReserve: true, reload: 2.6, cycle: 0.8, pellets: 1, damage: 120, range: 800 }),
  shotgun: Object.freeze({ rate: 4, mag: 2, reserve: 24, infiniteReserve: true, reload: 2, pellets: 9, damage: 14, range: 70 }),
});

// Keep wire values finite; unlimited supply is a rule, not JSON Infinity/null.
export function refillMagazine(ammo, rule) {
  const missing = Math.max(0, rule.mag - ammo.mag);
  const amount = rule.infiniteReserve ? missing : Math.min(missing, ammo.reserve);
  ammo.mag += amount;
  if (!rule.infiniteReserve) ammo.reserve -= amount;
}

export const EXTERNAL_TARGET_RULES = Object.freeze({
  mouse: Object.freeze({ points: 300, runningMultiplier: 1.25, killable: true }),
  monster: Object.freeze({ points: 0, runningMultiplier: 1, killable: false }),
});
