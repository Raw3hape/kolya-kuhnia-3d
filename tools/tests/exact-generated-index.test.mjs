import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../web/vendor/three-0.169/build/three.module.js';
import { indexExactGeneratedGeometry } from '../../web/js/exact-generated-index.js';

const bits = attribute => new Uint32Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.length);
function reconstructed(geometry, name) {
  const attribute = geometry.attributes[name], values = bits(attribute), count = geometry.index?.count ?? attribute.count;
  const result = new Uint32Array(count * attribute.itemSize);
  for (let vertex = 0; vertex < count; vertex++) {
    const source = (geometry.index ? geometry.index.getX(vertex) : vertex) * attribute.itemSize;
    for (let component = 0; component < attribute.itemSize; component++) result[vertex * attribute.itemSize + component] = values[source + component];
  }
  return result;
}
function repeatedQuad(repeats = 32) {
  const g = new THREE.BufferGeometry(), position = [], normal = [], uv = [], extra = [];
  const corners = [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]];
  for(let i=0;i<repeats;i++)for(const [x,y] of corners){position.push(x+i*2,y,0);normal.push(0,0,1);uv.push(x,y);extra.push(i%3);}
  for(const [name,values,size] of [['position',position,3],['normal',normal,3],['uv',uv,2],['surface',extra,1]])g.setAttribute(name,new THREE.Float32BufferAttribute(values,size));
  return g;
}

test('generated indexing preserves every Float32 attribute and triangle order bit-for-bit while reducing meaningful bytes',()=>{
  const source=repeatedQuad();source.name='generated';source.userData={kind:'test'};source.computeBoundingSphere();source.computeBoundingBox();
  source.attributes.surface.normalized=true;source.attributes.surface.name='surface-tag';source.attributes.surface.setUsage(THREE.DynamicDrawUsage);
  const before=Object.fromEntries(Object.keys(source.attributes).map(name=>[name,reconstructed(source,name)]));
  const result=indexExactGeneratedGeometry(THREE,source);
  try{
    assert.notEqual(result,source);assert.equal(source.index,null);assert.equal(result.index.count,source.attributes.position.count);
    assert.equal(result.attributes.position.count,32*4);assert.equal(source.attributes.position.count,32*6);
    for(const name of Object.keys(source.attributes)){
      assert.deepEqual(reconstructed(result,name),before[name],name);assert.deepEqual(bits(source.attributes[name]),before[name],'input stays untouched');
      assert.equal(result.attributes[name].itemSize,source.attributes[name].itemSize);assert.equal(result.attributes[name].normalized,source.attributes[name].normalized);
    }
    assert.equal(result.attributes.surface.name,'surface-tag');assert.equal(result.attributes.surface.usage,THREE.DynamicDrawUsage);
    assert.equal(result.name,source.name);assert.deepEqual(result.userData,source.userData);
    assert.ok(result.boundingSphere.equals(source.boundingSphere));assert.ok(result.boundingBox.equals(source.boundingBox));
    assert.deepEqual([...result.index.array.slice(0,6)],[0,1,2,0,2,3]);
  }finally{if(result!==source)result.dispose();source.dispose();}
});

test('normal, UV and extra-attribute seams stay distinct even when all their positions coincide',()=>{
  const source=new THREE.BufferGeometry();
  const rows={position:[],normal:[],uv:[],tag:[]};
  for(let repeat=0;repeat<32;repeat++)for(let i=0;i<6;i++){
    rows.position.push(0,0,0);rows.normal.push(0,i===3?1:0,i===3?0:1);rows.uv.push(i===4?.5:i%3,0);rows.tag.push(i===5?99:i%3);
  }
  for(const [name,size] of [['position',3],['normal',3],['uv',2],['tag',1]])source.setAttribute(name,new THREE.Float32BufferAttribute(rows[name],size));
  const result=indexExactGeneratedGeometry(THREE,source);
  try{
    assert.equal(result.attributes.position.count,6);
    for(const name of Object.keys(rows))assert.deepEqual(reconstructed(result,name),reconstructed(source,name));
    assert.deepEqual([...result.index.array.slice(0,6)],[0,1,2,3,4,5]);
  }finally{result.dispose();source.dispose();}
});

