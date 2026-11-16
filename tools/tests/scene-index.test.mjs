import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { acquireSceneIndex } from '../../web/js/scene-index.js';

const stockLights = scene => { const lights = []; scene.traverse(o=>{if(o.isLight)lights.push(o);}); return lights; };
test('indexed lights retain the renderer traversal order across nested loads, removals and reparenting', () => {
  const scene=new THREE.Scene(), a=new THREE.Group(), b=new THREE.Group(), l1=new THREE.SpotLight(), l2=new THREE.PointLight();
  a.add(l1); b.add(l2); scene.add(a,b);
  const index=acquireSceneIndex(scene);
  assert.deepEqual(index.lights(),stockLights(scene));
  const nested=new THREE.Group(), l3=new THREE.DirectionalLight();nested.add(l3);a.add(nested);
  assert.deepEqual(index.lights(),stockLights(scene));
  b.add(l1); assert.deepEqual(index.lights(),stockLights(scene));
  scene.remove(a); assert.deepEqual(index.lights(),stockLights(scene));
  scene.add(a); assert.deepEqual(index.lights(),stockLights(scene));
  index.release();
});
test('material reference replacement and array mutation are detected without structural events', async () => {
  const scene=new THREE.Scene(), a=new THREE.MeshStandardMaterial(), b=new THREE.MeshStandardMaterial(), c=new THREE.MeshStandardMaterial();
  const m=new THREE.Mesh(new THREE.BoxGeometry(),[a,b]);scene.add(m);const index=acquireSceneIndex(scene);
  assert.deepEqual([...index.materials()],[a,b]);
  await Promise.resolve();m.material[1]=c; assert.deepEqual([...index.materials()],[a,c]);
  await Promise.resolve();m.material=b;assert.deepEqual([...index.materials()],[b]);
  scene.remove(m);assert.equal(index.materials().size,0);
  index.release();m.geometry.dispose();a.dispose();b.dispose();c.dispose();
});
test('visibility and shadow order match traverseVisible after dynamic ancestor and layer changes', () => {
  const scene=new THREE.Scene(), group=new THREE.Group(), mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()), light=new THREE.PointLight();
  mesh.castShadow=light.castShadow=true;group.add(mesh,light);scene.add(group);const index=acquireSceneIndex(scene);
  const actual=()=>index.shadowObjects().filter(o=>o.castShadow&&index.visible(o));
  const expected=()=>{const a=[];scene.traverseVisible(o=>{if(o.castShadow&&(o.isMesh||o.isLight))a.push(o);});return a;};
  assert.deepEqual(actual(),expected());group.visible=false;assert.deepEqual(actual(),expected());
  group.visible=true;mesh.layers.set(1);assert.deepEqual(actual(),expected());
  mesh.castShadow=false;assert.deepEqual(actual(),expected());index.release();mesh.geometry.dispose();mesh.material.dispose();
});
test('owners share one index and its listeners are released only after the final owner', () => {
  const scene=new THREE.Scene(), group=new THREE.Group();scene.add(group);
  const a=acquireSceneIndex(scene),b=acquireSceneIndex(scene);assert.equal(scene._listeners.childadded.length,1);
  a.release();a.release();assert.equal(scene._listeners.childadded.length,1);
  b.release();assert.equal(scene._listeners.childadded.length,0);assert.equal(group._listeners.childremoved.length,0);
  const c=acquireSceneIndex(scene);assert.equal(scene._listeners.childadded.length,1);c.release();
});
