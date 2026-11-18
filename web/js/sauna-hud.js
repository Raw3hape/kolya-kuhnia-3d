const STYLE = new URL('../css/sauna.css', import.meta.url);
const AUDIO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h4l4-4v12l-4-4H4zM15 9a4 4 0 0 1 0 6m2.8-8a7 7 0 0 1 0 10"/><path class="sauna-audio-off" d="m4 3 16 18"/></svg>';

export function createSaunaHud({ name, onReturn, onUse, onAudio }) {
  if (!document.getElementById('sauna-style')) {
    const style = document.createElement('link');
    style.id = 'sauna-style';
    style.rel = 'stylesheet';
    style.href = STYLE.href;
    document.head.append(style);
  }
  const root = document.createElement('section');
  root.className = 'sauna-hud';
  root.setAttribute('aria-label', name);
  root.innerHTML = `
    <header class="sauna-location"><strong></strong><span></span></header>
    <nav class="sauna-nav">
      <span class="sauna-people" hidden aria-label="Гостей в бане"></span>
      <button type="button" class="sauna-audio" aria-label="Звук атмосферы" aria-pressed="true">${AUDIO_ICON}</button>
      <button type="button" class="sauna-return">На кухню</button>
    </nav>
    <div class="sauna-reticle" aria-hidden="true"></div>
    <p class="sauna-status" role="status" hidden></p>
    <button type="button" class="sauna-action" aria-keyshortcuts="E" hidden><kbd aria-hidden="true">E</kbd><span></span></button>
    <div class="sauna-help"><span><kbd>WASD</kbd> Ходьба</span><span><kbd>Мышь</kbd> Взгляд</span></div>
    <div class="sauna-joystick" aria-hidden="true" hidden><i></i></div>
  `;
  document.body.append(root);
  const find = selector => root.querySelector(selector);
  const location = find('.sauna-location span'), players = find('.sauna-people'), status = find('.sauna-status');
  const action = find('.sauna-action'), title = action.querySelector('span'), help = find('.sauna-help');
  const reticle = find('.sauna-reticle'), audio = find('.sauna-audio'), back = find('.sauna-return'), joystick = find('.sauna-joystick');
  find('.sauna-location strong').textContent = name;
  action.addEventListener('click', onUse);
  audio.addEventListener('click', onAudio);
  back.addEventListener('click', onReturn);
  let shown;
  function show(next) {
    const key = Object.values(next).join('\n');
    if (shown === key) return;
    shown = key;
    const { zone, count, label, touch, locked, waiting, returning, message, muted, resting } = next;
    root.classList.toggle('sauna-touch', touch);
    root.classList.toggle('sauna-pointed', !!label && !resting);
    location.textContent = zone;
    location.hidden = zone === name;
    players.textContent = count;
    players.hidden = count < 2;
    action.hidden = !label || waiting || returning;
    if (label) title.textContent = label;
    help.hidden = resting || touch || !!label;
    status.textContent = message;
    status.hidden = !message;
    audio.setAttribute('aria-pressed', String(!muted));
    reticle.hidden = touch || resting || waiting || !locked;
    back.disabled = returning;
  }

  function move(x, y, dx = 0, dy = 0) {
    joystick.hidden = x === null;
    if (x === null) return;
    joystick.style.left = x + 'px';
    joystick.style.top = y + 'px';
    joystick.firstElementChild.style.transform = `translate(${dx}px,${dy}px)`;
  }
  return { show, move, dispose() { root.remove(); } };
}
