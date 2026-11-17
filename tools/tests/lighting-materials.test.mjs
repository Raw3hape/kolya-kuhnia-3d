import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { acquireSceneIndex } from '../../web/js/scene-index.js';
import { createMaterialPatchPass } from '../../web/js/lighting-materials.js';

test('lighting skips steady patch visits while polling late materials and mutable slots before drawing', async () => {
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),a=new THREE.MeshStandardMaterial(),b=new THREE.MeshLambertMaterial(),c=new THREE.MeshPhongMaterial();
  const mesh=new THREE.Mesh(geometry,a);scene.add(mesh);const index=acquireSceneIndex(scene),visits=[];
  const patch=createMaterialPatchPass(index,material=>{visits.push(material);material.userData.roomLightingPatched=true;});
  try{
    assert.equal(patch(),true);assert.deepEqual(visits,[a]);
    a.color.set('#654321');a.needsUpdate=true;const version=a.version;
    for(let i=0;i<20;i++){await Promise.resolve();assert.equal(patch(),false);}
    assert.deepEqual(visits,[a]);assert.equal(a.version,version);assert.equal(a.color.getHexString(),'654321');
    await Promise.resolve();mesh.material=[a,b];assert.equal(patch(),true);
    assert.equal(b.userData.roomLightingPatched,true);
    mesh.material[1]=c;assert.equal(patch(true),true);assert.equal(c.userData.roomLightingPatched,true);
    const count=visits.length;assert.equal(patch(true),false);assert.equal(visits.length,count);
    const late=new THREE.Mesh(geometry,b);scene.add(late);assert.equal(patch(),true);
    assert.deepEqual(visits.slice(-3),[a,c,b]);
  }finally{index.release();geometry.dispose();a.dispose();b.dispose();c.dispose();}
});

test('a failed patch pass is retried at the same membership revision', () => {
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  scene.add(new THREE.Mesh(geometry,material));const index=acquireSceneIndex(scene);let attempts=0;
  const patch=createMaterialPatchPass(index,()=>{if(++attempts===1)throw Error('patch failed');});
  try{
    assert.throws(()=>patch(),/patch failed/);const revision=index.materialsRevision;
    assert.equal(patch(),true);assert.equal(attempts,2);assert.equal(index.materialsRevision,revision);
    assert.equal(patch(),false);assert.equal(attempts,2);
  }finally{index.release();geometry.dispose();material.dispose();}
});