test('signed zero and distinct quiet/signaling NaN payloads participate in exact bit identity',()=>{
  const source=new THREE.BufferGeometry(), array=new Float32Array(60*3), raw=new Uint32Array(array.buffer);
  const patterns=[0,0x80000000,0x7fc00001,0x7fc00002,0x7fa00001];
  for(let i=0;i<60;i++)raw[i*3]=patterns[i%patterns.length];
  source.setAttribute('position',new THREE.BufferAttribute(array,3));
  const before=raw.slice(),result=indexExactGeneratedGeometry(THREE,source);
  try{assert.equal(result.attributes.position.count,5);assert.deepEqual(reconstructed(result,'position'),before);assert.deepEqual(raw,before);assert.deepEqual([...bits(result.attributes.position)].filter((_,i)=>i%3===0),patterns);}
  finally{result.dispose();source.dispose();}
});

test('index width includes exactly 65,536 unique vertices in Uint16 and promotes the next vertex to Uint32',()=>{
  for(const unique of [65536,65537]){
    const source=new THREE.BufferGeometry(),array=new Float32Array(unique*9);
    for(let i=0;i<unique*3;i++)array[i*3]=i%unique;
    source.setAttribute('position',new THREE.BufferAttribute(array,3));
    const result=indexExactGeneratedGeometry(THREE,source);
    try{
      assert.equal(result.attributes.position.count,unique);assert.equal(result.index.array.constructor,unique===65536?Uint16Array:Uint32Array);
      assert.equal(result.index.getX(unique-1),unique-1);assert.equal(result.index.getX(unique),0);
      assert.deepEqual(reconstructed(result,'position'),bits(source.attributes.position));
    }finally{result.dispose();source.dispose();}
  }
});

test('no net saving, tiny savings and below-threshold ratios keep the original geometry without new output buffers',()=>{
  const unique=new THREE.BufferGeometry();unique.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  const tiny=repeatedQuad(1),low=new THREE.BufferGeometry(),array=new Float32Array(120*3);
  for(let i=0;i<120;i++)array[i*3]=i%98;low.setAttribute('position',new THREE.BufferAttribute(array,3));
  try{
    assert.equal(indexExactGeneratedGeometry(THREE,unique),unique);assert.equal(indexExactGeneratedGeometry(THREE,tiny),tiny);
    assert.equal(indexExactGeneratedGeometry(THREE,low,{minSavingsBytes:0}),low);
    const accepted=indexExactGeneratedGeometry(THREE,low,{minSavingsBytes:0,minSavingsRatio:0});assert.notEqual(accepted,low);accepted.dispose();
  }finally{unique.dispose();tiny.dispose();low.dispose();}
});

test('already indexed, grouped, partial-range, morph, instanced, interleaved and incompatible attribute inputs are unchanged',()=>{
  const changes=[g=>g.setIndex(Array.from({length:g.attributes.position.count},(_,i)=>i)),g=>g.addGroup(0,6,0),g=>g.setDrawRange(3,6),
    g=>{g.morphAttributes.position=[g.attributes.position.clone()];},g=>{g.isInstancedBufferGeometry=true;},
    g=>g.setAttribute('instance',new THREE.InstancedBufferAttribute(new Float32Array(g.attributes.position.count),1)),
    g=>g.setAttribute('normal',new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(g.attributes.normal.array,3),3,0)),
    g=>g.setAttribute('normal',new THREE.BufferAttribute(new Float64Array(g.attributes.normal.array),3)),
    g=>g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(3),3))];
  for(const change of changes){const source=repeatedQuad();change(source);try{assert.equal(indexExactGeneratedGeometry(THREE,source),source);}finally{source.dispose();}}
});
