import test from 'node:test';
import assert from 'node:assert/strict';
import { warmRasterPrograms } from '../../web/js/shader-warmup.js';

function setup() {
  const material = {}, properties = { currentProgram: null }; let ready = false, polls = 0, lost = false;
  const program = { isReady() { polls++; return ready; } }; properties.currentProgram = program;
  return { material, properties, program, renderer: { compile:()=>new Set([material]), properties:{get:()=>properties}, getContext:()=>({isContextLost:()=>lost}) },
    set ready(v) { ready=v; }, set lost(v) { lost=v; }, get polls() { return polls; } };
}

test('warm-up resolves only when the exact compiled programs are ready', async () => {
  const s=setup(), job=warmRasterPrograms(s.renderer,{}, {}, {});
  s.ready=true; assert.equal(await job,true); assert.ok(s.polls>=2);
});
test('disposed or replaced materials never poll deleted programs', async () => {
  for(const next of [undefined,{isReady:()=>true}]) {
    const s=setup(), job=warmRasterPrograms(s.renderer,{}, {}, {}), before=s.polls;
    s.properties.currentProgram=next; assert.equal(await job,false); assert.equal(s.polls,before);
  }
});
test('context loss, cancellation and deadlines end polling', async () => {
  const s=setup(); let cancelled=false;
  const job=warmRasterPrograms(s.renderer,{}, {}, {},{cancelled:()=>cancelled}); cancelled=true; assert.equal(await job,false);
  s.lost=true; assert.equal(await warmRasterPrograms(s.renderer,{}, {}, {}),false);
  s.lost=false; assert.equal(await warmRasterPrograms(s.renderer,{}, {}, {},{timeoutMs:1}),false);
});
