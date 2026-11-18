import { AVATAR_ROSTER, createAvatar } from './multiplayer/avatars.js';
import { AVATAR_RIG as R } from './multiplayer/avatar-rig.js';
import { SAUNA_TOWELS, createSaunaTowelGeometry, createSaunaTowelSurface } from './sauna-towels.js';

const FIRST_PERSON_OFFSET = 0.12;

function validSlot(value, options) {
  return Number.isInteger(value) && value >= 0 && value < options.length ? value : 0;
}

export function createSaunaAvatars({ THREE: T, scene }) {
  const root = new T.Group();
  root.name = 'sauna_guests';
  scene.add(root);
  const avatars = new Map(), present = new Set();
  let surface, elapsed = 0, localTowel = null;

  function createGuest(slot, towelSlot, local) {
    surface ??= createSaunaTowelSurface(T);
    const avatar = createAvatar({ slot, showNameplate: false, sauna: true, showFace: !local });
    const wrap = new T.Mesh(createSaunaTowelGeometry(T, towelSlot), surface.material);
    wrap.name = 'sauna_waist_towel';
    wrap.position.y = R.hipY;
    avatar.root.getObjectByName('avatar_rig').add(wrap);
    if (avatar.definition.saunaWrapTop) {
      const upper = new T.Mesh(createSaunaTowelGeometry(T, towelSlot, true), surface.material);
      upper.name = 'sauna_upper_towel';
      if (local) upper.position.z = 0.044;
      avatar.root.getObjectByName('avatar_body').add(upper);
    }
    root.add(avatar.root);
    return { avatar, slot, towelSlot, local, wrap };
  }

  function update(players, { localId, dt, camera }) {
    elapsed += dt;
    present.clear();
    localTowel = null;
    for (const player of players) {
      const slot = validSlot(player.avatar, AVATAR_ROSTER), towelSlot = validSlot(player.towelSlot, SAUNA_TOWELS);
      const local = player.id === localId;
      present.add(player.id);
      let guest = avatars.get(player.id);
      if (!guest || guest.slot !== slot || guest.towelSlot !== towelSlot || local !== guest.local) {
        guest?.avatar.dispose();
        guest = createGuest(slot, towelSlot, local);
        avatars.set(player.id, guest);
      }
      const yaw = player.bodyYaw ?? player.yaw;
      const isLocalView = local && camera && Number.isFinite(player.eyeY);
      const offset = isLocalView ? FIRST_PERSON_OFFSET : 0;
      const { avatar } = guest;
      avatar.root.position.set(
        (isLocalView ? camera.position.x : player.x) + Math.sin(yaw) * offset,
        player.y + (isLocalView ? camera.position.y - player.eyeY : 0),
        (isLocalView ? camera.position.z : player.z) + Math.cos(yaw) * offset,
      );
      avatar.root.rotation.y = yaw;
      const seated = !!player.seat;
      const lounging = seated && player.pose === 'lounger';
      const aimYaw = Math.atan2(Math.sin(player.yaw - yaw), Math.cos(player.yaw - yaw));
      const pose = avatar.update({
        time: elapsed, speed: seated ? 0 : player.swimming ? player.speed * 0.51 : player.speed,
        aimPitch: player.pitch, aimYaw, swimming: player.swimming, seated, lounging, seatY: player.seatY,
      });
      // The first-person drape clears the chest from the eye line while the
      // full character silhouette stays physically centred for other guests.
      guest.wrap.position.z = isLocalView && !lounging ? seated ? -0.055 : -0.116 : 0;
      guest.wrap.rotation.x = isLocalView && !seated ? 0.31 : 0;
      guest.wrap.morphTargetInfluences[0] = lounging ? 0 : pose.seated;
      if (local) localTowel = towelSlot;
    }

    for (const [id, guest] of avatars) {
      if (present.has(id)) continue;
      guest.avatar.dispose();
      avatars.delete(id);
    }
  }

  return {
    update,
    get stats() { return { visible: avatars.size, localTowel, distinctTowels: new Set([...avatars.values()].map(guest => guest.towelSlot)).size }; },
    dispose() {
      for (const guest of avatars.values()) guest.avatar.dispose();
      avatars.clear(); root.removeFromParent(); surface?.dispose();
    },
  };
}
