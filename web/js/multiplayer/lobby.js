// DOM lobby, deliberately independent of transport. No registration, room secret, or server picker.
// createMultiplayerLobby({ client, getApartment, getCollision, getRoomState, onJoined, onLeft, anchor })
// -> { open({room?}), close(), refresh(), dispose() }. Call open({room}) for an invitation.
import { AVATAR_ROSTER } from './avatars.js';
import { cleanPlayerName } from './client.js';
import { prepareRoom } from './room-preparation.js';

const NAME_KEY = 'kitchen.multiplayer.name';
const STYLE_ID = 'kmp-lobby-style';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function rememberedName() { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
function saveName(name) { try { localStorage.setItem(NAME_KEY, name); } catch { /* Private browsing. */ } }

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style'); style.id = STYLE_ID;
  style.textContent = `
    .kmp-launch { display:flex;align-items:center;gap:7px;margin-top:9px;padding:7px 10px;border:1px solid var(--line-2);border-radius:5px;background:var(--solid);color:var(--accent);font:500 12px/1.3 var(--f-body);cursor:pointer;min-height:34px; }
    .kmp-launch:focus-visible,.kmp-dialog button:focus-visible,.kmp-dialog input:focus-visible { outline:2px solid var(--accent);outline-offset:3px; }
    .kmp-dot { width:7px;height:7px;border-radius:50%;background:var(--faint);flex:none; }
    .kmp-launch[data-state="connected"] .kmp-dot { background:#5b8c57; }
    .kmp-launch[data-state="reconnecting"] .kmp-dot { background:#bd8633; }
    .kmp-dialog { box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));overflow:auto;margin:auto;padding:26px;border:1px solid var(--line-2);border-radius:12px;background:var(--solid);color:var(--ink);box-shadow:var(--shadow-pop);font:14px/1.5 var(--f-body); }
    .kmp-dialog::backdrop { background:rgba(16,25,29,.52); }
    .kmp-dialog[open] { display:flex;flex-direction:column;gap:17px; }
    .kmp-head { display:flex;align-items:flex-start;justify-content:space-between;gap:14px; }
    .kmp-eyebrow { margin:0 0 5px;font:500 10px/1.3 var(--f-data);letter-spacing:.08em;text-transform:uppercase;color:var(--muted); }
    .kmp-dialog h2 { margin:0;font:600 24px/1.12 var(--f-display);letter-spacing:-.025em; }
    .kmp-close { flex:none;width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:4px;background:var(--hover);color:var(--muted);font:22px/1 Arial,sans-serif;cursor:pointer; }
    .kmp-desc,.kmp-note { margin:0;color:var(--muted); }
    .kmp-note { font-size:12px; }
    .kmp-form,.kmp-room { display:flex;flex-direction:column;gap:14px; }
    .kmp-form[hidden],.kmp-room[hidden],.kmp-dialog [hidden] { display:none!important; }
    .kmp-field { display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:500; }
    .kmp-dialog input { box-sizing:border-box;width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--line-2);border-radius:5px;background:var(--paper);color:var(--ink);font:400 16px/1.4 var(--f-body); }
    .kmp-primary,.kmp-secondary,.kmp-exit { min-height:44px;padding:11px 13px;border-radius:5px;font:500 13px/1.3 var(--f-body);cursor:pointer; }
    .kmp-primary { border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink); }
    .kmp-primary:disabled { opacity:.6;cursor:wait; }
    .kmp-secondary { border:1px solid var(--line-2);background:transparent;color:var(--ink); }
    .kmp-exit { border:0;background:transparent;color:var(--muted);text-decoration:underline;text-underline-offset:3px; }
    .kmp-status { margin:0;min-height:1.5em;color:var(--muted);font-size:12px; }
    .kmp-status[data-error="true"] { color:#b14632; }
    .kmp-members { display:flex;flex-direction:column;gap:0;margin:0;padding:0;list-style:none;border-top:1px solid var(--line); }
    .kmp-member { display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--line); }
    .kmp-avatar { display:grid;place-items:center;flex:none;width:30px;height:34px;border-radius:8px 8px 5px 5px;color:#fff;font:500 11px var(--f-data);box-shadow:inset 0 -9px rgba(0,0,0,.13); }
    .kmp-person { flex:1;min-width:0; }
    .kmp-name { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500; }
    .kmp-role { display:block;font:10px/1.3 var(--f-data);color:var(--muted); }
    .kmp-score { flex:none;font:500 13px/1.3 var(--f-data);font-variant-numeric:tabular-nums; }
    .kmp-score small { font-size:10px;font-weight:400;color:var(--muted); }
    .kmp-roster-title { display:flex;align-items:center;justify-content:space-between;font:500 11px/1.4 var(--f-data);text-transform:uppercase;letter-spacing:.04em;color:var(--muted); }
    .kmp-link { font:11px/1.4 var(--f-data)!important;min-height:38px!important; }
    @media (max-width:600px) { .kmp-dialog { padding:22px; } .kmp-launch { min-height:36px;margin-top:7px; } }
    @media (prefers-reduced-motion:no-preference) { .kmp-primary,.kmp-secondary,.kmp-launch { transition:filter .15s; } .kmp-primary:hover,.kmp-secondary:hover,.kmp-launch:hover { filter:brightness(.96); } }
  `;
  document.head.append(style);
}

