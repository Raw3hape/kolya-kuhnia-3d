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
test('material membership revisions ignore live properties, duplicate references and reordered arrays', () => {
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),a=new THREE.MeshStandardMaterial(),b=new THREE.MeshStandardMaterial(),c=new THREE.MeshStandardMaterial();
  const mesh=new THREE.Mesh(geometry,[a,b,a]);scene.add(mesh);const index=acquireSceneIndex(scene);
  try{
    const collection=index.materials(),initial=index.materialsRevision;
    assert.ok(initial>0);
    a.color.set('#124578');a.roughness=.13;a.needsUpdate=true;
    assert.equal(index.materials(true),collection);assert.equal(index.materialsRevision,initial);
    mesh.material=[b,a];index.materials(true);
    assert.deepEqual([...collection],[b,a]);assert.equal(index.materialsRevision,initial);
    const duplicate=new THREE.Mesh(geometry,a);scene.add(duplicate);index.materials();
    assert.equal(index.materialsRevision,initial,'adding an owner of the same material is not a membership edit');
    const late=new THREE.Mesh(geometry,c);scene.add(late);index.materials();assert.equal(index.materialsRevision,initial+1);
    late.removeFromParent();index.materials();assert.equal(index.materialsRevision,initial+2);
    mesh.removeFromParent();index.materials();assert.deepEqual([...collection],[a]);assert.equal(index.materialsRevision,initial+3);
  }finally{index.release();geometry.dispose();a.dispose();b.dispose();c.dispose();}
});
test('forced reference polling detects multiple same-turn swaps while unchanged refreshes keep the material revision stable', () => {
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),a=new THREE.MeshBasicMaterial(),b=new THREE.MeshBasicMaterial(),c=new THREE.MeshBasicMaterial();
  const mesh=new THREE.Mesh(geometry,a);scene.add(mesh);const index=acquireSceneIndex(scene);
  try{
    index.materials();const initial=index.materialsRevision,structure=index.revision;
    mesh.material=c;assert.deepEqual([...index.materials()],[a],'ordinary reads share the existing microtask cache');
    assert.deepEqual([...index.materials(true)],[c]);assert.equal(index.materialsRevision,initial+1);
    mesh.material=[a,c];index.materials(true);assert.equal(index.materialsRevision,initial+2);
    mesh.material[1]=b;index.materials(true);assert.equal(index.materialsRevision,initial+3);
    for(let i=0;i<10;i++)index.materials(true);
    assert.equal(index.materialsRevision,initial+3);assert.equal(index.revision,structure);
  }finally{index.release();geometry.dispose();a.dispose();b.dispose();c.dispose();}
});
test('owners share material revisions across async loads and only final disposal clears the shared collection', async () => {
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),lateMaterial=new THREE.MeshLambertMaterial();
  scene.add(new THREE.Mesh(geometry,material));const a=acquireSceneIndex(scene),b=acquireSceneIndex(scene);
  try{
    const collection=a.materials(),initial=a.materialsRevision;
    assert.equal(b.materials(),collection);assert.equal(b.materialsRevision,initial);
    a.release();assert.deepEqual([...b.materials()],[material]);assert.equal(b.materialsRevision,initial);
    await Promise.resolve();scene.add(new THREE.Mesh(geometry,lateMaterial));b.materials();
    assert.equal(b.materialsRevision,initial+1);assert.equal(a.materialsRevision,b.materialsRevision);
    b.release();assert.equal(collection.size,0);assert.equal(b.materialsRevision,initial+2);
    b.release();assert.equal(b.materialsRevision,initial+2);
    assert.equal(scene._listeners.childadded.length,0);
  }finally{a.release();b.release();geometry.dispose();material.dispose();lateMaterial.dispose();}
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
