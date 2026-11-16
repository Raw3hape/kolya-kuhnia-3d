#!/usr/bin/env node
// Vendor only the actual Three.js import closure. No archive, npm install, build, or browser.
// --inventory: metadata-only direct-root size. --check: offline source/hash/import-closure validation.
import { readdir, readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VERSION = '0.169.0', DIRECTORY = `three-${VERSION.split('.').slice(0, 2).join('.')}`;
const DEST = path.join(ROOT, 'web/vendor', DIRECTORY);
const CDN = `https://cdn.jsdelivr.net/npm/three@${VERSION}/`;
const METADATA = `https://data.jsdelivr.com/v1/package/npm/three@${VERSION}/flat`;
const MAX_FILES = 128, MAX_BYTES = 12 * 1024 * 1024, CONCURRENCY = 4, FETCH_MS = 10000, RETRIES = 2;
const mode = process.argv[2] || '--write';
if (!['--write', '--inventory', '--check'].includes(mode)) throw new Error('Use --inventory, --check, or no argument to vendor.');
const sha = value => createHash('sha256').update(value).digest('hex');
const imports = source => [...source.matchAll(/\b(?:import|export)\s+(?:(?:[^'";]+?)\s+from\s+)?['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]/g)].map(match => match[1] || match[2]);
function packagePath(specifier, importer = null) {
  let result = null;
  if (specifier === 'three') result = 'build/three.module.js';
  else if (specifier.startsWith('three/addons/')) result = 'examples/jsm/' + specifier.slice('three/addons/'.length);
  else if (specifier.startsWith('three/examples/jsm/')) result = 'examples/jsm/' + specifier.slice('three/examples/jsm/'.length);
  else if (importer && specifier.startsWith('.')) result = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (result && (!/^[A-Za-z0-9_./-]+$/.test(result) || result.startsWith('../') || path.posix.isAbsolute(result))) throw new Error(`Import escaped pinned package: ${specifier}`);
  return result;
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(filename));
    else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) result.push(filename);
  }
  return result.sort();
}
async function roots() {
  const result = new Set();
  for (const filename of await files(path.join(ROOT, 'web/js'))) {
    for (const specifier of imports(await readFile(filename, 'utf8'))) {
      const item = packagePath(specifier); if (item) result.add(item);
    }
  }
  if (!result.has('build/three.module.js')) throw new Error('No Three.js core import found in web/js.');
  return [...result].sort();
}
function dependencies(filename, source) {
  if (!filename.endsWith('.js')) return [];
  const result = [];
  for (const specifier of imports(source)) {
    const resolved = packagePath(specifier, filename);
    if (!resolved) throw new Error(`Unvendored external dependency in ${filename}: ${specifier}`);
    if (!resolved.endsWith('.js')) throw new Error(`Unexpected addon dependency in ${filename}: ${specifier}`);
    result.push(resolved);
  }
  return result;
}

const initialRoots = await roots();
if (mode === '--check') {
  const index = await readFile(path.join(ROOT, 'web/index.html'), 'utf8');
  const mapping = JSON.parse(index.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] || '{}').imports;
  const expected = { three: `./vendor/${DIRECTORY}/build/three.module.js`,
    'three/addons/': `./vendor/${DIRECTORY}/examples/jsm/`, 'three/examples/jsm/': `./vendor/${DIRECTORY}/examples/jsm/` };
  for (const [specifier, target] of Object.entries(expected)) if (mapping?.[specifier] !== target) throw new Error(`Import map must serve ${specifier} locally from ${target}`);
  const manifest = JSON.parse(await readFile(path.join(DEST, 'manifest.json'), 'utf8'));
  if (manifest.version !== VERSION) throw new Error('Vendored Three.js version does not match the pipeline.');
  const listed = new Map(manifest.files.map(file => [file.path, file]));
  const pending = [...initialRoots, 'LICENSE'], checked = new Set(); let bytes = 0;
  while (pending.length) {
    const filename = pending.pop(); if (checked.has(filename)) continue; checked.add(filename);
    if (!listed.has(filename)) throw new Error(`Missing Three.js dependency: ${filename}. Run node tools/vendor_three.mjs`);
    const source = await readFile(path.join(DEST, filename));
    if (sha(source) !== listed.get(filename).sha256) throw new Error(`Vendored file changed: ${filename}`);
    bytes += source.byteLength; pending.push(...dependencies(filename, source.toString('utf8')));
  }
  const unreachable = [...listed.keys()].filter(filename => !checked.has(filename));
  if (unreachable.length) throw new Error(`Unreachable vendored files: ${unreachable.join(', ')}`);
  console.log(JSON.stringify({ mode: 'check', version: VERSION, roots: initialRoots.length, files: checked.size, bytes, ok: true }));
  process.exit(0);
}

