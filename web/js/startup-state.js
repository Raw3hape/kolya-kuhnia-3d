// Initial playability is separate from loading.js's early deferred-work release.
// No renderer/DOM dependencies: the gate is also exercised in Node tests.
export const STARTUP_EVENT = 'kitchen:startup';
const STAGES = {
  modules: [0, 8, 'Открываем дверь'],
  room: [8, 38, 'Заносим мебель'],
  details: [38, 78, 'Собираем всю квартиру'],
  lighting: [78, 92, 'Включаем свет'],
  renderer: [92, 99, 'Проверяем, всё ли готово'],
};

export function createStartupGate({ publish = () => {}, now = () => performance.now() } = {}) {
  const pending = new Map(), seen = new WeakSet(), listeners = new Set();
  let phase = 'modules', status = 'loading', shown = 0, total = 0, done = 0, phaseStartDone = 0, revision = 0, error = null, queued = false;
  let resolvePlayable;
  const whenPlayable = new Promise(resolve => { resolvePlayable = resolve; });
  const snapshot = () => ({ status, phase, percent: Math.floor(shown), label: status === 'ready' ? 'Квартира готова' : STAGES[phase]?.[2] || 'Всё готово',
    pending: pending.size, total, done, revision, error: error?.message || null,
    labels: [...new Set([...pending.values()].map(x => x.label))].slice(0, 2) });
  function emit() {
    if (queued) return;
    queued = true; queueMicrotask(() => { queued = false; const value = snapshot(); publish(value); for (const fn of listeners) fn(value); });
  }
  function progress(fraction) {
    const [lo, hi] = STAGES[phase] || [100, 100];
    shown = Math.max(shown, lo + (hi - lo) * Math.max(0, Math.min(1, fraction || 0))); emit();
  }
  function assetsProgress() {
    if (phase === 'room' || phase === 'details') progress(total > phaseStartDone ? (done - phaseStartDone) / (total - phaseStartDone) : 0);
    else emit();
  }
  function fail(reason) {
    if (status !== 'loading') return;
    error = reason instanceof Error ? reason : new Error(String(reason || 'Не получилось подготовить квартиру.'));
    status = 'error'; emit();
  }
  function track(value, { label = 'Готовим квартиру', weight = 1 } = {}) {
    const promise = Promise.resolve(value);
    if (status !== 'loading' || seen.has(promise)) return value;
    seen.add(promise);
    const amount = Number.isFinite(weight) && weight > 0 ? weight : 1;
    pending.set(promise, { label, amount }); total += amount; revision++; assetsProgress();
    const finish = (failed, reason) => {
      if (!pending.delete(promise)) return;
      done += amount; revision++;
      if (failed) fail(new Error(`Не удалось загрузить: ${label}. Проверьте соединение и попробуйте ещё раз.`, { cause: reason }));
      assetsProgress();
    };
    promise.then(() => finish(false), reason => finish(true, reason));
    return value;
  }
  async function idle({ quietMs = 400, timeoutMs = 240000, signal } = {}) {
    const started = now(); let quietAt = now(), lastRevision = -1;
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Отменено', 'AbortError');
      if (error) throw error;
      if (now() - started >= timeoutMs) throw new Error('Подготовка заняла больше обычного. Попробуйте загрузить квартиру заново.');
      if (pending.size || revision !== lastRevision) { quietAt = now(); lastRevision = revision; }
      else if (now() - quietAt >= quietMs) return;
      await new Promise((resolve, reject) => {
        const complete = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(complete, Math.min(50, Math.max(1, quietMs)));
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Отменено', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
  return { track, progress, fail, idle, whenPlayable,
    stage(next) { if (status !== 'loading' || !STAGES[next]) return; if (phase !== next) phaseStartDone = done; phase = next; progress(0); assetsProgress(); },
    complete() {
      if (status !== 'loading') return false;
      if (pending.size) throw new Error('Квартира ещё загружается.');
      status = 'ready'; shown = 100; resolvePlayable(); emit(); return true;
    },
    subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); },
    get state() { return snapshot(); }, get status() { return status; }, get error() { return error; },
  };
}

export const startup = createStartupGate({ publish(detail) {
  if (typeof globalThis.dispatchEvent === 'function') globalThis.dispatchEvent(new CustomEvent(STARTUP_EVENT, { detail }));
} });
