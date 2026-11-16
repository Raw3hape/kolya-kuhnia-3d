// Pause local wildlife without cloning its cyclic flock/group relationships.
// The renderer reuses the same animals for authoritative poses; leaving a room
// must restore their original affiliations and remove network-only fields.
export function captureLocalWildlife(animals, clock) {
  return { animals: animals.map(animal => [animal, { ...animal }]), clock: { ...clock } };
}

export function restoreLocalWildlife(saved) {
  if (!saved) return null;
  for (const [animal, state] of saved.animals) {
    for (const key of Object.keys(animal)) if (!Object.hasOwn(state, key)) delete animal[key];
    Object.assign(animal, state);
  }
  return saved.clock;
}
