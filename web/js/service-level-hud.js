// DOM presentation and accessible controls. Mode ownership and key bindings
// stay in the first-person controller.
const STYLE_URL = new URL('../css/service-level.css', import.meta.url);
const PERKS = {
  quickCharge: 'Ускоренная зарядка',
  overclock: 'Усиленный импульс',
  reinforced: 'Защита усилена',
};
const TERMINAL = {
  victory: ['Все смены закрыты', 'Сканер обесточил технику во всех раундах. Можно пройти дальше по этажу или вернуться на кухню.'],
  defeat: ['Смена прервана', 'Техника вышла из-под контроля. Можно заново начать с первой смены.'],
};

function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function holdButton(button, callback) {
  if (!callback) {
    button.disabled = true;
    return { release() {}, dispose() {} };
  }
  const listeners = new AbortController();
  const { signal } = listeners;
  let pointer, down = false, keyup;
  function send(next) {
    if (down === next) return;
    down = next;
    button.classList.toggle('is-held', down);
    callback(down);
  }
  function release() {
    clearTimeout(keyup);
    const id = pointer;
    pointer = undefined;
    if (id !== undefined && button.hasPointerCapture(id)) button.releasePointerCapture(id);
    send(false);
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer !== undefined) return;
    event.stopPropagation();
    pointer = event.pointerId;
    button.setPointerCapture(pointer);
    send(true);
  }, { signal });
  for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(kind, event => {
      event.stopPropagation();
      if (event.pointerId === pointer) release();
    }, { signal });
  }
  button.addEventListener('click', event => {
    event.stopPropagation();
    if (event.detail !== 0) return;
    send(true);
    clearTimeout(keyup);
    keyup = setTimeout(release, 175);
  }, { signal });
  return { release, dispose() { listeners.abort(); release(); } };
}

