// A single interaction for all present and future one-hand item families.
// The authority remains responsible for reach, obstruction, cooldown and ownership.
export function createHandoffUI({ getSelf, getPlayers, request, canPass = () => true }) {
  let recipient = null, busy = false, last = '', disposed = false, clock = 0, noticeUntil = 0;
  const panel = document.createElement('div'); panel.className = 'kmp-handoff'; panel.hidden = true;
  const button = document.createElement('button'); button.type = 'button';
  button.setAttribute('aria-keyshortcuts', 'H'); panel.append(button); document.body.append(panel);
  const style = document.createElement('style');
  style.textContent = '.kmp-handoff{position:fixed;right:16px;bottom:calc(164px + env(safe-area-inset-bottom));z-index:55}.kmp-handoff[hidden]{display:none}.kmp-handoff button{border:1px solid #ffffff55;background:#143c32ed;color:#fff;border-radius:14px;padding:13px 18px;font:600 14px system-ui;box-shadow:0 4px 18px #0004;max-width:min(350px,90vw)}.kmp-handoff button:disabled{opacity:.55}';
  document.head.append(style);
  function update(dt = .1) {
    if (disposed) return;
    clock += dt;
    if (clock < .1) return; clock = 0;
    const self = getSelf();
    recipient = self?.held ? getPlayers().filter(p => p.id !== self.id && !p.held && Math.hypot(p.x - self.x, p.z - self.z) <= 2.1 &&
      Math.abs((p.eyeY ?? p.y + 1.2) - (self.eyeY ?? self.y + 1.2)) <= 1.5 && canPass(self, p))
      .sort((a, b) => Math.hypot(a.x - self.x, a.z - self.z) - Math.hypot(b.x - self.x, b.z - self.z))[0] || null : null;
    const modal = document.body.classList.contains('kmp-modal-open'), notice = performance.now() < noticeUntil;
    const key = [self?.held, recipient?.id, busy, modal, notice].join('|');
    if (last === key) return; last = key;
    panel.hidden = !recipient || modal;
    button.textContent = notice ? 'Подойдите ближе к другу и освободите руки' : recipient ? `Передать · ${recipient.name}  [H]` : '';
    button.disabled = busy;
  }
  async function give() {
    const self = getSelf(); if (busy || !recipient || !self?.held) return false;
    busy = true; update();
    try { const ok = !!(await request({ kind: 'handoff', id: self.held, targetId: recipient.id }))?.ok; if (!ok) noticeUntil = performance.now() + 2200; return ok; }
    finally { busy = false; update(); }
  }
  const key = e => {
    if (e.code !== 'KeyH' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target?.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName)) return;
    if (recipient && getSelf()?.held) { e.preventDefault(); e.stopImmediatePropagation(); give().catch(() => {}); }
  };
  button.addEventListener('click', () => give().catch(() => {})); window.addEventListener('keydown', key, true);
  return { update, nearbyRecipient: () => recipient, dispose() { disposed = true; window.removeEventListener('keydown', key, true); panel.remove(); style.remove(); } };
}
