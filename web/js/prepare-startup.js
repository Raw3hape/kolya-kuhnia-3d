// Release deferred downloads early, but open the door only after the final
// apartment, lighting and actual raster frames have settled. No success timeout.
import { startup } from './startup-state.js';

function abortable(value, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(value).then(v => { signal.removeEventListener('abort', abort); resolve(v); }, e => { signal.removeEventListener('abort', abort); reject(e); });
  });
}

export async function prepareStartup({ first, releaseDeferred, modules, enter, pipe, lighting, decor, viewmodel, hunt, ready, mark = () => {} }) {
  const controller = new AbortController(), { signal } = controller;
  let remaining = 240000, timer = 0, visibleAt = performance.now();
  const stop = () => controller.abort(new DOMException('Страница закрыта', 'AbortError'));
  const timeout = () => controller.abort(new Error('Подготовка заняла больше обычного. Попробуйте загрузить квартиру заново.'));
  function visibility() {
    clearTimeout(timer);
    const now = performance.now();
    if (visibleAt !== null) remaining -= now - visibleAt;
    visibleAt = document.hidden ? null : now;
    if (!document.hidden) timer = setTimeout(timeout, Math.max(1, remaining));
  }
  visibility();
  addEventListener('pagehide', stop, { once: true }); document.addEventListener('visibilitychange', visibility);
  async function until(test, progress) {
    while (!test()) {
      if (startup.error) throw startup.error;
      if (lighting.debug.preparationError) throw lighting.debug.preparationError;
      if (progress) startup.progress(progress());
      await abortable(new Promise(resolve => setTimeout(resolve, 50)), signal);
    }
  }
  try {
    startup.stage('room');
    await abortable(first, signal);
    if (startup.error) throw startup.error;
    mark('files'); await abortable(pipe.whenDrawn(), signal); mark('drawn');
    startup.stage('details'); releaseDeferred();
    await Promise.resolve(); // afterRoom factories attach their module handles.
    enter();
    await abortable(Promise.all(modules()), signal);
    await until(() => hunt()?.stats.ready && !decor()?.grow?.length && (viewmodel.weapon === 'none' || viewmodel.fireReady));
    await startup.idle({ quietMs: 700, timeoutMs: Infinity, signal });
    lighting.releaseStartup();
    while (true) {
      startup.stage('lighting');
      await abortable(lighting.whenEnvironmentReady(), signal);
      await until(() => lighting.debug.stable, () => lighting.debug.preparationProgress);
      mark('gi'); startup.stage('renderer');
      await until(() => !pipe.preparing);
      const generation = startup.state.revision;
      for (let i = 0; i < 3; i++) {
        await abortable(pipe.whenDrawn(), signal); startup.progress((i + 1) / 3);
      }
      await startup.idle({ quietMs: 350, timeoutMs: Infinity, signal });
      if (generation === startup.state.revision && lighting.debug.stable && !pipe.preparing && !decor()?.grow?.length &&
        (viewmodel.weapon === 'none' || viewmodel.fireReady)) break;
    }
    if (startup.complete()) { mark('playable'); ready(); }
  } catch (error) {
    if (error?.name !== 'AbortError') { startup.fail(error); console.warn('startup:', error); }
  } finally {
    clearTimeout(timer); removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', visibility);
  }
}