const lifetime = new AbortController(), deadline = setTimeout(() => lifetime.abort(new Error('Vendor deadline exceeded')), 65000);
async function fetchBounded(url) {
  let error;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (lifetime.signal.aborted) throw lifetime.signal.reason;
    try {
      const response = await fetch(url, { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(FETCH_MS)]) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error('Single source exceeds vendor size bound');
      return bytes;
    } catch (cause) {
      error = cause;
      if (attempt < RETRIES && !lifetime.signal.aborted) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw error;
}
try {
  const metadata = JSON.parse(new TextDecoder().decode(await fetchBounded(METADATA)));
  const sizes = new Map(metadata.files.map(file => [file.name.replace(/^\//, ''), file.size]));
  const direct = [...initialRoots, 'LICENSE'];
  for (const filename of direct) if (!sizes.has(filename)) throw new Error(`Pinned package has no ${filename}`);
  const inventory = { mode: 'inventory', version: VERSION, roots: initialRoots.length, directFiles: direct.length,
    directBytes: direct.reduce((sum, filename) => sum + sizes.get(filename), 0), note: 'Direct roots plus LICENSE; reachable relative dependencies are added during vendoring.' };
  console.log(JSON.stringify(inventory));
  if (mode === '--inventory') process.exitCode = 0;
  else {
    const sources = new Map(), scheduled = new Set(direct), pending = [...direct]; let active = 0, totalBytes = 0;
    await new Promise((resolve, reject) => {
      let failed = false;
      function pump() {
        if (failed) return;
        while (active < CONCURRENCY && pending.length) {
          const filename = pending.shift(); active++;
          fetchBounded(CDN + filename).then(bytes => {
            if (failed) return;
            totalBytes += bytes.byteLength;
            if (totalBytes > MAX_BYTES) throw new Error('Reachable Three.js sources exceed vendor size bound');
            sources.set(filename, bytes);
            for (const dep of dependencies(filename, new TextDecoder().decode(bytes))) {
              if (!sizes.has(dep)) throw new Error(`Pinned package has no relative dependency ${dep}`);
              if (!scheduled.has(dep)) { scheduled.add(dep); pending.push(dep); }
            }
            if (scheduled.size > MAX_FILES) throw new Error('Reachable Three.js graph exceeds vendor file bound');
          }).catch(error => { if (!failed) { failed = true; lifetime.abort(error); reject(error); } })
            .finally(() => { active--; if (!failed && !active && !pending.length) resolve(); else pump(); });
        }
      }
      pump();
    });
    const entries = [...sources].sort(([a], [b]) => a.localeCompare(b)).map(([filename, bytes]) => ({ path: filename, bytes: bytes.byteLength, sha256: sha(bytes), source: CDN + filename }));
    let previous = null; try { previous = JSON.parse(await readFile(path.join(DEST, 'manifest.json'), 'utf8')); } catch { /* First generation. */ }
    // Network/closure validation finishes before the first source file is written.
    for (const [filename, bytes] of sources) { await mkdir(path.dirname(path.join(DEST, filename)), { recursive: true }); await writeFile(path.join(DEST, filename), bytes); }
    for (const file of previous?.files || []) {
      if (sources.has(file.path)) continue;
      const filename = path.join(DEST, file.path);
      if (!filename.startsWith(DEST + path.sep)) throw new Error('Previous manifest escaped its vendor directory');
      try { if (sha(await readFile(filename)) === file.sha256) await unlink(filename); } catch { /* Never remove an edited or ambiguous file. */ }
    }
    await writeFile(path.join(DEST, 'manifest.json'), JSON.stringify({ package: 'three', version: VERSION, generatedAt: new Date().toISOString(), roots: initialRoots, files: entries }, null, 2) + '\n');
    await writeFile(path.join(DEST, 'README.md'), `# Three.js ${VERSION}\n\nVendored runtime sources from the pinned official npm package, served by jsDelivr.\n\n- Scope: actual imports under \`web/js/\` and their reachable relative addon imports.\n- Files: ${entries.length}; source bytes: ${totalBytes}. No models, archives, or npm install.\n- License: MIT, original \`LICENSE\` included. Sources and SHA-256 hashes: \`manifest.json\`.\n- Update: \`node tools/vendor_three.mjs\`; offline validation: \`node tools/vendor_three.mjs --check\`.\n- The import map in \`web/index.html\` uses these files. Optional photo tracing/BVH remains lazy.\n\nDo not edit vendored sources. Change application code or the pinned version/pipeline, then regenerate.\n`);
    console.log(JSON.stringify({ mode: 'write', version: VERSION, files: entries.length, bytes: totalBytes, directory: path.relative(ROOT, DEST), concurrency: CONCURRENCY, retries: RETRIES }));
  }
} finally { clearTimeout(deadline); }
