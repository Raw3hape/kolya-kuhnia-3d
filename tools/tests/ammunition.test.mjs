import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_RULES, refillMagazine } from '../../web/js/multiplayer/rules.js';

test('unlimited supply refills every weapon even from an old zero-reserve state', () => {
  for (const rule of Object.values(WEAPON_RULES)) {
    if (!rule.mag) continue;
    const ammo = { mag: 0, reserve: 0 };
    for (let n = 0; n < 100; n++) {
      refillMagazine(ammo, rule); assert.equal(ammo.mag, rule.mag); assert.equal(ammo.reserve, 0);
      assert.equal(JSON.parse(JSON.stringify(ammo)).mag, rule.mag); ammo.mag = 0;
    }
  }
});
