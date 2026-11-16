// Domestic PBR props authored in Blender. One asset library, shared geometry and
// textures; each breakable unit keeps an independent stable network identity.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assignNetworkObjectIds } from './network-objects.js';
import { assetUrl, retry, track } from './loading.js';

export async function createPartyProps({ THREE, scene, requestRender = () => {}, spec = null }) {
  const layout = spec ?? await retry(() => fetch('spec/party-props.json').then(r => { if (!r.ok) throw Error('party_props_config'); return r.json(); }));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const library = await track(retry(() => loader.loadAsync(assetUrl(layout.library))), { label: 'Посуда и бытовые вещи', url: layout.library, later: true });
  const root = new THREE.Group(); root.name = 'party_props';
  const holders = [], resources = new Set();
  library.scene.traverse(o => {
    if (!o.isMesh) return;
    resources.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      resources.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const item of layout.items) {
    const source = library.scene.getObjectByName(item.kind);
    if (!source) { for (const r of resources) r.dispose?.(); throw Error('party_prop_template:' + item.kind); }
    const holder = new THREE.Group(); holder.name = 'party_' + item.id;
    const unit = source.clone(true); unit.name = 'target_' + item.id;
    unit.userData.breakable = item.material;
    unit.scale.multiplyScalar(item.scale ?? 1);
    unit.traverse(o => { if (o.isMesh) { o.castShadow = !o.material?.transparent; o.receiveShadow = true; } });
    holder.add(unit); assignNetworkObjectIds(unit, 'party-prop:' + item.id);
    holders.push({ item, holder, unit }); root.add(holder);
  }
  library.scene.clear();
  scene.add(root);
  function updateAnchors(anchors, state = {}) {
    let changed = false;
    for (const { item, holder } of holders) {
      const a = item.anchor && anchors?.[item.anchor];
      let [x, y, z] = item.pos, yaw = (item.yaw ?? 0) * Math.PI / 180;
      if (a?.cur && a?.def) {
        const dx = x - a.def.x, dz = z - a.def.z, angle = a.cur.r - a.def.r, c = Math.cos(angle), s = Math.sin(angle);
        x = a.cur.x + dx * c + dz * s; z = a.cur.z - dx * s + dz * c; y += a.cur.y - a.def.y; yaw += angle;
      }
      const shown = a !== null && !(item.when && !item.when.values.includes(state[item.when.key])) &&
        !(a?.span && (z < a.span.z0 + 0.08 || z > a.span.z1 - 0.08));
      if (holder.position.x !== x || holder.position.y !== y || holder.position.z !== z || holder.rotation.y !== yaw || holder.visible !== shown) {
        holder.position.set(x, y, z); holder.rotation.y = yaw; holder.visible = shown; changed = true;
      }
    }
    if (changed) requestRender();
  }
  updateAnchors();
  return { updateAnchors,
    interactionPoint(id) { const o=holders.find(h=>h.item.id===id)?.unit; if(!o)return null;o.updateWorldMatrix(true,true);return new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).toArray(); },
    debug: { root, holders, count: holders.length, library: layout.library },
    dispose() {
      root.removeFromParent();
      for (const resource of resources) { resource.dispose?.(); if (resource.isTexture) resource.source?.data?.close?.(); }
      resources.clear(); root.clear(); holders.length = 0;
    }
  };
}
