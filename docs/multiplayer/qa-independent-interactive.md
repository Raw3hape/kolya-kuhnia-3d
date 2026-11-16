# Independent interactive acceptance — 2026-11-17

Scope: fridge drinks, permanent room litter, generic handoff, ten RC cars.
Independent protocol, physics and avatar receipt below; rendered end-to-end and
release verification are owned by the integrator.

## Highest-value checks

1. One item / one owner. Stale donor, non-owner, self, missing/disconnected
   recipient, full recipient and recipient behind a wall must all fail without
   dropping or replacing either player's item. Test phone and consumed drink.
2. Five accepted sips, one per deliberate press; spam/cooldown, seating,
   handoff during animation, empty bottle, squeeze-before-empty and rapid throw.
   Effects belong to the player who drank, expire and reset across room changes.
3. Broken beer and crushed energy bottle stay at their accepted landing point
   after the old respawn/particle deadlines and appear for a late joiner. Fixed
   original inventory bounds permanent litter; no accumulating respawn loop.
4. Ten players get distinct controllers, car designs and colors; player eleven
   remains rejected by existing room capacity. Driving locks the body at both
   authoritative and predicted input boundaries. Exit, release, disconnect,
   destruction, handoff, editing and room exit restore controls without held keys.
5. Guests send input intent only. They cannot set HP, car transforms, item
   ownership, effects, sip count or controller availability. Shots obey the
   existing closest-hit/occlusion rules before reducing car HP.
6. Browser proof includes a normal keyboard/mouse interaction and mobile controls,
   actual rendered fridge/labels/car variation, late-join multiplayer state and
   no page errors. Unit tests alone are not full end-to-end or cross-network proof.

## Commands and execution receipt

- `node --test tests/interactive-authority-independent.test.mjs`: independent
  public authority-wire checks (no private maps / no custom implementation hooks),
  **13/13 passed**. Includes ten clients / distinct RC designs and colors / eleventh
  rejection, forged and stale transfers, barriers, seating, permanent beer and
  energy litter, five sips, crush, boost ownership and expiry, late join, RC body
  lock, driver handoff, disconnect, trusted shot occlusion, forged damage and replay,
  active-car recovery without healing, and hookah handoff within the physical hose.
- `node --test tools/tests/rc-independent.test.mjs`: **1/1 passed**; renewed input
  accelerates, stale input stops acceleration and neutralizes steering, brakes
  slow the car, reset recovers a pitched chassis, steering turns and the arena
  bounds hold. This is deterministic physics evidence, not browser latency proof.
- `node --test tools/tests/avatar-animation.test.mjs`: **11/11 passed**; includes
  energy sip pose and two-hand controller grip, with one prop renderer per family.
- `node --test tools/tests/carry-coordinator.test.mjs`: **5/5 passed**; future solo
  item families register their ownership/release adapter once, rapid pickups
  serialize, failed releases deny admission, and cancellation cannot resume a stale
  acquisition. The room authority remains the multiplayer admission boundary.
- `npm test`, `npm run build`: repository regression gates; final execution owned
  by the integrator.
- No helper, browser, server or renderer was started by the independent reviewer.

Review found and the integrator fixed handoff through dynamic collision barriers
and controller transfer to a seated recipient. The reviewer added energy/controller
pose support and a shared external-prop registry after the integrator identified
the missing avatar cases; gameplay adapters retain ownership of the actual meshes.

## Limits that must remain explicit

Persistent litter means the lifetime of the current authority room or saved solo
simulation. Closing the hosting browser is already a room lifecycle boundary;
there is no existing persistent server or authenticated room restoration.
Zero delay on every network is not a testable guarantee. Record observed local
WebRTC behavior separately from real remote-network tests and NAT traversal.
