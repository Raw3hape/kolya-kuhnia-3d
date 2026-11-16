// Tiny entry point, loaded independently of the Three.js module graph.
import { startup } from './startup-state.js';
import { LOADING_LINES } from './loading-lines.js';

const box = document.getElementById('loading');
if (box) {
  const quote = box.querySelector('.ld-quote'), label = box.querySelector('.ld-now'), number = box.querySelector('.ld-pct');
  const bar = box.querySelector('[role="progressbar"]'), error = box.querySelector('.ld-error'), note = box.querySelector('.ld-note');
  const originalInert = new Map(); let closed = false, bag = [], previous = '', hideTimer = 0;
  // UI shuffling must not consume the simulation's random sequence.
  let randomState = (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0;
  const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; };
  function nextLine() {
    if (!bag.length) {
      bag = [...LOADING_LINES];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (bag.at(-1) === previous) [bag[0], bag[bag.length - 1]] = [bag.at(-1), bag[0]];
    }
    quote.textContent = previous = bag.pop();
  }
  function block(element) {
    if (element === box || !element.matches?.('div,aside,section,button,nav,dialog,canvas')) return;
    if (!originalInert.has(element)) { originalInert.set(element, element.inert); element.inert = true; }
  }
  for (const element of document.body.children) block(element);
  const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) block(node); });
  observer.observe(document.body, { childList: true });
  function preventGameKeys(event) {
    if (closed || event.metaKey || event.ctrlKey || event.altKey || event.code === 'Tab') return;
    if (box.contains(event.target) && ['Enter', 'Space'].includes(event.code) && event.target.closest('button')) { event.stopPropagation(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
  }
  addEventListener('keydown', preventGameKeys, true); addEventListener('keyup', preventGameKeys, true);
  const pointerEvents = ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'touchstart', 'touchmove'];
  function preventGamePointer(event) {
    if (closed) return;
    if (event.type === 'click' && event.target.closest?.('.ld-retry')) location.reload();
    if (!['wheel', 'touchmove'].includes(event.type)) event.preventDefault();
    event.stopImmediatePropagation();
  }
  for (const name of pointerEvents) addEventListener(name, preventGamePointer, { capture: true, passive: false });
  const linesTimer = setInterval(nextLine, 2000);
  const slowTimer = setTimeout(() => { if (startup.status === 'loading') note.textContent = 'Первый визит может занять чуть больше времени. Мы ещё готовим квартиру.'; }, 30000);
  const retry = box.querySelector('.ld-retry'); retry.onclick = () => location.reload();
  const bootFailed = event => startup.fail(new Error(event.detail));
  addEventListener('kitchen:boot-failure', bootFailed);
  let resources;
  try {
    const expected = document.querySelectorAll('link[rel="modulepreload"]').length;
    if (expected && typeof PerformanceObserver !== 'undefined') {
      let scripts = 0;
      resources = new PerformanceObserver(list => {
        scripts += list.getEntries().filter(entry => /\.m?js(?:\?|$)/.test(entry.name)).length;
        if (startup.state.phase === 'modules') startup.progress(Math.min(0.95, scripts / expected));
      });
      resources.observe({ type: 'resource', buffered: true });
    }
  } catch { /* Progress continues with the actual asset stages. */ }
  function stopTimers() { clearInterval(linesTimer); clearTimeout(slowTimer); resources?.disconnect(); }
  function unlockDOM() {
    closed = true; box.hidden = true;
    for (const [element, value] of originalInert) if (element.isConnected) element.inert = value;
    originalInert.clear();
  }
  function cleanup() {
    if (startup.status === 'ready' && !closed) unlockDOM();
    stopTimers(); clearTimeout(hideTimer); observer.disconnect(); unsubscribe();
    removeEventListener('keydown', preventGameKeys, true); removeEventListener('keyup', preventGameKeys, true);
    for (const name of pointerEvents) removeEventListener(name, preventGamePointer, true);
    removeEventListener('kitchen:boot-failure', bootFailed);
    removeEventListener('pagehide', cleanup);
  }
  const unsubscribe = startup.subscribe(state => {
    number.textContent = `${state.percent} %`; bar.setAttribute('aria-valuenow', state.percent); box.style.setProperty('--p', state.percent + '%');
    if (label.textContent !== state.label) label.textContent = state.label;
    if (state.status === 'error') {
      stopTimers(); box.classList.add('failed'); error.hidden = false;
      error.querySelector('p').textContent = state.error; note.textContent = 'Квартира пока не готова. Давайте попробуем ещё раз.';
      retry.focus({ preventScroll: true });
    } else if (state.status === 'ready') {
      stopTimers(); note.textContent = 'Всё готово. Добро пожаловать!'; box.classList.add('finished');
      hideTimer = setTimeout(() => {
        unlockDOM(); cleanup();
        const dialog = document.querySelector('dialog[open]');
        (dialog?.querySelector('input:not([disabled])') || dialog?.querySelector('button:not([disabled])') || document.getElementById('scene'))?.focus({ preventScroll: true });
      }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    }
  });
  addEventListener('pagehide', cleanup, { once: true });
  addEventListener('pageshow', event => { if (event.persisted && startup.status !== 'ready') location.reload(); });
  nextLine(); box.focus({ preventScroll: true });
  if (window.__kitchenBootError) startup.fail(new Error(window.__kitchenBootError));
}
