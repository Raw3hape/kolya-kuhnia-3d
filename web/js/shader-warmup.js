// Three r169 compileAsync polls mutable material.currentProgram without checking
// disposal/replacement. Quality changes can remove it before the next callback.
// Snapshot the exact programs; obsolete work exits safely without touching GL.
export function warmRasterPrograms(renderer, object, camera, scene, { cancelled = () => false, timeoutMs = 15000 } = {}) {
  // Supports lightweight renderer doubles; real WebGLRenderer uses the safe path.
  if (!renderer.compile || !renderer.properties) {
    if (!renderer.compileAsync) return Promise.resolve(false);
    return Promise.resolve(renderer.compileAsync(object, camera, scene)).then(() => !cancelled());
  }
  let programs;
  try {
    programs = [...renderer.compile(object, camera, scene)].map(material => ({ material, program: renderer.properties.get(material).currentProgram }));
  } catch { return Promise.resolve(false); }
  const until = performance.now() + timeoutMs;
  return new Promise(resolve => {
    function check() {
      if (cancelled() || performance.now() >= until || renderer.getContext?.().isContextLost?.()) { resolve(false); return; }
      try {
        for (const { material, program } of programs) {
          if (!program || renderer.properties.get(material).currentProgram !== program) { resolve(false); return; }
        }
        if (programs.every(({ program }) => program.isReady())) { resolve(true); return; }
      } catch { resolve(false); return; }
      setTimeout(check, 10);
    }
    check();
  });
}
