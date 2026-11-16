// Three authored continuous grip meshes, shared GPU resources, no runtime skeletal work.
// createPartyHands() -> {ready, create(kind), spec, dispose()}. Await ready once.
// All grips already use the interactive prop's origin at its bottom, +Y up, metres.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl, retry, track } from './loading.js';

export function createPartyHands() {
  let source=null,spec=null,disposed=false;
  const templates=new Map();
  const loader=new GLTFLoader();
  const ready=retry(()=>fetch('spec/party-grips.json').then(r=>{if(!r.ok)throw Error('party_grips_config');return r.json();})).then(async recipe=>{
    spec=recipe;const url=assetUrl(recipe.asset);
    const gltf=await track(retry(()=>loader.loadAsync(url)),{label:'Руки и точные хваты',url});
    source=gltf.scene;
    for(const [kind,preset] of Object.entries(recipe.presets)) {
      const root=source.getObjectByName(preset.node);
      if(!root)throw Error('party_grip_missing:'+kind);
      templates.set(kind,root);
    }
    if(disposed)release();
  }).catch(error=>{release();throw error;});
  function release() {
    if(!source)return;
    const geometries=new Set(),materials=new Set(),textures=new Set();
    source.traverse(o=>{
      if(o.geometry)geometries.add(o.geometry);
      for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[]) {
        materials.add(m);
        for(const value of Object.values(m))if(value?.isTexture)textures.add(value);
      }
    });
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
    templates.clear();source=null;
  }
  return {
    ready,
    create(kind) {
      const template=templates.get(kind),preset=spec?.presets?.[kind];
      if(!template||disposed)throw Error('party_grip_not_ready:'+kind);
      const root=template.clone(true);root.name='party_hand_'+kind;
      root.position.fromArray(preset.position);root.rotation.fromArray([...preset.rotation,'XYZ']);root.scale.setScalar(preset.scale);
      root.userData.viewmodel=true;
      root.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;o.frustumCulled=false;}});
      return root;
    },
    get spec(){return spec;},
    dispose(){disposed=true;release();},
  };
}
