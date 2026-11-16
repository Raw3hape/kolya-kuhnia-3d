import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupGate } from '../../web/js/startup-state.js';
import { LOADING_LINES } from '../../web/js/loading-lines.js';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

test('more than one hundred distinct immutable party captions are available',()=>{
  assert.ok(LOADING_LINES.length>100);assert.equal(new Set(LOADING_LINES).size,LOADING_LINES.length);assert.ok(Object.isFrozen(LOADING_LINES));
  assert.ok(LOADING_LINES.every(x=>typeof x==='string'&&x.trim()===x&&x.length>15));
});
test('deferred downloads can open while playability stays locked until final completion',async()=>{
  const gate=createStartupGate(), room=deferred(), late=deferred();let playable=false;gate.whenPlayable.then(()=>{playable=true;});
  gate.track(room.promise.then(()=>gate.track(late.promise,{label:'Дальняя комната'})));
  room.resolve();await delay(1);assert.equal(playable,false);assert.ok(gate.state.pending>0);
  late.resolve();await gate.idle({quietMs:5});assert.equal(playable,false);gate.complete();await gate.whenPlayable;assert.equal(playable,true);assert.equal(gate.state.percent,100);
});
test('a late nested download resets the idle window and blocks premature completion',async()=>{
  const gate=createStartupGate(), nested=deferred();let idle=false;
  gate.track(delay(4).then(()=>gate.track(nested.promise,{label:'Вещи'})));
  const wait=gate.idle({quietMs:10}).then(()=>{idle=true;});await delay(20);assert.equal(idle,false);assert.throws(()=>gate.complete(),/ещё загружается/);
  nested.resolve();await wait;assert.equal(gate.state.pending,0);
});
test('progress never regresses and a newly opened stage does not pretend its assets already finished',async()=>{
  const snapshots=[],gate=createStartupGate({publish:x=>snapshots.push(x.percent)}),first=deferred();gate.stage('room');gate.track(first.promise,{weight:100});first.resolve();await delay(0);
  gate.stage('details');assert.equal(gate.state.percent,38);
  const second=deferred();gate.track(second.promise,{weight:300});await delay(0);assert.equal(gate.state.percent,38);second.resolve();await gate.idle({quietMs:3});
  assert.equal(gate.state.percent,78);assert.ok(snapshots.every((x,i)=>!i||x>=snapshots[i-1]));
});
test('a failed resource cannot become ready even if all promises settled',async()=>{
  const gate=createStartupGate(), p=deferred();gate.track(p.promise,{label:'Кухня'});p.reject(new Error('offline'));await delay(0);
  assert.equal(gate.status,'error');assert.match(gate.state.error,/Кухня/);assert.equal(gate.complete(),false);await assert.rejects(gate.idle({quietMs:1}),/Кухня/);
});
test('cancelled or stalled idle waits reject with a bounded lifecycle',async()=>{
  const gate=createStartupGate(), p=deferred(), controller=new AbortController();gate.track(p.promise);
  const wait=gate.idle({quietMs:5,signal:controller.signal});controller.abort();await assert.rejects(wait,{name:'AbortError'});
  await assert.rejects(gate.idle({quietMs:2,timeoutMs:8}),/больше обычного/);p.resolve();
});
test('falsy rejection reasons still fail the gate',async()=>{
  for(const reason of [undefined,null,false,0]){
    const gate=createStartupGate();gate.track(Promise.reject(reason),{label:'Квартира'});await delay(0);
    assert.equal(gate.status,'error');assert.equal(gate.complete(),false);
  }
});