export function createMultiplayerLobby({
  client, getApartment = () => ({}), getCollision = () => [], getRoomState = () => ({}), onJoined = () => {}, onLeft = () => {},
  anchor = document.querySelector('.title-card') || document.body,
} = {}) {
  if (!client) throw new Error('Lobby requires a multiplayer client.');
  installStyle();
  const launch = el('button', 'kmp-launch'); launch.type = 'button'; launch.id = 'kmp-launch';
  launch.setAttribute('aria-haspopup', 'dialog'); launch.setAttribute('aria-controls', 'kmp-lobby');
  launch.append(el('span', 'kmp-dot'), el('span', 'kmp-launch-label', 'Играть вместе'));
  anchor.append(launch);
  const dialog = el('dialog', 'kmp-dialog'); dialog.id = 'kmp-lobby'; dialog.setAttribute('aria-labelledby', 'kmp-title');
  const head = el('div', 'kmp-head'), heading = el('div');
  const eyebrow = el('p', 'kmp-eyebrow', 'Друзья в квартире');
  const title = el('h2', '', 'Пригласить друзей'); title.id = 'kmp-title';
  heading.append(eyebrow, title);
  const closeButton = el('button', 'kmp-close', '×'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Закрыть');
  head.append(heading, closeButton);
  const description = el('p', 'kmp-desc', 'До 10 игроков. Ваши материалы и мебель увидят все гости.');
  const form = el('form', 'kmp-form');
  const label = el('label', 'kmp-field', 'Ваше имя');
  const nameInput = el('input'); nameInput.name = 'nickname'; nameInput.id = 'kmp-name'; nameInput.type = 'text';
  nameInput.autocomplete = 'nickname'; nameInput.maxLength = 24; nameInput.required = true;
  nameInput.placeholder = 'Как вас зовут?'; nameInput.value = rememberedName();
  label.htmlFor = nameInput.id; label.append(nameInput);
  const permissions = el('p', 'kmp-note', 'Квартиру настраиваете вы. Гости могут гулять, брать оружие и играть вместе.');
  const submit = el('button', 'kmp-primary', 'Создать комнату'); submit.type = 'submit';
  const solo = el('button', 'kmp-secondary', 'Играть одному'); solo.type = 'button'; solo.hidden = true;
  form.append(label, permissions, submit, solo);
  const roomView = el('section', 'kmp-room'); roomView.hidden = true;
  const rosterTitle = el('div', 'kmp-roster-title');
  rosterTitle.append(el('span', '', 'В квартире'), el('span', 'kmp-count', '0 / 10'));
  const members = el('ol', 'kmp-members'); members.setAttribute('aria-label', 'Игроки и очки');
  const invite = el('button', 'kmp-primary', 'Скопировать приглашение'); invite.type = 'button';
  const link = el('input', 'kmp-link'); link.readOnly = true; link.hidden = true; link.setAttribute('aria-label', 'Ссылка приглашения');
  const ownership = el('p', 'kmp-note');
  const exit = el('button', 'kmp-exit', 'Выйти из комнаты'); exit.type = 'button';
  roomView.append(rosterTitle, members, invite, link, ownership, exit);
  const status = el('p', 'kmp-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  dialog.append(head, description, form, roomView, status); document.body.append(dialog);
  let invitation = null, busy = false, disposed = false, lastMembers = '', returnFocus = null, statusError = null, operation = 0;
  let preparation = null, phase = null;

  function invitationURL() {
    return client.inviteUrl;
  }
  function updateURL(nextRoom) {
    const url = new URL(location.href);
    if (nextRoom) {
      url.searchParams.set('room', nextRoom);
      const publicKey = client.inviteUrl && new URL(client.inviteUrl).searchParams.get('key');
      if (publicKey) url.searchParams.set('key', publicKey);
    } else { url.searchParams.delete('room'); url.searchParams.delete('key'); }
    history.replaceState(history.state, '', url);
  }
  function say(message, error = false) { status.textContent = message; status.dataset.error = String(error); }
  const memberSignature = state => JSON.stringify((state?.players || []).map(p => [p.id, p.name, p.avatar, p.score, p.held, p.id === state?.hostId]));
  function renderMembers() {
    const state = client.state, players = state?.players || [];
    const signature = memberSignature(state);
    if (signature === lastMembers) return;
    lastMembers = signature; members.replaceChildren();
    const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.id).localeCompare(String(b.id)));
    for (const player of sorted) {
      const character = AVATAR_ROSTER[player.avatar] || AVATAR_ROSTER[0], row = el('li', 'kmp-member');
      const avatar = el('span', 'kmp-avatar', String((player.avatar || 0) + 1).padStart(2, '0'));
      avatar.style.backgroundColor = character.shirt; avatar.title = character.label; avatar.setAttribute('aria-hidden', 'true');
      const person = el('div', 'kmp-person'), isSelf = player.id === client.id, isHost = player.id === state?.hostId;
      person.append(el('span', 'kmp-name', `${player.name || 'Игрок'}${isSelf ? ' · вы' : ''}`));
      person.append(el('span', 'kmp-role', isHost ? 'Хозяин' : character.label));
      const score = el('span', 'kmp-score'); score.append(document.createTextNode(String(player.score || 0)), el('small', '', ' очк.'));
      row.append(avatar, person, score); members.append(row);
    }
    roomView.querySelector('.kmp-count').textContent = `${players.length} / 10`;
  }
  function refresh() {
    if (disposed) return;
    const connected = client.connected, inRoom = connected || client.status === 'reconnecting';
    launch.dataset.state = client.status;
    launch.querySelector('.kmp-launch-label').textContent = client.status === 'reconnecting' ? 'Восстанавливаем связь…' : inRoom ? `Вместе · ${client.state?.players?.length || 1}/10` : 'Играть вместе';
    const joining = !!invitation;
    title.textContent = inRoom ? 'Вместе в квартире' : joining ? 'Вы приглашены' : 'Пригласить друзей';
    description.textContent = inRoom ? (client.role === 'host' ? 'Вы — хозяин. Квартира настроена по-вашему.' : 'Устраивайтесь. Квартира такая, какой её сделал хозяин.') : joining ? 'Придумайте имя, и можно заходить.' : 'До 10 игроков. Ваши материалы и мебель увидят все гости.';
    form.hidden = inRoom; roomView.hidden = !inRoom;
    submit.textContent = busy ? phase === 'preparing' ? 'Готовим квартиру…' : 'Подключаемся…' : joining ? 'Войти в квартиру' : 'Создать комнату';
    submit.disabled = busy; nameInput.disabled = busy; solo.hidden = !busy && !joining && !statusError;
    permissions.textContent = joining ? 'Квартиру настраивает хозяин. Вы можете гулять, брать оружие и играть вместе.' : 'Квартиру настраиваете вы. Гости могут гулять, брать оружие и играть вместе.';
    invite.disabled = !connected;
    if (inRoom) {
      renderMembers();
      const hostOnline = client.state?.players?.some(p => p.id === client.state?.hostId);
      ownership.textContent = !hostOnline ? 'Хозяин не в сети. Для совместной игры он должен держать комнату открытой.' : client.role === 'host' ? 'Редактировать квартиру можете только вы. Пока вы здесь, комната работает.' : 'Материалы, мебель и свет меняет только хозяин.';
    }
    if (client.status === 'reconnecting') say('Связь прервалась. Восстанавливаем подключение автоматически…');
    else if (statusError) say(statusError.message || String(statusError), true);
  }
  function open({ room } = {}) {
    if (disposed) return;
    if (room) invitation = room;
    returnFocus = document.activeElement;
    document.exitPointerLock?.();
    window.dispatchEvent(new Event('blur')); // Release movement, dragging and automatic fire before trapping keys.
    refresh();
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('kmp-modal-open');
    if (!client.connected) nameInput.focus();
  }
  function close() {
    if (dialog.open) dialog.close();
    document.body.classList.remove('kmp-modal-open');
    if (returnFocus?.isConnected && returnFocus !== document.body) returnFocus.focus();
  }
  function leave() {
    operation++; preparation?.abort(); preparation = null; phase = null;
    client.leave(); invitation = null; statusError = null; busy = false; lastMembers = ''; updateURL(null); close(); refresh(); onLeft();
  }
  async function join(event) {
    event.preventDefault();
    if (busy) return;
    const name = cleanPlayerName(nameInput.value);
    if (!name) { say('Введите ваше имя.', true); nameInput.focus(); return; }
    const serial = ++operation;
    const controller = preparation = new AbortController();
    busy = true; phase = invitation ? 'connecting' : 'preparing'; statusError = null;
    say(invitation ? 'Подключаемся…' : 'Готовим квартиру: загружаем мебель и предметы…'); refresh(); saveName(name);
    try {
      let welcome;
      if (invitation) welcome = await client.join({ room: invitation, name });
      else {
        const room = await prepareRoom(async () => {
          const apartment = await getApartment(), collision = await getCollision(), world = await getRoomState();
          return { apartment, collision, ...world };
        }, { signal: controller.signal });
        if (disposed || operation !== serial) return;
        phase = 'connecting'; say('Подключаемся…'); refresh();
        welcome = await client.create({ name, ...room });
      }
      if (disposed || operation !== serial) return;
      updateURL(client.room); say('Вы в комнате. Пригласите друзей по ссылке.'); await onJoined(welcome);
      if (invitation) close();
    } catch (error) { if (!disposed && operation === serial) { statusError = error; say(error.message || 'Не удалось подключиться. Попробуйте ещё раз.', true); } }
    finally { if (operation === serial) { preparation = null; phase = null; busy = false; refresh(); } }
  }
  async function share() {
    if (!client.room) return;
    const url = invitationURL();
    try { await navigator.clipboard.writeText(url); say('Приглашение скопировано. Отправьте его друзьям.'); }
    catch { link.value = url; link.hidden = false; link.focus(); link.select(); say('Скопируйте эту ссылку и отправьте друзьям.'); }
  }
  const unsubscribe = client.subscribe(event => {
    if (event.type === 'status') {
      if (event.error) statusError = event.error;
      else if (event.status === 'connected') { statusError = null; say('Все изменения игры синхронизируются.'); }
    }
    // Movement snapshots do not change the lobby. Avoid replacing text nodes,
    // hidden/disabled attributes and live-region text twenty times a second.
    if (event.type === 'snapshot' && memberSignature(event.snapshot) === lastMembers) return;
    if (event.type !== 'event') refresh();
  });
  const onLaunch = () => open(), onCancel = () => { document.body.classList.remove('kmp-modal-open'); };
  // A native dialog traps focus; stop game keyboard handlers while it is open.
  const stopGameKeys = event => {
    if (!dialog.open) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName) && event.key === 'Enter' && !busy && !form.hidden) {
      event.preventDefault(); form.requestSubmit();
    }
    event.stopPropagation();
  };
  dialog.addEventListener('keydown', stopGameKeys);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', onCancel);
  launch.addEventListener('click', onLaunch); closeButton.addEventListener('click', close);
  form.addEventListener('submit', join); invite.addEventListener('click', share); exit.addEventListener('click', leave); solo.addEventListener('click', leave);
  refresh();
  return {
    open, close, refresh,
    dispose() {
      disposed = true; operation++; preparation?.abort(); preparation = null;
      unsubscribe(); close(); dialog.remove(); launch.remove();
    },
  };
}
