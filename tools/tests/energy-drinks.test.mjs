import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPartySimulation} from '../../web/js/party-state.js';
const spec=JSON.parse(readFileSync(new URL('../../web/spec/party.json',import.meta.url)));
const energy=spec.items.find(i=>i.kind==='energy');
const actor={id:'a',position:[.9,.8,2.46]},other={id:'b',position:[1.1,.8,2.46]};
const item=sim=>sim.snapshot().items.find(i=>i.id===energy.id);
const step=(sim,seconds)=>{for(let t=0;t<seconds-1e-7;t+=.05)sim.step(.05);};
function take(){const sim=createPartySimulation({spec});assert(sim.command(actor,'fridge','fridge').ok);assert(sim.command(actor,'take',energy.id).ok);step(sim,.7);return sim;}
test('the physical fridge protects its stocked bottles until opened, with a reach check',()=>{
 const sim=createPartySimulation({spec});assert.equal(sim.snapshot().fridgeOpen,false);
 assert.equal(sim.command(actor,'take',energy.id).ok,false);
 assert.equal(sim.command({...actor,position:[9,1,9]},'fridge','fridge').ok,false);
 assert(sim.command(actor,'fridge','fridge').ok);assert(sim.command(actor,'take',energy.id).ok);
 assert.equal(sim.snapshot().items.filter(i=>i.kind==='energy').length,36);
 assert.equal(new Set(spec.energy.variants.map(v=>v.title)).size,6);
});
test('energy gives five accepted sips, bounded timed optical state and a crush only once empty',()=>{
 const sim=take();assert.equal(sim.command(actor,'crush',energy.id).ok,false);
 for(let i=1;i<=5;i++){assert(sim.command(actor,'sip',energy.id).ok);assert.equal(item(sim).sips,i);assert.equal(sim.command(actor,'sip',energy.id).ok,false);step(sim,1.1);}
 assert.equal(sim.command(actor,'sip',energy.id).ok,false);assert.equal(sim.snapshot().boosts[0].strength,1);
 assert(sim.command(actor,'crush',energy.id).ok);assert.equal(item(sim).crushed,true);step(sim,.7);assert.equal(sim.command(actor,'crush',energy.id).ok,false);
 assert(sim.command(actor,'throw',energy.id,[0,-1,0]).ok);step(sim,.6);assert.equal(item(sim).status,'resting');
 const point=[...item(sim).position];step(sim,200);assert.equal(item(sim).status,'resting');assert.deepEqual(item(sim).position,point);assert.deepEqual(sim.snapshot().boosts,[]);
 assert(sim.command({...other,position:point},'take',energy.id).ok);assert.equal(item(sim).sips,5);assert.equal(item(sim).crushed,true);
});
test('a handoff preserves partial drink contents and never transfers the donor camera effect',()=>{
 const sim=take();assert(sim.command(actor,'sip',energy.id).ok);
 assert.equal(sim.transfer('a','b',energy.id,[actor,other]).error,'item_busy');step(sim,1.1);
 assert.equal(sim.transfer('a','b',energy.id,[actor,{...other,position:[9,1,9]}]).error,'recipient_out_of_reach');
 assert(sim.transfer('a','b',energy.id,[actor,other]).ok);assert.equal(item(sim).owner,'b');assert.equal(item(sim).sips,1);
 assert.equal(sim.snapshot().boosts[0].actorId,'a');assert.equal(sim.held('a'),null);
 step(sim,.7);assert(sim.command(other,'sip',energy.id).ok);assert.equal(item(sim).sips,2);assert.equal(sim.snapshot().boosts.length,2);
 const late=createPartySimulation({spec});assert(late.restore(sim.snapshot()));assert.deepEqual(late.snapshot(),sim.snapshot());
});
test('simultaneous transfers to a player with a party item reject without losing either item',()=>{
 const sim=take(),second=spec.items.find(i=>i.kind==='energy'&&i.id!==energy.id);
 assert(sim.command(other,'take',second.id).ok);step(sim,.7);const before=sim.snapshot();
 assert.equal(sim.transfer('a','b',energy.id,[actor,other]).error,'recipient_busy');assert.deepEqual(sim.snapshot(),before);
 assert.equal(sim.transfer('b','b',second.id).ok,false);assert.equal(sim.transfer('unknown','a',energy.id).ok,false);
});
