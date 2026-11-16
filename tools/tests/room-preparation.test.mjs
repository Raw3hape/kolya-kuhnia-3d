import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRoom } from '../../web/js/multiplayer/room-preparation.js';

test('asset preparation returns the complete manifest or its actual load failure', async () => {
  const manifest = { objects: ['book', 'vase'] };
  assert.equal(await prepareRoom(() => manifest), manifest);
  const failure = new Error('asset failed');
  await assert.rejects(prepareRoom(() => { throw failure; }), error => error === failure);
});

test('an asset which never settles produces a bounded, actionable lobby failure', async () => {
  await assert.rejects(prepareRoom(() => new Promise(() => {}), { timeoutMs: 10 }), /Квартира загружается слишком долго/);
});

test('cancelling before loading avoids work; cancelling during loading ignores late completion', async () => {
  const before = new AbortController(); before.abort();
  let loads = 0;
  await assert.rejects(prepareRoom(() => loads++, { signal: before.signal }), { name: 'AbortError' });
  assert.equal(loads, 0);
  const during = new AbortController(); let release;
  const pending = prepareRoom(() => new Promise(resolve => { release = resolve; }), { signal: during.signal });
  await Promise.resolve(); during.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  release({ objects: ['late'] });
  await Promise.resolve();
});
