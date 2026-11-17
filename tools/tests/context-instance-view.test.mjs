import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { createContextInstanceView, markContextInstances } from '../../web/js/context-instance-view.js';

function camera(x = 0) { const c = new THREE.PerspectiveCamera(90,1,.1,50);c.position.x=x;c.updateMatrixWorld();return c; }
function fixture() {
  const scene=new THREE.Scene(), geometry=new THREE.BoxGeometry(), material=new THREE.MeshStandardMaterial();
  const mesh=new THREE.InstancedMesh(geometry,material,3), matrix=new THREE.Matrix4();
  for(let i=0;i<3;i++){mesh.setMatrixAt(i,matrix.makeTranslation([0,2,100][i],0,-5));mesh.setColorAt(i,new THREE.Color(i/4,.5,1));}
  geometry.setAttribute('aKeep',new THREE.InstancedBufferAttribute(new Uint8Array([11,122,233]),1,true));
  geometry.setAttribute('aOther',new THREE.InstancedBufferAttribute(new Int16Array([1,2,3,4,5,6]),2,false));
  mesh.userData.context=true;markContextInstances(mesh);scene.add(mesh);scene.updateMatrixWorld();
  const manager=createContextInstanceView({THREE,scene});
  const original={geometry,instanceMatrix:mesh.instanceMatrix,instanceColor:mesh.instanceColor,count:3,visible:true,before:mesh.onBeforeRender,after:mesh.onAfterRender,sphere:mesh.boundingSphere};
  const restored=()=>{assert.equal(mesh.geometry,geometry);assert.equal(mesh.instanceMatrix,original.instanceMatrix);assert.equal(mesh.instanceColor,original.instanceColor);assert.equal(mesh.count,3);assert.equal(mesh.visible,true);assert.equal(mesh.onBeforeRender,original.before);assert.equal(mesh.onAfterRender,original.after);assert.equal(mesh.boundingSphere,original.sphere);};
  return {scene,geometry,material,mesh,manager,original,restored,close(){manager.dispose();mesh.dispose();geometry.dispose();material.dispose();}};
}

test('camera views compact every instanced attribute before drawing and restore canonical geometry/count/buffers after errors',()=>{
  const f=fixture(),c=camera();
  try {
    f.manager.draw(c,()=>{
      assert.equal(f.mesh.count,2);assert.notEqual(f.mesh.geometry,f.geometry);
      assert.ok(f.mesh.boundingSphere.radius>40,'renderer sees canonical full bounds rather than caching a packed-camera subset');
      assert.notEqual(f.mesh.geometry.attributes.position,f.geometry.attributes.position);
      assert.equal(f.mesh.geometry.attributes.position.array,f.geometry.attributes.position.array,'read-only CPU vertex arrays are shared without sharing GPU attribute identity');
      assert.equal(f.mesh.geometry.attributes.instanceMatrix,f.mesh.instanceMatrix);assert.equal(f.mesh.geometry.attributes.instanceColor,f.mesh.instanceColor);
      assert.deepEqual([...f.mesh.geometry.attributes.aKeep.array.slice(0,2)],[11,122]);assert.equal(f.mesh.geometry.attributes.aKeep.normalized,true);
      assert.deepEqual([...f.mesh.geometry.attributes.aOther.array.slice(0,4)],[1,2,3,4]);
      assert.deepEqual([...f.mesh.instanceColor.array.slice(0,6)],[0,.5,1,.25,.5,1]);
    });f.restored();
    assert.throws(()=>f.manager.draw(c,()=>{throw Error('render failed');}),/render failed/);f.restored();
    f.manager.draw(camera(100),()=>{assert.equal(f.mesh.count,1);assert.equal(f.mesh.instanceMatrix.array[12],100);assert.equal(f.mesh.geometry.attributes.aKeep.array[0],233);});f.restored();
  }finally{f.close();}
});

