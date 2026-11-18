// Lightweight DOM overlay for walking, fitting gear and riding. The controller
// owns bindings and camera, while the HUD turns touch gestures into intents.
const STYLE_URL = new URL('../css/snow.css', import.meta.url);
const SURFACE = { powder: 'Пухляк', groomed: 'Укатанный снег', ice: 'Лёд' };
const GEAR = {
  ski: { name: 'Лыжи', take: 'Взять лыжи' },
  board: { name: 'Сноуборд', take: 'Взять сноуборд' },
};
const ICON = {
  center: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h3m10 0h3M12 4v3m0 10v3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M2 20v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m4 0v-2a5 5 0 0 0-3-4.6M16 4a3.2 3.2 0 0 1 0 6.4"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>',
};

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function readableDistance(value) {
  if (value < 1000) return `${Math.floor(value)} м`;
  return `${(Math.floor(value / 100) / 10).toFixed(1).replace('.', ',')} км`;
}

function holdControl(button, changed, signal) {
  let held = false, pointer, keyTimer;
  function set(value) {
    if (held === value) return;
    held = value;
    button.classList.toggle('is-held', value);
    changed(value);
  }
  function release() {
    clearTimeout(keyTimer);
    const id = pointer;
    pointer = undefined;
    if (id !== undefined && button.hasPointerCapture(id)) button.releasePointerCapture(id);
    set(false);
  }
  button.addEventListener('pointerdown', event => {
    if (event.button || pointer !== undefined || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    pointer = event.pointerId;
    button.setPointerCapture(pointer);
    set(true);
  }, { signal });
  for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(kind, event => {
      if (event.pointerId !== pointer) return;
      event.stopPropagation();
      release();
    }, { signal });
  }
  button.addEventListener('click', event => {
    event.stopPropagation();
    if (event.detail || button.disabled) return;
    set(true);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(release, 165);
  }, { signal });
  return release;
}

