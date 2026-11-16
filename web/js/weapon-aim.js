// One screen-space aim for the reticle, gameplay rays and the separate hand camera.
// GLB contract: muzzle's local +X is the bore; sight_front/rear locate the eye pose.
export const AIM_NDC = Object.freeze({ x: 0, y: 0 });

export function createWeaponAim(THREE) {
  const forward = new THREE.Vector3(0, 0, -1);
  const axis = new THREE.Vector3(), muzzle = new THREE.Vector3();
  const target = new THREE.Vector3(), offset = new THREE.Vector3(), reach = new THREE.Vector3();
  const correction = new THREE.Quaternion();
  const ray = new THREE.Raycaster();

  function eyePose(eye, rear, front, bore) {
    // The front sight marks the shot. Centre it with the bore facing forward;
    // do not infer barrel rotation from the decorative tops of the two sights.
    const q = new THREE.Quaternion().setFromUnitVectors(bore, forward);
    const r = rear.clone().applyQuaternion(q), f = front.clone().applyQuaternion(q);
    return new THREE.Vector3(-f.x, -f.y, -eye - r.z);
  }

  function align(rig, muzzleNode, handCamera, distance) {
    rig.updateMatrixWorld(true);
    muzzleNode.getWorldPosition(muzzle);
    axis.set(1, 0, 0).transformDirection(muzzleNode.matrixWorld);
    // Unproject through the final hand-camera projection, including panel offset.
    // A point on the shared centre ray projects onto the same reticle at any FOV.
    ray.setFromCamera(AIM_NDC, handCamera);
    ray.ray.at(distance, target);
    target.sub(rig.position);
    offset.copy(muzzle).sub(rig.position);
    // Exact rotation of an offset bore about the hand pivot: |offset + s*axis|
    // must equal the pivot-to-target distance. A lookAt(pivot,target) misses this.
    const along = offset.dot(axis);
    const s = -along + Math.sqrt(Math.max(0, along * along + target.lengthSq() - offset.lengthSq()));
    reach.copy(offset).addScaledVector(axis, s).normalize();
    correction.setFromUnitVectors(reach, target.normalize());
    rig.quaternion.premultiply(correction);
  }

  return { eyePose, align };
}
