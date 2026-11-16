// Solo admission boundary for carryable families. Each module supplies its own
// ownership truth and normal release action; the coordinator knows no item types.
// Multiplayer callers bypass this boundary because the room authority owns it.
export function createCarryCoordinator() {
  const families = new Map();
  let tail = Promise.resolve(), disposed = false;

  function register(id, adapter) {
    if (disposed || typeof id !== 'string' || !id || families.has(id) ||
      typeof adapter?.held !== 'function' || typeof adapter?.release !== 'function') {
      throw new TypeError('Invalid or duplicate carry family');
    }
    families.set(id, adapter);
    return () => { if (families.get(id) === adapter) families.delete(id); };
  }

  function prepare(id) {
    const requesting = families.get(id);
    if (disposed || !requesting) return Promise.resolve(false);
    const task = tail.then(async () => {
      if (disposed || families.get(id) !== requesting) return false;
      try {
        for (const [otherId, adapter] of families) {
          if (disposed || families.get(id) !== requesting) return false;
          if (otherId === id || !adapter.held()) continue;
          await adapter.release();
          // Ownership is the evidence. A release acknowledgement alone cannot
          // admit a second item while the first module is still carrying one.
          if (disposed || adapter.held()) return false;
        }
        return !disposed && families.get(id) === requesting;
      } catch { return false; }
    });
    // A failed/cancelled request must not poison later ordinary pickups.
    tail = task.then(() => {}, () => {});
    return task;
  }

  return { register, prepare, dispose() { disposed = true; families.clear(); } };
}
