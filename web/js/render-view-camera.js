// Render-only camera handoff. Preserve the avatar camera used by movement,
// interactions and network input; all synchronous pipeline passes see the chase
// camera, with no second scene draw or render-pipeline ownership changes.
export function createViewCameraAdapter(camera) {
  let view = null;
  const saved = camera.clone();
  function copyPose(from, to) {
    to.position.copy(from.position); to.quaternion.copy(from.quaternion);
    for (const key of ['fov', 'aspect', 'near', 'far', 'zoom', 'filmGauge', 'filmOffset']) to[key] = from[key];
    to.projectionMatrix.copy(from.projectionMatrix);
    to.projectionMatrixInverse.copy(from.projectionMatrixInverse);
    to.updateMatrixWorld(true);
  }
  return {
    set(cameraOrNull) { view = cameraOrNull || null; },
    get active() { return !!view; },
    render(draw) {
      if (!view) return draw();
      copyPose(camera, saved);
      view.aspect = camera.aspect; view.updateProjectionMatrix();
      copyPose(view, camera);
      try { return draw(); } finally { copyPose(saved, camera); }
    },
  };
}
