// Shared route selection. Closing the entrance renews the draw; repeated
// snapshots and opening the leaf do not consume randomness.
import { seededRandom } from './network-objects.js';

export const DOOR_ENCOUNTERS = Object.freeze(['service', 'snow', 'courier']);

export function createDoorJourney(seed, modes) {
  const random = seededRandom(`entrance:${seed}`);
  let mode, destinationSeed, revision = -1;
  const bag = [];

  function reseed(override) {
    destinationSeed = override ?? Math.floor(random() * 0x100000000);
    revision++;
  }

  function close() {
    if (!bag.length) {
      bag.push(...modes);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    mode = bag.pop();
    reseed();
  }

  close();
  return { close, reseed, get route() { return { mode, seed: destinationSeed, revision }; } };
}
