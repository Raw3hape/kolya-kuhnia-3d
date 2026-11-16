// HP sight traces only solid world geometry. Sprites require a camera-aware
// raycast and skeletal/transient actors are not architectural occluders.
export function collectFieldOccluders(scene, eventRoot, output = []) {
  output.length = 0;
  scene.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || o.userData?.glass || o.userData?.passLight || o.userData?.shadowOnly || o.userData?.impact) return;
    for (let n = o; n; n = n.parent) {
      if (!n.visible || n === eventRoot || n.userData?.networkAvatar || n.userData?.networkEntity || n.userData?.networkEffect || n.userData?.viewmodel) return;
    }
    output.push(o);
  });
  return output;
}