export function createServiceLevelHud({ onExit, onRestart, onLock, onFire, onReload, onRevive, touch = false } = {}) {
  if (!document.getElementById('service-level-style')) {
    const style = document.createElement('link');
    style.id = 'service-level-style';
    style.rel = 'stylesheet';
    style.href = STYLE_URL.href;
    document.head.append(style);
  }
  const panel = document.createElement('section');
  panel.className = 'sl-hud';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Служебный этаж');
  panel.innerHTML = `
    <div class="sl-lens" aria-hidden="true"></div>
    <div class="sl-damage" aria-hidden="true"></div>
    <header class="sl-round">
      <div class="sl-brand"><span class="sl-dot"></span> Служебный этаж</div>
      <div class="sl-roundline"><span>Смена</span><output class="sl-wave"></output></div>
      <div class="sl-steps" aria-hidden="true"></div>
      <p class="sl-objective" role="status"></p>
    </header>
    <div class="sl-topright">
      <div class="sl-team" aria-label="Участники смены">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-3 0-5 1.4-5 3.5V20m5-5c3 0 5 1.4 5 3.5V20m1-12a2.5 2.5 0 0 1 1 4.8m.3 2.5c2.2.4 3.7 1.7 3.7 3.7v1"/></svg>
        <span class="sl-teamcount"></span>
      </div>
      <button type="button" class="sl-exit">На кухню</button>
    </div>
    <div class="sl-cross" aria-hidden="true"></div>
    <div class="sl-announce" aria-live="polite">
      <p class="sl-status" hidden></p>
      <p class="sl-notice" hidden></p>
    </div>
    <div class="sl-vitals">
      <div class="sl-armor"><span>Защита</span><output class="sl-hp"></output><meter class="sl-meter" min="0" max="100" low="28" high="60" optimum="100" value="100" aria-label="Защита"></meter></div>
      <div class="sl-scanner"><span>Импульсный сканер</span><div class="sl-cell"><output class="sl-ammo"></output><span class="sl-reserve"></span></div><small class="sl-reloading" hidden>Зарядка</small></div>
    </div>
    <div class="sl-controls">
      <div class="sl-hint"><kbd>WASD</kbd> Ходьба <kbd>ЛКМ</kbd> Импульс <kbd>R</kbd> Зарядка <span class="sl-unlock-hint" hidden><kbd>Esc</kbd> Курсор</span></div>
      <button type="button" class="sl-lock" hidden>Управлять мышью</button>
    </div>
    <button type="button" class="sl-revive" hidden><span>Поднять</span><kbd>E</kbd></button>
    <div class="sl-touch" hidden>
      <button type="button" class="sl-reload" aria-label="Зарядить сканер"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 6.5A7.3 7.3 0 1 1 5 13m2.4-6.5H3.5m3.9 0v4"/></svg></button>
      <button type="button" class="sl-fire" aria-label="Импульс"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/><circle cx="12" cy="12" r="5"/></svg></button>
    </div>
    <div class="sl-outcome" hidden aria-labelledby="sl-result">
      <div class="sl-outcome-card">
        <p class="sl-outcome-wave"></p>
        <h2 id="sl-result"></h2>
        <p class="sl-result-description"></p>
        <div class="sl-result-buttons">
          <button type="button" class="sl-restart">Новая смена</button>
          <button type="button" class="sl-continue">Продолжить осмотр</button>
          <button type="button" class="sl-leave">На кухню</button>
        </div>
      </div>
    </div>
  `;
  document.body.append(panel);
  const find = selector => panel.querySelector(selector);
  const wave = find('.sl-wave'), steps = find('.sl-steps'), objective = find('.sl-objective'), team = find('.sl-teamcount');
  const hp = find('.sl-hp'), meter = find('.sl-meter'), ammo = find('.sl-ammo'), reserve = find('.sl-reserve'), reloading = find('.sl-reloading');
  const status = find('.sl-status'), notice = find('.sl-notice'), revive = find('.sl-revive');
  const touchControls = find('.sl-touch'), hint = find('.sl-hint'), lock = find('.sl-lock'), cross = find('.sl-cross');
  const unlockHint = find('.sl-unlock-hint');
  const outcome = find('.sl-outcome'), outcomeWave = find('.sl-outcome-wave'), title = find('#sl-result'), description = find('.sl-result-description');
  const restart = find('.sl-restart'), continued = find('.sl-continue');
  let stepState = '', locked = false, enabled = true, shown = false, phase = '';
  let seed, tick = -1, seenEvent = -1, noticeTimeout, lastHit = 0, lastHurt = 0;
  let dismissed = false, hasStatus = false, isTouch = !!touch, isDown = false, isReady = false;
  function wireButton(selector, callback) {
    const button = find(selector);
    button.hidden = !callback;
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', event => { event.stopPropagation(); callback?.(); });
  }

  wireButton('.sl-exit', onExit);
  wireButton('.sl-leave', onExit);
  wireButton('.sl-lock', onLock);
  wireButton('.sl-reload', onReload);
  wireButton('.sl-restart', onRestart);
  wireButton('.sl-continue', () => { dismissed = true; outcome.hidden = true; onLock?.(); });

  const fireButton = holdButton(find('.sl-fire'), onFire);
  const reviveButton = holdButton(revive, onRevive);
  function clearHeld() {
    fireButton.release();
    reviveButton.release();
  }
  function syncControls() {
    const modal = !outcome.hidden;
    lock.hidden = !onLock || locked || isTouch || modal || !isReady;
    hint.hidden = isTouch || modal || !isReady;
    unlockHint.hidden = !locked;
    touchControls.hidden = !isTouch || modal || isDown || hasStatus || !isReady;
    cross.hidden = modal || isDown || !isReady;
    panel.classList.toggle('sl-on-touch', isTouch);
  }

  function setVisible(visible) {
    if (!!visible === shown) return;
    shown = !!visible;
    panel.hidden = !shown;
    if (!shown) clearHeld();
  }
  function setLocked(value) {
    locked = !!value;
    syncControls();
  }
  function setTouch(value) {
    isTouch = !!value;
    syncControls();
  }
  function setStatus(value) {
    const message = String(value ?? '');
    setText(status, message);
    hasStatus = !!message;
    status.hidden = !hasStatus;
  }
  function showNotice(message) {
    setText(notice, message);
    notice.hidden = !message;
    clearTimeout(noticeTimeout);
    if (message) noticeTimeout = setTimeout(() => { notice.hidden = true; }, 2900);
  }
  function setProgress(active, total, currentPhase) {
    const key = `${active}/${total}/${currentPhase}`;
    if (stepState === key) return;
    stepState = key;
    const indicators = [];
    for (let i = 1; i <= total; i++) {
      const item = document.createElement('i');
      if (i < active || currentPhase === 'victory') item.className = 'is-complete';
      else if (i === active) item.className = 'is-current';
      indicators.push(item);
    }
    steps.replaceChildren(...indicators);
  }

  function ingest(snapshot, playerId) {
    if (seed !== snapshot.seed || snapshot.tick < tick) {
      seed = snapshot.seed;
      dismissed = false;
      seenEvent = -1;
      lastHit = lastHurt = 0;
      showNotice('');
    }
    tick = snapshot.tick;
    for (const event of snapshot.events ?? []) {
      if (event.id <= seenEvent) continue;
      seenEvent = Math.max(seenEvent, event.id);
      if (event.type === 'hit' && event.playerId === playerId) lastHit = performance.now();
      if (event.type === 'hurt' && event.playerId === playerId) lastHurt = performance.now();
      if (event.type === 'waveClear') showNotice('Смена закрыта');
      if (event.type === 'upgrade' && PERKS[event.upgrade]) showNotice(PERKS[event.upgrade]);
      if (event.type === 'down' && event.playerId === playerId && snapshot.players.length > 1) showNotice('Дождись помощи напарника');
      if (event.type === 'revive' && event.playerId === playerId) showNotice('Ты снова в смене');
    }
  }

  function update(snapshot, { playerId, canRestart = true, canRevive, touch: touchMode } = {}) {
    if (touchMode !== undefined) isTouch = !!touchMode;
    setVisible(true);
    isReady = !!snapshot;
    panel.classList.toggle('sl-pending', !snapshot);
    if (!snapshot) {
      outcome.hidden = true;
      revive.hidden = true;
      syncControls();
      return;
    }
    ingest(snapshot, playerId);
    if (phase !== snapshot.phase) {
      phase = snapshot.phase;
      dismissed = false;
    }
    const local = snapshot.players.find(player => player.id === playerId);
    isDown = !!local?.downed;
    const result = TERMINAL[phase];
    setText(wave, `${String(snapshot.wave).padStart(2, '0')} / ${snapshot.totalWaves}`);
    setProgress(snapshot.wave, snapshot.totalWaves, phase);
    const prepLabel = `Смена начнётся через ${Math.max(1, Math.ceil(snapshot.timeLeft))} с`;
    const combatLabel = `Осталось устройств · ${snapshot.remaining}`;
    setText(objective, phase === 'prep' ? prepLabel : phase === 'combat' ? combatLabel : result?.[0] ?? '');
    setText(team, String(snapshot.players.length));
    const percent = local ? Math.max(0, Math.min(100, Math.ceil(local.hp * 100 / local.maxHp))) : 0;
    setText(hp, `${percent}%`);
    if (meter.value !== percent) {
      meter.value = percent;
      meter.style.setProperty('--sl-protection', `${percent}%`);
    }
    setText(ammo, local ? String(local.ammo) : '—');
    setText(reserve, local && Number.isFinite(local.reserve) ? `/ ${local.reserve}` : '');
    reloading.hidden = !local?.reloadLeft;
    const time = performance.now();
    panel.classList.toggle('sl-hit', lastHit > 0 && time - lastHit < 160);
    panel.classList.toggle('sl-hurt', lastHurt > 0 && time - lastHurt < 240);
    panel.classList.toggle('sl-low', percent <= 28 && percent > 0);
    panel.classList.toggle('sl-down', isDown);
    const nearbyDowned = !!local && snapshot.players.some(player => player.downed && player.id !== playerId &&
      Math.hypot(player.x - local.x, player.z - local.z) <= 1.8);
    const target = local?.reviving ? snapshot.players.find(player => player.id === local.reviving) : null;
    const canHelp = !!onRevive && !!local && !isDown && !!(canRevive ?? nearbyDowned);
    revive.hidden = !canHelp || !!result || hasStatus;
    setText(revive.firstElementChild, target ? `Поднимаю · ${Math.floor(target.reviveProgress * 100)}%` : 'Поднять');
    outcome.hidden = !result || dismissed;
    restart.hidden = !onRestart || !canRestart;
    continued.hidden = phase === 'defeat';
    if (result && !dismissed) {
      setText(outcomeWave, `Смена ${snapshot.wave} из ${snapshot.totalWaves}`);
      setText(title, result[0]);
      setText(description, result[1]);
    }
    const nextEnabled = !result && !isDown && !hasStatus;
    if (enabled && !nextEnabled) clearHeld();
    enabled = nextEnabled;
    syncControls();
  }

  function dispose() {
    fireButton.dispose();
    reviveButton.dispose();
    clearTimeout(noticeTimeout);
    panel.remove();
  }
  setTouch(isTouch);
  return { panel, update, setVisible, setLocked, setTouch, setStatus, dispose };
}
