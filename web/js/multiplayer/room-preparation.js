// Asset preparation precedes transport connection, so it needs its own bounded
// lifecycle. Cancelling the lobby must never create a room when late assets finish.
export const ROOM_PREPARATION_MS = 90000;

export function prepareRoom(load, { signal, timeoutMs = ROOM_PREPARATION_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    function finish(callback, value) {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      callback(value);
    }
    function abort() { finish(reject, signal.reason || new DOMException('Отменено', 'AbortError')); }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(reject, new Error('Квартира загружается слишком долго. Проверьте сеть и попробуйте ещё раз.')), timeoutMs);
    Promise.resolve().then(load).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
