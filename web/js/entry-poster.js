import * as T from 'three';

const IMAGE = new URL('../textures/adventures/entry-meme.webp', import.meta.url);
let materials;

function posterMaterials() {
  if (materials) return materials;
  const map = new T.TextureLoader().load(IMAGE.href);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  materials = {
    paper: new T.MeshStandardMaterial({
      map, roughness: 0.92, emissiveMap: map, emissive: '#fff3df', emissiveIntensity: 0.22,
    }),
    tape: new T.MeshStandardMaterial({ color: '#c1aa79', transparent: true, opacity: 0.74, depthWrite: false, roughness: 0.75 }),
  };
  return materials;
}

export function entryPoster(leafWidth, leafHeight, leafThickness) {
  const width = leafWidth * 0.55, height = width * 814 / 576;
  const anchor = new T.Group(), print = new T.Group();
  anchor.name = 'Входная дверь · Открывай на удачу';
  anchor.position.set(leafWidth * 0.60, leafHeight * 0.73, -leafThickness / 2);
  anchor.rotation.y = Math.PI;
  anchor.add(print);
  print.rotation.z = -0.108;
  const { paper, tape } = posterMaterials();
  const face = new T.Mesh(new T.PlaneGeometry(width, height), paper);
  face.position.z = 0.0018;
  face.receiveShadow = true;
  print.add(face);
  // A pair of uneven torn strips crossing the paper edge.
  const strip = new T.Shape();
  strip.moveTo(-0.5, -0.40); strip.lineTo(-0.48, 0.41);
  strip.lineTo(-0.38, 0.48); strip.lineTo(0.47, 0.48);
  strip.lineTo(0.43, 0.24); strip.lineTo(0.5, 0.06);
  strip.lineTo(0.46, -0.47); strip.lineTo(-0.41, -0.50);
  const tapeGeometry = new T.ShapeGeometry(strip);
  for (const [x, y, angle] of [[-0.34, 0.49, 0.42], [0.37, 0.49, -0.68]]) {
    const patch = new T.Mesh(tapeGeometry, tape);
    patch.position.set(x * width, y * height, 0.0028);
    patch.rotation.z = angle;
    patch.scale.set(0.07, 0.027, 1);
    print.add(patch);
  }
  anchor.traverse(object => {
    if (!object.isMesh) return;
    object.userData.noPick = true;
    object.raycast = () => {};
  });
  return anchor;
}
