// Metres, body-local coordinates. The authority owns the unchanged capsule/collisions.
export const AVATAR_RIG = Object.freeze({
  hipY: 0.84, hipX: 0.103, shoulderY: 1.37, shoulderX: 0.18, neckY: 1.44,
  upperArm: 0.25, forearm: 0.245, upperLeg: 0.36, lowerLeg: 0.36, ankleY: 0.12,
});
export const WEAPON_PRESENTATION = Object.freeze({
  pistol: Object.freeze({ length: 0.23, right: [0.17, 1.14, -0.28], aimed: [0.1, 1.47, -0.41], support: [-0.06, -0.015, 0.01], recoil: 1 }),
  rifle: Object.freeze({ length: 0.52, right: [0.16, 1.19, -0.25], aimed: [0.12, 1.44, -0.25], support: [-0.09, 0.025, -0.17], recoil: 0.7 }),
  bolt: Object.freeze({ length: 0.67, right: [0.16, 1.19, -0.25], aimed: [0.12, 1.45, -0.25], support: [-0.09, 0.025, -0.17], recoil: 1.4 }),
  shotgun: Object.freeze({ length: 0.52, right: [0.16, 1.18, -0.25], aimed: [0.12, 1.43, -0.25], support: [-0.09, 0.025, -0.17], recoil: 1.7 }),
});
