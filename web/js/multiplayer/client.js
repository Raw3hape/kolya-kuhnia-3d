// Transport-independent orchestration. createAuthority({room,send}) is supplied by the app.
// createMultiplayerClient({onSnapshot,onEvent,onStatus,onWelcome,createAuthority,transportFactory,peerOptions})
// -> create({name,apartment,collision,objects,doors,items,seats,interactions,interactionMeta}), join({room,name,key?}), send(action), request(action),
//    leave(), dispose(), subscribe(fn); getters state/self/role/connected/room/id/status/inviteUrl.
import { createPeerTransport } from './peer-transport.js';
import { NETWORK_RULES as R } from './rules.js';
const TOKEN_PREFIX = 'kitchen.multiplayer.session.';
const PAUSE_MS = R.staleMs, WATCHDOG_MS = R.timeoutMs, RECONNECT_MS = R.resumeMs, REQUEST_MS = 6000;
const ERROR_MESSAGES = {
  room_full: 'В комнате уже 10 игроков.', full: 'В комнате уже 10 игроков.',
  room_not_found: 'Комната не найдена. Попросите хозяина прислать новое приглашение.',
  not_found: 'Комната не найдена. Попросите хозяина прислать новое приглашение.',
  invalid_name: 'Введите имя от 1 до 24 символов.', invalid_room: 'Ссылка приглашения повреждена.',
  unauthorized: 'Не удалось подтвердить вход. Откройте приглашение ещё раз.',
  forbidden: 'Это действие доступно только хозяину квартиры.',
};
export function cleanPlayerName(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 24);
}
function roomName(value) {
  const room = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(room)) throw new Error(ERROR_MESSAGES.invalid_room);
  return room;
}
function readToken(room) { try { return sessionStorage.getItem(TOKEN_PREFIX + room) || undefined; } catch { return undefined; } }
function writeToken(room, token) { try { if (token) sessionStorage.setItem(TOKEN_PREFIX + room, token); } catch { /* Optional per-tab storage. */ } }
function protocolError(message) {
  const code = message.code || message.error || 'unavailable';
  const error = new Error(ERROR_MESSAGES[code] || (typeof message.message === 'string' ? message.message : 'Не удалось войти в комнату. Попробуйте ещё раз.'));
  error.code = code; return error;
}
export function createMultiplayerClient({
  onSnapshot = () => {}, onEvent = () => {}, onStatus = () => {}, onWelcome = () => {},
  createAuthority, transportFactory = createPeerTransport, peerOptions = {}, peerScript = '/vendor/peerjs.min.js',
} = {}) {
  let transport = null, status = 'idle', room = null, id = null, snapshot = null, hostId = null;
  let sequence = -1, generation = 0, attempts = 0, auth = null, token = null, welcomed = false, disposed = false;
  let lastSnapshot = 0, retryTimer = null, watchdogTimer = null, connectTimer = null, disconnectSince = 0, lastHeartbeat = 0;
  let initialResolve = null, initialReject = null, requestSequence = 0, hostKey = null;
  const listeners = new Set(), pending = new Map();
  function call(fn, arg) { try { fn(arg); } catch (error) { console.error('Multiplayer callback:', error); } }
  function notify(event) { for (const listener of listeners) call(listener, event); }
  function setStatus(next, error = null) {
    status = next;
    const value = { status, error, attempt: attempts, room, connected: status === 'connected' };
    call(onStatus, value); notify({ type: 'status', ...value });
  }
  function clearTimers() {
    clearTimeout(retryTimer); clearTimeout(connectTimer); clearInterval(watchdogTimer);
    retryTimer = connectTimer = watchdogTimer = null;
  }
  function rejectRequests(error) {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  function closeTransport() { const previous = transport; transport = null; previous?.close(); }
  function failInitial(error) { initialReject?.(error); initialResolve = initialReject = null; }
  function acceptSnapshot(value) {
    if (!value || !Array.isArray(value.players)) return;
    if (Number.isFinite(value.seq) && value.seq <= sequence) return;
    sequence = Number.isFinite(value.seq) ? value.seq : sequence + 1;
    snapshot = value; hostId = value.hostId || hostId; lastSnapshot = Date.now();
    if (welcomed && status === 'reconnecting' && transport) { attempts = 0; disconnectSince = 0; setStatus('connected'); }
    call(onSnapshot, value); notify({ type: 'snapshot', snapshot: value });
  }
  function terminal(error, nextStatus = 'error') {
    clearTimers(); closeTransport(); rejectRequests(error); setStatus(nextStatus, error); failInitial(error);
  }
  function reconnect(epoch, reason) {
    if (epoch !== generation || !auth || disposed || retryTimer) return;
    clearTimeout(connectTimer); clearInterval(watchdogTimer); closeTransport();
    rejectRequests(new Error('Связь прервана. Дождитесь переподключения.'));
    if (!welcomed || auth.type === 'create' || reason?.code === 'host_identity') {
      terminal(reason || new Error('Не удалось подключиться к комнате. Попробуйте ещё раз.')); return;
    }
    if (!disconnectSince) disconnectSince = Date.now();
    if (Date.now() - disconnectSince > RECONNECT_MS) {
      terminal(new Error('Хозяин не в сети. Попросите новое приглашение, когда он вернётся.'), 'closed'); return;
    }
    attempts++; setStatus('reconnecting');
    const delay = Math.min(6000, 400 * 2 ** Math.min(attempts - 1, 4)) + Math.random() * 250;
    retryTimer = setTimeout(() => { retryTimer = null; connect(epoch); }, delay);
  }
  function handlePacket(message, epoch) {
    if (epoch !== generation || !message || typeof message !== 'object') return;
    if (message.type === 'welcome') {
      clearTimeout(connectTimer); clearInterval(watchdogTimer);
      id = message.id; hostId = message.hostId; token = message.token || token;
      writeToken(room, token); welcomed = true; attempts = 0; sequence = -1; disconnectSince = 0; lastSnapshot = Date.now();
      setStatus('connected'); acceptSnapshot(message.snapshot);
      call(onWelcome, message); notify({ type: 'welcome', welcome: message });
      initialResolve?.(message); initialResolve = initialReject = null;
      watchdogTimer = setInterval(() => {
        if (Date.now() - lastHeartbeat >= R.heartbeatMs) { lastHeartbeat = Date.now(); transport?.send({ type: 'ping', clientTime: lastHeartbeat }); }
        const age = Date.now() - lastSnapshot;
        if (age > PAUSE_MS && status === 'connected') setStatus('reconnecting');
        if (age > WATCHDOG_MS && auth?.type !== 'create') reconnect(epoch, new Error('Хозяин не отвечает.'));
      }, 500);
    } else if (message.type === 'snapshot') acceptSnapshot(message.snapshot || message);
    else if (message.type === 'event') {
      call(onEvent, message.event); notify({ type: 'event', event: message.event });
      if (message.event?.kind === 'room-closed') terminal(new Error('Хозяин закрыл комнату. Можно продолжить играть одному.'), 'closed');
    } else if (message.type === 'result') {
      const item = pending.get(message.requestId);
      if (item) { clearTimeout(item.timer); pending.delete(message.requestId); item.resolve(message); }
    } else if (message.type === 'error') {
      const error = protocolError(message); terminal(error, ['room_full', 'full'].includes(error.code) ? 'full' : 'error');
    }
  }
  async function connect(epoch) {
    if (epoch !== generation || !auth || disposed) return;
    const hello = welcomed ? { type: 'join', version: R.version, room, name: auth.name, token } : { ...auth, version: R.version, room, ...(token ? { token } : {}) };
    let next;
    try {
      next = transportFactory({
        room, hosting: auth.type === 'create', hello, hostKey, createAuthority, peerOptions, peerScript,
        onPacket: message => { if (transport === next) handlePacket(message, epoch); },
        onError: reason => { if (epoch === generation && transport === next) reconnect(epoch, reason); },
        onState: network => notify({ type: 'network', ...network }),
      });
      transport = next;
      connectTimer = setTimeout(() => { if (transport === next) reconnect(epoch, new Error('Не удалось войти в комнату. Проверьте сеть.')); }, 18000);
      await next.start(); if (epoch === generation && transport === next) hostKey = next.inviteKey || hostKey;
    } catch (error) { if (epoch === generation && (!next || transport === next)) reconnect(epoch, error); }
  }
  function start(nextAuth) {
    if (disposed) return Promise.reject(new Error('Совместная игра закрыта.'));
    const nextName = cleanPlayerName(nextAuth.name);
    if (!nextName) return Promise.reject(new Error(ERROR_MESSAGES.invalid_name));
    const nextRoom = roomName(nextAuth.room || crypto.randomUUID());
    stop(false); room = nextRoom; auth = { ...nextAuth, name: nextName }; token = readToken(room); welcomed = false;
    hostKey = nextAuth.key || (nextAuth.type === 'join' ? new URL(location.href).searchParams.get('key') : null);
    if (auth.type === 'create') token = undefined;
    setStatus('connecting');
    const promise = new Promise((resolve, reject) => { initialResolve = resolve; initialReject = reject; });
    connect(generation); return promise;
  }
  function send(action) {
    if (status !== 'connected' || Date.now() - lastSnapshot > PAUSE_MS) return false;
    return transport?.send({ type: 'action', action }) || false;
  }
  function request(action) {
    const requestId = `${id || 'pending'}:${++requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Хозяин не ответил. Попробуйте ещё раз.')); }, REQUEST_MS);
      pending.set(requestId, { resolve, reject, timer });
      if (!send({ ...action, requestId })) { clearTimeout(timer); pending.delete(requestId); reject(new Error('Нет связи с комнатой.')); }
    });
  }
  function stop(announce = true) {
    generation++; transport?.send({ type: 'leave' }); clearTimers(); closeTransport();
    const error = new Error('Вы вышли из комнаты.'); rejectRequests(error); failInitial(error);
    auth = null; id = null; snapshot = null; hostId = null; room = null; token = null; hostKey = null;
    sequence = -1; attempts = 0; welcomed = false; disconnectSince = 0;
    if (announce) setStatus('idle');
  }
  return {
    create: ({ name, apartment, collision, objects, doors, items, seats, interactions, interactionMeta }) => start({ type: 'create', name, apartment, collision, objects, doors, items, seats, interactions, interactionMeta }),
    join: ({ room: nextRoom, name, key }) => start({ type: 'join', room: nextRoom, name, key }),
    send, request, leave: () => stop(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { stop(); disposed = true; listeners.clear(); },
    get state() { return snapshot; }, get self() { return snapshot?.players?.find(player => player.id === id) || null; },
    get role() { return id && hostId ? (id === hostId ? 'host' : 'guest') : null; },
    get connected() { return status === 'connected' && !!transport && Date.now() - lastSnapshot <= PAUSE_MS; },
    get room() { return room; }, get id() { return id; }, get status() { return status; },
    get inviteUrl() {
      if (!room) return null;
      const url = new URL(location.href); url.searchParams.set('room', room);
      const publicKey = transport?.inviteKey || hostKey;
      if (publicKey) url.searchParams.set('key', publicKey);
      return url.href;
    },
  };
}
