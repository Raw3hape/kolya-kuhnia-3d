// Adjacent box faces with the same material AND interaction slot need one draw.
// Keep the first material index: raycast faceSlots still resolves to that slot.
// Vertex/index data and triangle ordering, used by network hits, stay untouched.
export function compactMaterialGroups(geometry, materials, slots) {
  if (!Array.isArray(materials) || !slots) return;
  const groups = [];
  for (const group of geometry.groups) {
    const last = groups.at(-1), a = last?.materialIndex, b = group.materialIndex;
    if (last && last.start + last.count === group.start && materials[a] === materials[b] && slots[a] === slots[b]) last.count += group.count;
    else groups.push({ ...group });
  }
  geometry.groups = groups;
}
