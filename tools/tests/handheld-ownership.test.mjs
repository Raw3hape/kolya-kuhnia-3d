import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandheld } from '../../web/js/handheld.js';

class Classes {
  values = new Set();
  toggle(key,on) { if(on)this.values.add(key);else this.values.delete(key); }
  contains(key) { return this.values.has(key); }
}
class ElementStub {
  classList=new Classes();style={};listeners=new Map();
  addEventListener(type,fn) { this.listeners.set(type,fn); }
  removeEventListener(type) { this.listeners.delete(type); }
  setAttribute() {} append() {} appendChild() {} remove() {}
}
globalThis.HTMLElement=ElementStub;
globalThis.document={body:new ElementStub(),head:new ElementStub(),getElementById:()=>null,createElement:()=>new ElementStub()};
globalThis.matchMedia=()=>({matches:false});
const listeners=new Map();
globalThis.addEventListener=(type,fn)=>{const entries=listeners.get(type)||new Set();entries.add(fn);listeners.set(type,entries);};
globalThis.removeEventListener=(type,fn)=>listeners.get(type)?.delete(fn);
const THREE={Raycaster:class {layers={mask:1};},Vector2:class{set(){return this;}}};
function fixture({walking=false,active=false,seated=false}={}) {
  const walk={walking,active},seat={active:seated},holds=[],requests=[];
  const hand=createHandheld({THREE,camera:{matrixWorld:{elements:new Float64Array(16)}},canvas:new ElementStub(),getWalk:()=>walk,getSeats:()=>seat,
    getTarget:()=>null,getRect:()=>({left:0,top:0,right:10,bottom:10}),onHold:on=>holds.push(on),onStep:()=>{},networkId:'phone'});
  hand.setNetwork({selfId:()=> 'self',request:action=>{requests.push(action);return Promise.resolve({ok:true});}});
  return {hand,walk,seat,holds,requests};
}

test('authoritative handheld ownership restores while seated or entering walk',()=>{
  for(const mode of [{seated:true},{active:true}]) {
    const f=fixture(mode);
    try {f.hand.applyNetwork('self');assert.equal(f.hand.held,true);assert.deepEqual(f.holds,[true]);assert.deepEqual(f.requests,[]);}
    finally {f.hand.dispose();}
  }
});

test('ownership preceding camera activation presents on sync without another snapshot',()=>{
  const f=fixture();
  try {
    f.hand.applyNetwork('self');assert.equal(f.hand.held,false);
    f.walk.active=true;f.hand.sync();assert.equal(f.hand.held,true);assert.deepEqual(f.holds,[true]);
    f.hand.sync();assert.deepEqual(f.holds,[true],'unchanged frames do not restart the pickup presentation');
    f.hand.applyNetwork('other');assert.equal(f.hand.held,false);assert.deepEqual(f.holds,[true,false]);
  }finally{f.hand.dispose();}
});

test('an unresolved local identity cannot display an unowned item during activation',()=>{
  const f=fixture({walking:true,active:true});
  try {
    f.hand.setNetwork({selfId:()=>null,request:()=>Promise.resolve({ok:false})});
    f.hand.applyNetwork(null);f.hand.sync();assert.equal(f.hand.held,false);assert.deepEqual(f.holds,[]);
  }finally{f.hand.dispose();}
});

test('new pickup remains unavailable while seated and an approved walk claim survives seating before its result',async()=>{
  const f=fixture({seated:true});
  try {
    assert.equal(f.hand.pick(),false);assert.deepEqual(f.requests,[]);
    f.seat.active=false;f.walk.walking=f.walk.active=true;
    const pending=f.hand.pick();f.walk.walking=false;f.seat.active=true;
    assert.equal(await pending,true);assert.equal(f.hand.held,true);assert.deepEqual(f.requests,[{kind:'claim',id:'phone'}]);
    assert.deepEqual(f.holds,[true]);
  }finally{f.hand.dispose();}
});
