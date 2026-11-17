import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRCViewControls} from '../../web/js/rc-camera.js';
const settings=JSON.parse(readFileSync(new URL('../../web/spec/rc.json',import.meta.url))).view.zoom;
test('mouse and trackpad provide head-look deltas, never a camera or follow position',()=>{
 const c=createRCViewControls(settings);c.down(1,100,100);assert.deepEqual(c.move(1,180,75),{dx:80,dy:-25,type:'mouse'});assert.ok(c.up(1));
 assert.deepEqual(Object.keys(c.snapshot()).sort(),['magnification','pointers']);assert.equal(c.snapshot().magnification,settings.initial);
});
test('pinch changes only optical magnification and lifting a finger never jumps the remaining look',()=>{
 const c=createRCViewControls(settings);c.down(1,100,100,'touch');c.down(2,200,100,'touch');const action=c.move(2,400,100);assert.ok(action.zoom);assert.ok(action.magnification>settings.initial);c.up(2);
 assert.deepEqual(c.move(1,102,103),{dx:2,dy:3,type:'touch'});assert.equal(c.snapshot().pointers,1);
});
test('wheel is finite and bounded; cancellation clears touches without changing the body or magnification',()=>{
 const c=createRCViewControls(settings);assert.equal(c.wheel(Infinity),false);for(let i=0;i<100;i++)c.wheel(-1000);assert.equal(c.snapshot().magnification,settings.max);for(let i=0;i<100;i++)c.wheel(1000);assert.equal(c.snapshot().magnification,settings.min);
 c.down(1,1,1);c.cancel();assert.equal(c.move(1,2,2),null);assert.equal(c.snapshot().pointers,0);c.reset();assert.equal(c.snapshot().magnification,settings.initial);
});
