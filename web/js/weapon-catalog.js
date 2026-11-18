import { WEAPON_RULES } from './multiplayer/rules.js';

// pos — место спускового крючка (начало координат модели) в пространстве камеры рук (м): вправо, вверх, вперёд = −z;
// action: semi | auto | bolt (затвор после каждого выстрела — клип shoot за cycle с) | break (переломка).
// rate — выстрелов в секунду; mag/reserve — патронов в магазине и в запасе; reload — перезарядка (клип reload), с;
// shot — клип shoot на выстрел, с (если у модели он есть и это не затвор); reloadEv/cycleEv — звуки по ходу клипа:
// [доля времени, звук, 1 — в этот миг патроны в магазин]; damage — урон за попадание (одной пули, дробины);
// range — дальность, м; pellets — дробин в выстреле; loud — громкость для зверей 0–1.
// spread, рад: hip — от бедра, ads — в прицеле, move/run — добавка на ходу/бегом, bloom — рост за выстрел (в прицеле
//   × VM.adsBloom), max — потолок роста, recover — спад роста, рад/с. Отдача уводит взгляд (walk.kick), а не луч:
//   recoil up/side, рад (в прицеле × VM.adsRecoil), keep — доля, что остаётся (игрок возвращает прицел сам).
// kick — откат рук назад, м. ads: zoom — увеличение, time — подъём к глазу, с; eye — от глаза до целика, м.
export const WEAPONS = [
  { id: 'none', name: 'Нет' },
  { id: 'pistol', name: 'Пистолет', file: 'pistol.glb', pos: [0.1, -0.1, -0.36], action: 'semi', shot: 0.25, loud: 0.6,
    reloadEv: [[0.21, 'magOut'], [0.5, 'magIn', 1], [0.82, 'rack']],
    spread: { hip: 0.008, ads: 0.0012, move: 0.008, run: 0.025, bloom: 0.004, max: 0.012, recover: 0.06 },
    recoil: { up: 0.022, side: 0.006, keep: 0.2 }, kick: { back: 0.03 },
    ads: { zoom: 1.25, time: 0.16, eye: 0.36 },
    flash: 0.13, sound: { gain: 1, cutoff: 3200, decay: 0.16, thump: 150 } },
  { id: 'rifle', name: 'Автомат', file: 'rifle.glb', pos: [0.14, -0.17, -0.48], action: 'auto', shot: 0.1, loud: 0.8,
    reloadEv: [[0.25, 'magOut'], [0.46, 'magIn', 1], [0.75, 'rack']],
    spread: { hip: 0.01, ads: 0.0012, move: 0.012, run: 0.035, bloom: 0.0015, max: 0.006, recover: 0.03 },
    recoil: { up: 0.007, side: 0.004, keep: 0.25 }, kick: { back: 0.018 },
    ads: { zoom: 1.6, time: 0.22, eye: 0.34 },
    flash: 0.2, sound: { gain: 0.8, cutoff: 2400, decay: 0.12, thump: 110 } },
  { id: 'bolt', name: 'Винтовка', file: 'bolt.glb', pos: [0.14, -0.17, -0.46], action: 'bolt', loud: 1,
    reloadEv: [[0.15, 'boltUp'], [0.21, 'boltBack'], [0.35, 'clip'], [0.6, 'shell', 1], [0.76, 'boltFwd'], [0.81, 'boltDown']],
    cycleEv: [[0.35, 'boltUp'], [0.5, 'boltBack'], [0.7, 'boltFwd'], [0.8, 'boltDown']],
    spread: { hip: 0.012, ads: 0.0003, move: 0.02, run: 0.05, bloom: 0, max: 0, recover: 1 },
    recoil: { up: 0.05, side: 0.012, keep: 0.15 }, kick: { back: 0.05 },
    ads: { zoom: 2.4, time: 0.3, eye: 0.45 },
    flash: 0.24, sound: { gain: 1.2, cutoff: 2600, decay: 0.3, thump: 85 } },
  { id: 'shotgun', name: 'Двустволка', file: 'shotgun.glb', pos: [0.14, -0.17, -0.44], action: 'break', loud: 0.9,
    reloadEv: [[0.12, 'open'], [0.21, 'shell'], [0.6, 'shell', 1], [0.79, 'close']],
    spread: { hip: 0.03, ads: 0.022, move: 0.01, run: 0.02, bloom: 0, max: 0, recover: 1 },
    recoil: { up: 0.045, side: 0.015, keep: 0.2 }, kick: { back: 0.05 },
    ads: { zoom: 1.3, time: 0.22, eye: 0.5 },
    flash: 0.28, sound: { gain: 1.25, cutoff: 2000, decay: 0.28, thump: 75 } },
  { id: 'uzi', name: 'Uzi', file: 'uzi.glb', pos: [0.153, -0.174, -0.465], cant: -0.12, action: 'auto', shot: 0.08, loud: 0.72,
    reloadEv: [[0.25, 'magOut'], [0.62, 'magIn', 1], [0.84, 'rack']],
    spread: { hip: 0.015, ads: 0.002, move: 0.013, run: 0.034, bloom: 0.002, max: 0.014, recover: 0.06 },
    recoil: { up: 0.009, side: 0.005, keep: 0.22 }, kick: { back: 0.022 },
    ads: { zoom: 1.35, time: 0.18, eye: 0.35 },
    flash: 0.15, sound: { gain: 0.76, cutoff: 2800, decay: 0.11, thump: 135 } },
].map(w => ({ ...w, ...WEAPON_RULES[w.id] }));

export const weaponById = id => WEAPONS.find(w => w.id === id) || WEAPONS[0];
export const WEAPON_KEYS = Object.fromEntries(WEAPONS.flatMap((w, i) =>
  [[`Digit${i + 1}`, w.id], [`Numpad${i + 1}`, w.id]]));
export const DEFAULT_MAZE_WEAPON = 'rifle';
