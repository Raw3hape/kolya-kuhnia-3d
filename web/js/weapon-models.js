import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const MODELS = new URL('../models/viewmodel/', import.meta.url);
const SOFT = /shirt|skin|glove|wood|plastic|bakelite|shellred|white|primary/i;
let loader;

export async function loadWeaponModel(T, weapon, aim) {
  if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(new URL(weapon.file, MODELS).href);
  const root = gltf.scene;
  root.traverse(object => {
    if (!object.isMesh) return;
    object.frustumCulled = false;
    const material = object.material;
    material.metalness = SOFT.test(material.name) ? 0 : Math.min(material.metalness, 0.3);
    material.roughness = Math.max(material.roughness, 0.45);
  });
  const mixer = new T.AnimationMixer(root), acts = {};
  for (const clip of gltf.animations) {
    const action = acts[clip.name] = mixer.clipAction(clip);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = action.paused = true;
    action.play();
  }
  const model = { root, mixer, acts };
  clipPose(model, 'idle', 0);
  root.updateMatrixWorld(true);
  const muzzle = model.muzzle = root.getObjectByName('muzzle');
  model.flash = new T.Group();
  model.flash.scale.setScalar(1 / muzzle.getWorldScale(new T.Vector3()).x);
  muzzle.add(model.flash);
  model.ads = aim.eyePose(weapon.ads.eye, root.getObjectByName('sight_rear').getWorldPosition(new T.Vector3()),
    root.getObjectByName('sight_front').getWorldPosition(new T.Vector3()),
    new T.Vector3(1, 0, 0).transformDirection(muzzle.matrixWorld));
  return model;
}

export function clipPose(model, name, progress) {
  const action = model.acts[name] ?? model.acts.idle;
  if (model.lastAction === action && model.lastProgress === progress) return;
  model.lastAction = action; model.lastProgress = progress;
  for (const clip of Object.values(model.acts)) clip.setEffectiveWeight(Number(clip === action));
  if (action) action.time = Math.min(Math.max(progress, 0), 0.999) * action.getClip().duration;
  model.mixer.update(0);
}

export function disposeWeaponModel(model) {
  model.root.removeFromParent();
  model.mixer.uncacheRoot(model.root);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  model.root.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    materials.add(object.material);
    for (const value of Object.values(object.material)) if (value?.isTexture) textures.add(value);
  });
  for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
}
