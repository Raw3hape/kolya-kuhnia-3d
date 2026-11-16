// WebRTC star: the host owns game authority; PeerJS Cloud negotiates direct guest channels.
// Invitations pin the host ECDSA key. Signed nonces prevent room-id impersonation.
// factory(opts) -> { start():Promise, send(packet):bool, close(), inviteKey getter }.
// createAuthority({room,send}) -> {connect(peerId,hello),receive(peerId,packet),disconnect(peerId),dispose()}.
import { createSnapshotEncoder, createSnapshotDecoder } from './snapshot-codec.js';
import { NETWORK_RULES as R } from './rules.js';
const PROTOCOL = R.version, SNAPSHOT_BUFFER = 256 * 1024, MAX_BUFFER = 1024 * 1024, PEER_PREFIX = 'kk3d-';
let libraryPromise = null;

function encode(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value) { return Uint8Array.from(atob(String(value).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
function challenge(room, clientId, nonce) { return new TextEncoder().encode(JSON.stringify({ protocol: PROTOCOL, room, clientId, nonce })); }
export function decodeHostKey(encoded) {
  if (!encoded || encoded.length > 2048) throw new Error('Нужна полная ссылка приглашения от хозяина.');
  let jwk;
  try { jwk = JSON.parse(new TextDecoder().decode(decode(encoded))); } catch { throw new Error('Ссылка приглашения повреждена.'); }
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || jwk.d) throw new Error('Ссылка приглашения повреждена.');
  return jwk;
}
async function hostIdentity(room) {
  const storageKey = `kitchen.multiplayer.host.${room}`;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Optional storage. */ }
  if (saved?.publicJwk && saved?.privateJwk) {
    try {
      const privateKey = await crypto.subtle.importKey('jwk', saved.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      return { privateKey, encoded: encode(JSON.stringify(saved.publicJwk)) };
    } catch { /* A new room may regenerate its key. */ }
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey), privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  try { sessionStorage.setItem(storageKey, JSON.stringify({ publicJwk, privateJwk })); } catch { /* Identity stays in memory. */ }
  return { privateKey: pair.privateKey, encoded: encode(JSON.stringify(publicJwk)) };
}
function loadPeer(scriptURL) {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = scriptURL; script.async = true; script.fetchPriority = 'high';
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Не удалось загрузить совместную игру. Обновите страницу.')); }, 10000);
    script.onload = () => { clearTimeout(timeout); globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error('Библиотека совместной игры недоступна.')); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Не удалось загрузить совместную игру. Проверьте подключение.')); };
    document.head.append(script);
  }).catch(error => { libraryPromise = null; throw error; });
  return libraryPromise;
}
function rawSend(connection, packet) {
  if (!connection?.open) return false;
  const buffered = connection.dataChannel?.bufferedAmount || 0;
  if (packet.type === 'snapshot' && buffered > SNAPSHOT_BUFFER) return false;
  if (buffered > MAX_BUFFER) { connection.close(); return false; }
  try { connection.send(packet); return true; } catch { return false; }
}
export function createPeerTransport({ room, hosting, hello, hostKey, createAuthority, onPacket, onError, onState = () => {}, peerOptions = {}, peerScript = '/vendor/peerjs.min.js' } = {}) {
  let peer = null, authority = null, hostConnection = null, identity = null, closed = false, opened = false;
  let startTimer = null, signallingTimer = null, settleReject = null, signalAttempts = 0;
  const connections = new Map(), timers = new Set();
  const encoder = createSnapshotEncoder(), outgoing = new WeakMap(), capabilities = new WeakMap();
  function sendConnection(connection, packet) {
    if (closed || !connection?.open) return false;
    let queue = outgoing.get(connection);
    if (!queue) { queue = { chain: Promise.resolve(), snapshots: 0, total: 0, seq: null }; outgoing.set(connection, queue); }
    const isSnapshot = packet.type === 'snapshot';
    if (isSnapshot && (queue.snapshots >= 2 || (connection.dataChannel?.bufferedAmount || 0) > SNAPSHOT_BUFFER)) return false;
    if (queue.total > 128) { connection.close(); return false; }
    const prepared = isSnapshot && capabilities.get(connection) ? encoder.prepare(packet) : null;
    queue.total++; if (isSnapshot) queue.snapshots++;
    queue.chain = queue.chain.then(async () => {
      if (closed || !connection.open) return;
      const wire = prepared ? await (prepared.base !== null && queue.seq === prepared.base ? prepared.delta() : prepared.full()) : packet;
      if (closed || !connection.open) return;
      if (rawSend(connection, wire) && isSnapshot) queue.seq = packet.seq;
    }).catch(() => { connection.close(); }).finally(() => { queue.total--; if (isSnapshot) queue.snapshots--; });
    return true;
  }
  function later(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; }
  function error(message, code) { const e = new Error(message); if (code) e.code = code; return e; }
  function fail(reason) { if (!closed) { settleReject?.(reason); settleReject = null; onError(reason); } }
  function reconnectSignalling() {
    if (closed || signallingTimer || !peer?.disconnected || peer.destroyed) return;
    onState({ state: 'signalling-offline' });
    signallingTimer = later(() => {
      signallingTimer = null;
      if (closed || !peer?.disconnected || peer.destroyed) return;
      try { peer.reconnect(); } catch { /* Existing direct channels stay alive. */ }
      signalAttempts++; reconnectSignalling();
    }, Math.min(5000, 1000 + signalAttempts * 500));
  }
  function acceptGuest(connection) {
    // "local" is the private host bridge, never a valid remote PeerJS identity.
    if (closed || connections.size >= 20 || connection.peer === peer.id || connection.peer === 'local') { connection.close(); return; }
    connections.get(connection.peer)?.connection.close();
    const entry = { connection, proved: false, joined: false, nonce: null, timer: null }; connections.set(connection.peer, entry);
    entry.timer = later(() => { if (!entry.joined) connection.close(); }, 12000);
    connection.on('data', async packet => {
      if (closed || !packet || typeof packet !== 'object') return;
      if (!entry.proved) {
        if (packet.type !== 'auth' || packet.protocol !== PROTOCOL || packet.room !== room || packet.clientId !== connection.peer || !/^[A-Za-z0-9_-]{16,128}$/.test(packet.nonce || '')) { connection.close(); return; }
        if (entry.nonce) return; entry.nonce = packet.nonce; capabilities.set(connection, packet.codec === 1);
        try {
          const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, challenge(room, packet.clientId, packet.nonce));
          if (closed || !connection.open) return;
          entry.proved = true;
          sendConnection(connection, { type: 'proof', protocol: PROTOCOL, room, clientId: packet.clientId, nonce: packet.nonce, signature: encode(signature) });
        } catch { connection.close(); }
      } else if (!entry.joined) {
        if (packet.type !== 'join' || packet.room !== room) { connection.close(); return; }
        entry.joined = true; clearTimeout(entry.timer); timers.delete(entry.timer); authority.connect(connection.peer, packet);
      } else authority.receive(connection.peer, packet);
    });
    const remove = () => {
      clearTimeout(entry.timer); timers.delete(entry.timer);
      if (connections.get(connection.peer) !== entry) return;
      connections.delete(connection.peer); if (entry.joined) authority?.disconnect(connection.peer);
    };
    connection.on('close', remove); connection.on('error', () => { remove(); connection.close(); });
  }
  async function start() {
    if (!globalThis.RTCPeerConnection || !crypto.subtle) throw error('Этот браузер не поддерживает совместную игру. Откройте ссылку в Safari, Chrome или Firefox.');
    if (hosting && typeof createAuthority !== 'function') throw error('Не удалось запустить игровую комнату.');
    const Peer = await loadPeer(peerScript); if (closed) return;
    let publicKey = null;
    if (hosting) identity = await hostIdentity(room);
    else publicKey = await crypto.subtle.importKey('jwk', decodeHostKey(hostKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (closed) return;
    peer = new Peer(hosting ? PEER_PREFIX + room : undefined, { debug: 0, ...peerOptions });
    return new Promise((resolve, reject) => {
      settleReject = reject;
      startTimer = later(() => fail(error('Не удалось связаться с хозяином. Проверьте сеть и попробуйте ещё раз.', 'connection_timeout')), 15000);
      peer.on('open', async () => {
        if (closed) return;
        signalAttempts = 0; onState({ state: 'signalling-online' }); if (opened) return; opened = true;
        try {
          if (hosting) {
            authority = await createAuthority({ room, send: (peerId, packet) => {
              if (closed) return false;
              if (peerId === 'local') { queueMicrotask(() => { if (!closed) onPacket(packet); }); return true; }
              return sendConnection(connections.get(peerId)?.connection, packet);
            } });
            if (closed) { authority?.dispose(); return; }
            peer.on('connection', acceptGuest); authority.connect('local', hello);
            clearTimeout(startTimer); timers.delete(startTimer); settleReject = null; resolve();
          } else {
            const connection = peer.connect(PEER_PREFIX + room, { serialization: 'binary', reliable: true, metadata: { protocol: PROTOCOL } }); hostConnection = connection;
            const nonce = encode(crypto.getRandomValues(new Uint8Array(24))); let verified = false, checking = false, incoming = Promise.resolve();
            const decoder = createSnapshotDecoder();
            connection.on('open', () => sendConnection(connection, { type: 'auth', protocol: PROTOCOL, room, clientId: peer.id, nonce, codec: typeof DecompressionStream === 'undefined' ? 0 : 1 }));
            connection.on('data', async packet => {
              if (closed || !packet || typeof packet !== 'object') return;
              if (!verified) {
                if (checking) return;
                if (packet.type !== 'proof' || packet.protocol !== PROTOCOL || packet.room !== room || packet.clientId !== peer.id || packet.nonce !== nonce) { fail(error('Не удалось подтвердить хозяина комнаты. Откройте полную ссылку приглашения.', 'host_identity')); return; }
                checking = true;
                try {
                  verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, decode(packet.signature), challenge(room, peer.id, nonce));
                  if (!verified) throw new Error('Invalid signature');
                  sendConnection(connection, hello); clearTimeout(startTimer); timers.delete(startTimer); settleReject = null; resolve();
                } catch { fail(error('Подпись хозяина не совпала с приглашением. Попросите новую ссылку.', 'host_identity')); }
              } else {
                incoming = incoming.then(async () => { const decoded = await decoder.decode(packet); if (!closed) onPacket(decoded); })
                  .catch(() => fail(error('Не удалось восстановить состояние комнаты. Переподключаемся…', 'snapshot_decode')));
              }
            });
            connection.on('close', () => { if (!closed) fail(error('Связь с хозяином прервалась.', 'host_offline')); });
            connection.on('error', () => { if (!closed) fail(error('Не удалось установить прямое соединение. Эта сеть может блокировать WebRTC.', 'network_blocked')); });
          }
        } catch (reason) { fail(reason); }
      });
      peer.on('disconnected', reconnectSignalling);
      peer.on('error', reason => {
        if (closed) return;
        if (opened && ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(reason.type)) { reconnectSignalling(); return; }
        const unavailable = reason.type === 'peer-unavailable';
        fail(error(unavailable ? 'Хозяин не в сети. Попросите его открыть комнату.' : reason.type === 'unavailable-id' ? 'Эта комната уже открыта. Создайте новую.' : 'Соединение недоступно. Проверьте сеть и попробуйте ещё раз.', unavailable ? 'host_offline' : reason.type));
      });
      peer.on('close', () => { if (!closed) fail(error('Соединение с комнатой закрыто.', 'host_offline')); });
    });
  }
  return {
    start,
    send(packet) {
      if (closed) return false;
      if (hosting) { if (!authority) return false; authority.receive('local', packet); return true; }
      return sendConnection(hostConnection, packet);
    },
    close() {
      if (closed) return;
      if (hosting) for (const { connection } of connections.values()) rawSend(connection, { type: 'event', event: { kind: 'room-closed', reason: 'host-left' } });
      closed = true; settleReject?.(error('Соединение закрыто.')); settleReject = null;
      for (const timer of timers) clearTimeout(timer); timers.clear();
      authority?.dispose(); authority = null; encoder.clear();
      const ownedPeer = peer, ownedConnections = [...connections.values()].map(entry => entry.connection);
      const ownedHost = hostConnection; connections.clear(); hostConnection = null; peer = null;
      const finish = () => { for (const connection of ownedConnections) connection.close(); ownedHost?.close(); ownedPeer?.destroy(); };
      // BinaryPack serializes asynchronously. Let the small room-closed notice flush before teardown.
      if (hosting && ownedConnections.length) setTimeout(finish, 20); else finish();
    },
    get inviteKey() { return identity?.encoded || hostKey; },
  };
}
