import { WEAPON_RULES } from './rules.js';

// The host owns this worker. Closing/leaving the room terminates it immediately.
export async function createHostAuthority({ room, plan, huntSpec, site, resolveSurfaces, resolveExternalTrace, resolveExternalShot, send }) {
  const worker = new Worker(new URL('./host-worker.js', import.meta.url), { type: 'module', name: 'kitchen-room' });
  const budgets = new Map();
  const validVector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) < 1500);
  const trace = shot => shot.rays.map(ray => resolveSurfaces(shot.origin, ray.direction, WEAPON_RULES[shot.weapon].range));
  function validShot(peer, shot) {
    const w = Object.hasOwn(WEAPON_RULES, shot.weapon) && WEAPON_RULES[shot.weapon];
    if (!w?.damage || !validVector(shot.origin) || !validVector(shot.direction) ||
      typeof shot.shotId !== 'string' || shot.shotId.length > 96 || !Array.isArray(shot.rays) ||
      !shot.rays.length || shot.rays.length > w.pellets || shot.rays.some(ray => !validVector(ray.direction) || Math.abs(Math.hypot(...ray.direction) - 1) > 0.01)) return false;
    const now = performance.now(), budget = budgets.get(peer) || { credit: 3, at: now, ids: new Set() };
    budget.credit = Math.min(3, budget.credit + (now - budget.at) / 1000 * 12); budget.at = now;
    if (budget.credit < 1 || budget.ids.has(shot.shotId)) return false;
    budget.credit--; budget.ids.add(shot.shotId);
    if (budget.ids.size > 128) budget.ids.delete(budget.ids.values().next().value);
    budgets.set(peer, budget); return true;
  }
  let disposed = false;
  let ready = false;
  const failAuthority = () => {
    if (disposed) return;
    disposed = true; worker.terminate();
    send('local', { type: 'error', error: 'authority_failed' });
  };
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('authority_timeout')); }, 12000);
    worker.onerror = error => { clearTimeout(timeout); if (ready) failAuthority(); else { worker.terminate(); reject(error); } };
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') { ready = true; clearTimeout(timeout); resolve(); }
      else if (data.type === 'error') { clearTimeout(timeout); if (ready) failAuthority(); else { worker.terminate(); reject(new Error(data.message)); } }
      else if (data.type === 'packet') {
        const event = data.packet?.event;
        if (data.peer === 'local' && event?.kind === 'shot' && resolveExternalShot) {
          try {
            const results = resolveExternalShot(event);
            if (results?.length) worker.postMessage({ command: 'external', shotId: event.shotId, actorId: event.actorId, results });
          } catch (error) { console.warn('Shared target effect:', error.message); }
        }
        send(data.peer, data.packet);
      }
    };
    worker.postMessage({ command: 'init', options: { roomId: room, plan, huntSpec, site,
      seed: crypto.getRandomValues(new Uint32Array(1))[0] } });
  });
  return {
    connect(peer, hello) { if (!disposed) worker.postMessage({ command: 'connect', peer, hello }); },
    receive(peer, packet) {
      if (disposed) return;
      // Only this private bridge supplies worldTrace. Any field sent by a guest is ignored.
      const isShot = packet?.type === 'action' && packet.action?.kind === 'shoot';
      if (isShot && !validShot(peer, packet.action)) return;
      const worldTrace = isShot ? trace(packet.action) : undefined;
      const externalTrace = worldTrace ? resolveExternalTrace?.(packet.action) : undefined;
      worker.postMessage({ command: 'receive', peer, packet, worldTrace, externalTrace });
    },
    disconnect(peer) { budgets.delete(peer); if (!disposed) worker.postMessage({ command: 'disconnect', peer }); },
    dispose() { if (disposed) return; disposed = true; worker.postMessage({ command: 'dispose' }); worker.terminate(); },
  };
}
