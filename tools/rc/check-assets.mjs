// Offline build gate: a layout edit must never ship with an older garage/field.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {PLAYABLE_FIELD} from '../../web/js/playable-field.generated.js';
const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root));
const hash=data=>createHash('sha256').update(data).digest('hex');
const specBytes=read('web/spec/rc.json'),spec=JSON.parse(specBytes);
const manifest=JSON.parse(read('web/models/rc/manifest.json')),asset=read('web/'+spec.asset);
assert.equal(manifest.sourceSpecSha256,hash(specBytes),'Rebuild the Blender garage after changing rc.json');
assert.equal(manifest.sha256,hash(asset),'Packed garage differs from its manifest');
assert.equal(manifest.bytes,asset.length);
assert.equal(manifest.cars.length,spec.designs.length);
assert.equal(PLAYABLE_FIELD.sourceSiteSha256,hash(read('web/spec/site.json')),'Recompile the playable field');
assert.equal(PLAYABLE_FIELD.seamTolerance,spec.arena.seamTolerance);
console.log('RC garage and field provenance verified.');
