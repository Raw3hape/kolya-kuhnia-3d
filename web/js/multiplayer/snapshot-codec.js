// Snapshot-only wire adapter: shared deflate work per host fanout and reliable history deltas.
// Events/results remain ordinary protocol objects. A missed base always falls back to a full frame.
import { NETWORK_RULES as R } from './rules.js';
const MAX_PLAIN_BYTES = R.maxMessageBytes * 16;
const encodeText = new TextEncoder(), decodeText = new TextDecoder();
async function pack(packet, compress) {
  if (!compress) return packet;
  const json = JSON.stringify(packet), plain = encodeText.encode(json);
  if (plain.byteLength < 768) return packet;
  const stream = new Blob([plain]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const wire = { type: 'snapshot-compressed', encoding: 'deflate', data: compressed.buffer };
  return compressed.byteLength + 72 < plain.byteLength ? wire : packet;
}

export function createSnapshotEncoder({ compress = typeof CompressionStream !== 'undefined' } = {}) {
  const cache = new Map(); let previous = null, hashes = {};
  return {
    prepare(packet) {
      if (cache.has(packet.seq)) return cache.get(packet.seq);
      const changed = {}, nextHashes = {}, before = previous, history = {};
      for (const [key, value] of Object.entries(packet)) {
        if (key === 'type' || key === 'seq') continue;
        const hash = JSON.stringify(value); nextHashes[key] = hash;
        if (!before || hashes[key] !== hash) {
          if (key === 'hunt' && before?.hunt && Array.isArray(value?.animals) && Array.isArray(before.hunt.animals)) {
            const oldAnimals = new Map(before.hunt.animals.map(animal => [animal.id, animal]));
            const add = [], change = [], order = value.animals.map(animal => animal.id);
            for (const animal of value.animals) {
              const old = oldAnimals.get(animal.id);
              if (!old) { add.push(animal); continue; }
              const fields = {};
              for (const [field, next] of Object.entries(animal)) if (!Object.is(next, old[field])) fields[field] = next;
              if (Object.keys(fields).length) change.push([animal.id, fields]);
            }
            const { animals, ...fields } = value;
            const sameOrder = order.length === before.hunt.animals.length && order.every((id, i) => before.hunt.animals[i].id === id);
            history.hunt = { fields, add, change, ...(!sameOrder ? { order } : {}) };
          } else if (key === 'effects' && before && Array.isArray(value) && Array.isArray(before.effects)) {
            const known = new Set(before.effects.map(effect => effect.id));
            history.effects = { ids: value.map(effect => effect.id), add: value.filter(effect => !known.has(effect.id)) };
          } else changed[key] = value;
        }
      }
      const delta = { type: 'snapshot-delta', seq: packet.seq, base: before?.seq ?? null, fields: changed, ...(Object.keys(history).length ? { history } : {}) };
      let fullPromise = null, deltaPromise = null;
      const result = { seq: packet.seq, base: before?.seq ?? null,
        full: () => fullPromise ||= pack(packet, compress), delta: () => deltaPromise ||= pack(delta, compress) };
      previous = packet; hashes = nextHashes; cache.set(packet.seq, result);
      if (cache.size > 4) cache.delete(cache.keys().next().value);
      return result;
    },
    clear() { cache.clear(); previous = null; hashes = {}; },
  };
}

export function createSnapshotDecoder() {
  let previous = null;
  return {
    async decode(packet) {
      if (packet?.type === 'snapshot-compressed') {
        if (packet.encoding !== 'deflate' || typeof DecompressionStream === 'undefined') throw new Error('Unsupported snapshot compression');
        if (!(packet.data instanceof ArrayBuffer) || packet.data.byteLength > MAX_PLAIN_BYTES) throw new Error('Snapshot exceeds wire limit');
        const stream = new Blob([packet.data]).stream().pipeThrough(new DecompressionStream('deflate'));
        const reader = stream.getReader(), parts = []; let total = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            total += value.byteLength;
            if (total > MAX_PLAIN_BYTES) throw new Error('Snapshot exceeds decoded limit');
            parts.push(value);
          }
        } finally { await reader.cancel(); }
        const plain = new Uint8Array(total); let offset = 0;
        for (const part of parts) { plain.set(part, offset); offset += part.byteLength; }
        packet = JSON.parse(decodeText.decode(plain));
      }
      if (packet?.type === 'snapshot-delta') {
        if (!previous || previous.seq !== packet.base) throw new Error('Snapshot base mismatch');
        const next = { ...previous, ...packet.fields, type: 'snapshot', seq: packet.seq };
        if (packet.history?.effects) {
          const effectMap = new Map((previous.effects || []).map(effect => [effect.id, effect]));
          for (const effect of packet.history.effects.add) effectMap.set(effect.id, effect);
          next.effects = packet.history.effects.ids.map(id => {
            const effect = effectMap.get(id); if (!effect) throw new Error('Snapshot history gap'); return effect;
          });
        }
        if (packet.history?.hunt) {
          const patch = packet.history.hunt, animals = new Map((previous.hunt?.animals || []).map(animal => [animal.id, animal]));
          for (const animal of patch.add) animals.set(animal.id, animal);
          for (const [id, fields] of patch.change) {
            if (!animals.has(id)) throw new Error('Snapshot animal gap');
            animals.set(id, { ...animals.get(id), ...fields });
          }
          const order = patch.order || previous.hunt.animals.map(animal => animal.id);
          next.hunt = { ...previous.hunt, ...patch.fields, animals: order.map(id => {
            const animal = animals.get(id); if (!animal) throw new Error('Snapshot animal gap'); return animal;
          }) };
        }
        packet = next;
      }
      if (packet?.type === 'snapshot') previous = packet;
      // Welcome establishes a full baseline, but ordinary peer channels also support uncompressed packets.
      if (packet?.type === 'welcome' && packet.snapshot) previous = packet.snapshot;
      return packet;
    },
    clear() { previous = null; },
  };
}
