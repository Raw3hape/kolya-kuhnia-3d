// One aperture mesh and one preview target, regardless of destination.
const PREVIEW_WIDTH = 640;

export function drawAdventureScene(T, renderer, scene, camera, target = null) {
  const previous = renderer.getRenderTarget();
  const exposure = renderer.toneMappingExposure, toneMapping = renderer.toneMapping;
  try {
    renderer.setRenderTarget(target);
    renderer.toneMappingExposure = 1; renderer.toneMapping = T.NeutralToneMapping;
    renderer.render(scene, camera);
  } finally {
    renderer.toneMappingExposure = exposure; renderer.toneMapping = toneMapping;
    renderer.setRenderTarget(previous);
  }
}

export function createAdventurePortal({ THREE: T, scene, camera, canvas, renderer, entrance }) {
  const previewCamera = new T.PerspectiveCamera();
  const frustum = new T.Frustum(), projection = new T.Matrix4();
  const turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -entrance.yaw);
  let target = null, signature = '';
  const material = new T.ShaderMaterial({
    uniforms: { vista: { value: null }, sceneExposure: { value: 0 } },
    side: T.FrontSide, toneMapped: false,
    vertexShader: `
      varying vec4 screen;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        screen = gl_Position;
      }`,
    fragmentShader: `
      #include <common>
      ${T.ShaderChunk.tonemapping_pars_fragment.replace('uniform float toneMappingExposure;', 'const float toneMappingExposure = 1.0;')}
      uniform sampler2D vista;
      uniform float sceneExposure;
      varying vec4 screen;
      void main() {
        vec2 uv = screen.xy / screen.w * .5 + .5;
        vec3 color = texture2D(vista, clamp(uv, 0., 1.)).rgb;
        color = sceneExposure > 0.0 ? color / sceneExposure : NeutralToneMapping(color);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const aperture = new T.Mesh(new T.PlaneGeometry(entrance.width, entrance.height), material);
  aperture.name = 'adventure_threshold';
  aperture.userData.rasterOnly = true;
  aperture.onBeforeRender = renderer => {
    // The apartment compositor applies exposure after its high/ultra scene pass.
    material.uniforms.sceneExposure.value = renderer.getRenderTarget() ? Math.max(0.01, renderer.toneMappingExposure) : 0;
    material.uniformsNeedUpdate = true;
  };
  aperture.position.set(entrance.x, entrance.height / 2, entrance.z);
  aperture.rotation.y = entrance.yaw;
  aperture.visible = false;
  scene.add(aperture);

  function hide() {
    if (!aperture.visible) return false;
    aperture.visible = false;
    return true;
  }

  function preview(key, prepare) {
    camera.updateMatrixWorld();
    aperture.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const depth = entrance.depth(camera.position);
    if (!frustum.setFromProjectionMatrix(projection).intersectsObject(aperture) || depth > 0.08) return hide();
    const ratio = camera.aspect;
    const width = Math.round(Math.min(PREVIEW_WIDTH, canvas.width, canvas.height * ratio));
    const height = Math.max(1, Math.round(width / ratio));
    if (width < 2) return hide();
    const next = [key, width, height, ...camera.projectionMatrix.elements, ...camera.matrixWorld.elements].join('/');
    if (aperture.visible && next === signature) return false;
    const lateral = entrance.lateral(camera.position);
    const destination = prepare(lateral, -depth);
    if (!target) {
      target = new T.WebGLRenderTarget(width, height, { depthBuffer: true, samples: 0 });
      material.uniforms.vista.value = target.texture;
    } else if (target.width !== width || target.height !== height) target.setSize(width, height);
    previewCamera.copy(camera, false);
    previewCamera.far = destination.far;
    previewCamera.position.set(lateral, camera.position.y + (destination.floor ?? 0), -depth);
    previewCamera.quaternion.copy(turn).multiply(camera.quaternion);
    previewCamera.updateProjectionMatrix();
    drawAdventureScene(T, renderer, destination.scene, previewCamera, target);
    signature = next;
    aperture.visible = true;
    return true;
  }

  function release() {
    const changed = hide();
    target?.dispose(); target = null; material.uniforms.vista.value = null;
    signature = '';
    return changed;
  }

  return { preview, hide, release, invalidate() { signature = ''; }, get visible() { return aperture.visible; } };
}