test('nested mirrors select canonical originals even when the outer camera selected zero, then restore the outer packed view',()=>{
  const f=fixture();
  try{
    f.manager.draw(camera(200),()=>{
      const outerGeometry=f.mesh.geometry,outerMatrix=f.mesh.instanceMatrix;
      assert.equal(f.mesh.count,0);assert.equal(f.mesh.visible,false);
      f.manager.draw(camera(100),()=>{assert.equal(f.mesh.count,1);assert.equal(f.mesh.visible,true);assert.equal(f.mesh.geometry.attributes.aKeep.array[0],233);});
      assert.equal(f.mesh.count,0);assert.equal(f.mesh.visible,false);assert.equal(f.mesh.geometry,outerGeometry);assert.equal(f.mesh.instanceMatrix,outerMatrix);
      assert.throws(()=>f.manager.draw(camera(),()=>{assert.equal(f.mesh.count,2);throw Error('mirror failed');}),/mirror failed/);
      assert.equal(f.mesh.count,0);assert.equal(f.mesh.geometry,outerGeometry);
    });f.restored();assert.ok(f.manager.stats.cameras<=3);
  }finally{f.close();}
});

test('static cameras reuse packed buffers; seasonal attributes repack without rebuilding bounds or reallocating geometry',()=>{
  const f=fixture(),c=camera();let geometry,version;
  try{
    f.manager.draw(c,()=>{geometry=f.mesh.geometry;version=f.mesh.instanceMatrix.version;});const first=f.manager.stats;
    for(let i=0;i<20;i++)f.manager.draw(c,()=>{assert.equal(f.mesh.geometry,geometry);assert.equal(f.mesh.instanceMatrix.version,version);});
    assert.equal(f.manager.stats.builds,first.builds);assert.equal(f.manager.stats.selections,first.selections);
    f.geometry.attributes.aKeep.array[1]=254;f.geometry.attributes.aKeep.needsUpdate=true;
    f.manager.draw(c,()=>{assert.equal(f.mesh.geometry,geometry);assert.equal(f.mesh.geometry.attributes.aKeep.array[1],254);assert.ok(f.mesh.instanceMatrix.version>version);});
    assert.equal(f.manager.stats.builds,first.builds);assert.equal(f.manager.stats.selections,first.selections+1);
    f.mesh.setMatrixAt(2,new THREE.Matrix4().makeTranslation(-2,0,-5));f.mesh.instanceMatrix.needsUpdate=true;
    f.manager.draw(c,()=>assert.equal(f.mesh.count,3));assert.equal(f.manager.stats.builds,first.builds+1);
    let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
    f.geometry.attributes.position.setX(0,.75);f.geometry.attributes.position.needsUpdate=true;
    f.manager.draw(c,()=>assert.notEqual(f.mesh.geometry,geometry));assert.equal(disposed,1);f.restored();
  }finally{f.close();}
});

test('shadowcasters, unregistered custom shaders, unsupported instance divisors and later shader replacements stay authored',()=>{
  const f=fixture(),c=camera();
  const untouched=()=>f.manager.draw(c,()=>{assert.equal(f.mesh.geometry,f.geometry);assert.equal(f.mesh.count,3);});
  try{
    f.mesh.castShadow=true;untouched();f.mesh.castShadow=false;
    f.geometry.attributes.aKeep.meshPerAttribute=2;untouched();f.geometry.attributes.aKeep.meshPerAttribute=1;
    f.manager.draw(c,()=>assert.equal(f.mesh.count,2));
    f.material.onBeforeCompile=()=>{};untouched();
    const unknown=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.ShaderMaterial({vertexShader:'void main(){gl_Position=vec4(float(gl_InstanceID));}',fragmentShader:'void main(){gl_FragColor=vec4(1.);}'}),1);
    unknown.userData.rasterCullInstances=true;f.scene.add(unknown);
    f.manager.draw(c,()=>assert.equal(unknown.count,1));unknown.geometry.dispose();unknown.material.dispose();unknown.dispose();
  }finally{f.close();}
});