export function createSnowHud({ onEquip, onReturn, onReset, onInput, onCenter, config } = {}) {
  if (!document.getElementById('snow-hud-style')) {
    const css = document.createElement('link');
    css.id = 'snow-hud-style';
    css.rel = 'stylesheet';
    css.href = STYLE_URL.href;
    document.head.append(css);
  }
  const panel = document.createElement('section');
  panel.className = 'snow-hud';
  panel.setAttribute('aria-label', 'Снежный спуск');
  panel.hidden = true;
  panel.innerHTML = `
    <header class="snow-panel">
      <h2 class="snow-mode">Снежный спуск</h2>
      <div class="snow-instruments" hidden>
        <div class="snow-speed-line">
          <output class="snow-speed" aria-label="Скорость" aria-live="off">0</output>
          <span>км/ч</span>
        </div>
        <div class="snow-speed-track" aria-hidden="true"><i></i></div>
        <div class="snow-readout">
          <output class="snow-distance" aria-label="Пройдено" aria-live="off">0 м</output>
          <span class="snow-gear"></span>
        </div>
        <span class="snow-condition"></span>
      </div>
    </header>
    <nav class="snow-actions" aria-label="Управление спуском">
      <span class="snow-group" aria-label="Участников на склоне" hidden>${ICON.users}<output class="snow-team"></output></span>
      <button type="button" class="snow-center" aria-label="Смотреть по ходу" hidden>${ICON.center}</button>
      <button type="button" class="snow-reset" hidden>К снаряжению</button>
      <button type="button" class="snow-return">На кухню</button>
    </nav>
    <aside class="snow-message" role="status" aria-live="polite" hidden></aside>
    <div class="snow-fitting" hidden>
      <div class="snow-approach">
        <span>Подойди к лыжам или сноуборду</span>
        <small class="snow-walk-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Ходьба · Мышь — обзор</small>
        <small class="snow-walk-touch">Слева ходьба · справа обзор</small>
      </div>
      <button type="button" class="snow-equip" hidden><kbd>E</kbd><span></span></button>
    </div>
    <div class="snow-legend" aria-label="Клавиши" hidden>
      <span><kbd>A</kbd><kbd>D</kbd> Поворот</span>
      <span><kbd>W</kbd> Разгон</span>
      <span><kbd>Мышь</kbd> Обзор <kbd>C</kbd> По ходу</span>
      <span><kbd>S</kbd> Тормоз</span>
      <span><kbd>Пробел</kbd> Прыжок</span>
      <span><kbd>Q</kbd><kbd>E</kbd> Вращение</span>
      <span><kbd>Z</kbd><kbd>X</kbd> Сальто</span>
    </div>
    <div class="snow-touch" hidden>
      <div class="snow-edges" role="group" aria-label="Поворот и вращение">
        <button type="button" data-control="left" aria-label="Влево">${ICON.left}</button>
        <button type="button" data-control="right" aria-label="Вправо">${ICON.right}</button>
      </div>
      <div class="snow-maneuvers" role="group" aria-label="Разгон, торможение и прыжок">
        <button type="button" data-control="flip" class="snow-flip" hidden>Сальто</button>
        <button type="button" data-control="jump" class="snow-jump">Прыжок</button>
        <button type="button" data-control="brake">Тормоз</button>
        <button type="button" data-control="push">Разгон</button>
      </div>
    </div>
  `;
  document.body.append(panel);

  const find = selector => panel.querySelector(selector);
  const instrument = find('.snow-instruments'), speed = find('.snow-speed'), meter = find('.snow-speed-track i');
  const distance = find('.snow-distance'), gear = find('.snow-gear'), condition = find('.snow-condition');
  const group = find('.snow-group'), team = find('.snow-team'), reset = find('.snow-reset');
  const center = find('.snow-center');
  const fitting = find('.snow-fitting'), approach = find('.snow-approach'), equip = find('.snow-equip');
  const equipLabel = equip.querySelector('span');
  const legend = find('.snow-legend'), touchControls = find('.snow-touch'), flipControl = find('.snow-flip');
  const message = find('.snow-message');
  const listeners = new AbortController();
  const { signal } = listeners;
  const touch = { left: false, right: false, push: false, brake: false, jump: false, flip: false };
  const releases = new Map();
  let nearest = null, speedValue = null, phase, seed, eventId = 0, notice = '', noticeUntil = 0;
  let canRide = false;
  const sendInput = () => {
    const steer = Number(touch.right) - Number(touch.left);
    onInput?.({ steer, spin: steer, push: Number(touch.push), tuck: touch.push,
      brake: Number(touch.brake), jump: touch.jump, flip: Number(touch.flip) });
  };
  for (const button of touchControls.querySelectorAll('button')) {
    const name = button.dataset.control;
    releases.set(name, holdControl(button, value => { touch[name] = value; sendInput(); }, signal));
  }
  const releaseControls = () => { for (const release of releases.values()) release(); };
  window.addEventListener('blur', releaseControls, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseControls(); }, { signal });
  find('.snow-return').addEventListener('click', () => onReturn?.(), { signal });
  center.addEventListener('click', () => onCenter?.(), { signal });
  reset.addEventListener('click', () => onReset?.({ walk: true }), { signal });
  equip.addEventListener('click', () => { if (nearest) onEquip?.(nearest); }, { signal });

  function events(snapshot, playerId, now) {
    if (snapshot.seed !== seed) {
      seed = snapshot.seed;
      eventId = 0;
      notice = '';
      noticeUntil = 0;
    }
    for (const e of snapshot.events ?? []) {
      if (e.id <= eventId || e.playerId !== playerId) continue;
      eventId = e.id;
      if (e.type === 'crash') notice = 'Падение · возвращаемся на склон';
      else if (e.type === 'land' && e.bonus) {
        const rotations = Math.round(Math.abs(e.rotation || 0) / (Math.PI * 2));
        const flips = Math.round(Math.abs(e.flips || 0) / (Math.PI * 2));
        const label = flips ? 'Сальто' : rotations ? `Поворот ${rotations * 360}°` : 'Длинный прыжок';
        notice = `${label} · +${e.bonus}`;
      } else if (e.type === 'land' && e.airTime > 0.65) notice = 'Чистое приземление';
      else if (e.type === 'recover' || e.type === 'reset') { notice = ''; noticeUntil = 0; continue; }
      else continue;
      noticeUntil = now + (e.type === 'crash' ? 1800 : 2550);
    }
  }

  function update(snapshot, { playerId, nearGear, status = '', touch: showTouch = false } = {}) {
    const player = snapshot?.players?.find(entry => entry.id === playerId);
    panel.hidden = !player && !status;
    if (!player) {
      message.hidden = !status;
      setText(message, status);
      return;
    }
    const now = performance.now();
    events(snapshot, playerId, now);
    const nextPhase = player.phase, walking = nextPhase === 'walk';
    const riding = nextPhase === 'ride' || nextPhase === 'air';
    const inAir = nextPhase === 'air';
    if (canRide && (!riding || !!status || !showTouch)) releaseControls();
    if (phase === 'air' && !inAir && touch.flip) releases.get('flip')?.();
    canRide = riding && !status && showTouch;
    phase = nextPhase;
    nearest = walking && !status && GEAR[nearGear] ? nearGear : null;
    instrument.hidden = walking;
    fitting.hidden = !walking || !!status;
    approach.hidden = !!nearest;
    equip.hidden = !nearest;
    if (nearest) setText(equipLabel, GEAR[nearest].take);
    panel.classList.toggle('is-touch', showTouch);
    reset.hidden = walking || !onReset;
    reset.disabled = !!status;
    center.hidden = !canRide || !onCenter;
    group.hidden = snapshot.players.length < 2;
    if (!group.hidden) setText(team, String(snapshot.players.length));
    legend.hidden = walking || showTouch || !!status;
    touchControls.hidden = !canRide;
    flipControl.hidden = !inAir;
    const headline = status || (now < noticeUntil ? notice : '');
    message.hidden = !headline;
    setText(message, headline);
    if (walking) return;
    const velocity = Math.round(Math.max(0, player.speed) * 3.6);
    if (velocity !== speedValue) {
      speedValue = velocity;
      setText(speed, String(velocity));
      const limit = config?.motion?.maxSpeed;
      if (limit) meter.style.transform = `scaleX(${Math.min(1, velocity / (limit * 3.6))})`;
    }
    setText(distance, readableDistance(player.distance));
    setText(gear, GEAR[player.equipment]?.name ?? '');
    setText(condition, nextPhase === 'crashed' ? 'Падение' : inAir
      ? `В воздухе · ${player.airTime.toFixed(1).replace('.', ',')} с`
      : SURFACE[player.surface] ?? '');
  }

  function dispose() {
    releaseControls();
    listeners.abort();
    panel.remove();
  }

  return { update, dispose };
}
