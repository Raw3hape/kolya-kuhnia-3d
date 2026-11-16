import { createRoomAuthority } from './authority.js';
import { NETWORK_RULES as R } from './rules.js';

let room = null, timer = null, last = 0;
self.onmessage = ({ data }) => {
  try {
    if (data.command === 'init') {
      room?.dispose(); clearInterval(timer);
      room = createRoomAuthority({ ...data.options, send: (peer, packet) => self.postMessage({ type: 'packet', peer, packet }) });
      last = performance.now();
      timer = setInterval(() => {
        const now = performance.now(), elapsed = (now - last) / 1000; last = now;
        // A suspended device cannot simulate real time. Resume without a giant catch-up burst.
        room.step(Math.min(elapsed, 0.05));
      }, 1000 / R.tickHz);
      self.postMessage({ type: 'ready' });
    } else if (data.command === 'connect') room?.connect(data.peer, data.hello);
    else if (data.command === 'receive') room?.receive(data.peer, data.packet, { worldTrace: data.worldTrace, externalTrace: data.externalTrace });
    else if (data.command === 'external') room?.completeExternal(data.shotId, data.results, data.actorId);
    else if (data.command === 'disconnect') room?.disconnect(data.peer);
    else if (data.command === 'dispose') { room?.dispose(); clearInterval(timer); self.close(); }
  } catch (error) { self.postMessage({ type: 'error', message: error?.message || 'room_failure' }); }
};