test('cached camera GPU geometry has a bounded lifecycle and never disposes authored source attributes',()=>{
  const f=fixture();let first,sourceDisposed=0,firstDisposed=0;
  f.geometry.addEventListener('dispose',()=>sourceDisposed++);
  try{
    f.manager.draw(camera(),()=>{first=f.mesh.geometry;first.addEventListener('dispose',()=>firstDisposed++);});
    for(let i=1;i<=3;i++)f.manager.draw(camera(i),()=>{});
    assert.equal(f.manager.stats.cameras,3);assert.equal(firstDisposed,1);assert.equal(sourceDisposed,0);
    f.mesh.removeFromParent();f.manager.draw(camera(),()=>{});assert.equal(f.manager.stats.sources,0);assert.equal(sourceDisposed,0);
    f.manager.dispose();f.manager.dispose();f.restored();
  }finally{f.close();}
});

test('sources removed during a draw release their GPU views only after the outer scope without another scene revision',()=>{
  for(const nested of [false,true]){
    const f=fixture();let disposed=0;
    try{
      f.manager.draw(camera(),()=>{
        const outer=f.mesh.geometry;outer.addEventListener('dispose',()=>disposed++);
        f.mesh.removeFromParent();
        if(nested)f.manager.draw(camera(100),()=>{
          assert.equal(disposed,0,'a nested refresh cannot dispose the active outer GPU view');
          assert.equal(f.manager.stats.sources,1);
        });
        assert.equal(f.mesh.geometry,outer);assert.equal(disposed,0);
      });
      f.restored();assert.equal(disposed,1);
      assert.equal(f.manager.stats.sources,0,'scope exit cleans the orphan without a later draw/revision');
      assert.equal(f.manager.stats.packedBytes,0);assert.equal(f.manager.stats.gpuBytesUpperBound,0);
    }finally{f.close();}
  }
});

test('source world transforms invalidate cached spheres while packed matrices remain canonical local transforms',()=>{
  const f=fixture(),c=camera(100);
  try{
    f.manager.draw(c,()=>assert.equal(f.mesh.count,1));const builds=f.manager.stats.builds;
    f.mesh.position.x=100;f.scene.updateMatrixWorld();
    f.manager.draw(c,()=>{assert.equal(f.mesh.count,2);assert.equal(f.mesh.instanceMatrix.array[12],0);assert.equal(f.mesh.instanceMatrix.array[28],2);});
    assert.equal(f.manager.stats.builds,builds+1);assert.equal(f.mesh.matrixWorld.elements[12],100);f.restored();
  }finally{f.close();}
});

test('canonically hidden context and hidden ancestors skip packing; memory diagnostics count owned instance arrays once',()=>{
  const f=fixture(),c=camera();
  try{
    f.mesh.visible=false;f.manager.draw(c,()=>assert.equal(f.mesh.geometry,f.geometry));assert.equal(f.manager.stats.selections,0);
    f.mesh.visible=true;f.manager.draw(c,()=>assert.equal(f.mesh.count,2));
    const stats=f.manager.stats,expected=f.original.instanceMatrix.array.byteLength+f.original.instanceColor.array.byteLength+f.geometry.attributes.aKeep.array.byteLength+f.geometry.attributes.aOther.array.byteLength;
    assert.equal(stats.packedBytes,expected);assert.ok(stats.gpuBytesUpperBound>stats.packedBytes);
    const parent=new THREE.Group();f.scene.add(parent);parent.add(f.mesh);parent.visible=false;
    f.manager.draw(c,()=>assert.equal(f.mesh.geometry,f.geometry));assert.equal(f.manager.stats.selections,stats.selections);
    parent.visible=true;f.manager.draw(c,()=>assert.equal(f.mesh.count,2));f.restored();
    f.manager.dispose();assert.equal(f.manager.stats.packedBytes,0);assert.equal(f.manager.stats.gpuBytesUpperBound,0);
  }finally{f.close();}
});

test('original probe callbacks see scoped counts and restore them without changing canonical source counts',()=>{
  const f=fixture(),c=camera();let saved;
  f.mesh.onBeforeRender=()=>{saved=f.mesh.count;f.mesh.count=0;};f.mesh.onAfterRender=()=>{f.mesh.count=saved;};
  try{f.manager.draw(c,()=>{assert.equal(f.mesh.count,2);f.mesh.onBeforeRender();assert.equal(f.mesh.count,0);f.mesh.onAfterRender();assert.equal(f.mesh.count,2);});assert.equal(f.mesh.count,3);}finally{f.close();}
});
