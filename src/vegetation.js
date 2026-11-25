import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Vegetación instanciada (Poly Haven, CC0): una InstancedMesh por submalla del modelo.
// Se dispersa sobre el terreno natural, fuera de la huella de la torre y de los pavimentos.

let seed = 21;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function scatter(gltf, { count, area, avoid, earth, paved, scale = [0.8, 1.2] }) {
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const mats = [];
  const dummy = new THREE.Object3D();
  let tries = 0;
  while (mats.length < count && tries++ < count * 40) {
    const x = area.min.x + rnd() * (area.max.x - area.min.x);
    const z = area.min.z + rnd() * (area.max.z - area.min.z);
    if (avoid.some((b) => b.containsPoint(new THREE.Vector3(x, b.min.y, z)))) continue;
    ray.set(new THREE.Vector3(x, 200, z), down);
    const hit = ray.intersectObjects([...earth, ...paved], false)[0];
    if (!hit || !earth.includes(hit.object)) continue; // solo sobre terreno natural
    if (hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.75) continue; // no en taludes fuertes
    dummy.position.copy(hit.point);
    dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
    const s = scale[0] + rnd() * (scale[1] - scale[0]);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    mats.push(dummy.matrix.clone());
  }

  const group = new THREE.Group();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const inst = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
    const local = o.matrixWorld;
    mats.forEach((m, i) => inst.setMatrixAt(i, m.clone().multiply(local)));
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}

// Árboles impostores: cada árbol son 3 planos cruzados (0°, 60°, 120°) con 3 vistas de un modelo fotorrealista
// renderizadas de antemano (public/models/trees/*_impostor.webp, 3 vistas de lado en una tira; island_tree_01..03 de
// Poly Haven, CC0). Cientos de árboles cuestan lo que unos pocos miles de triángulos.
//   trees: [{ x, y, z, h }] base y altura de cada árbol; kinds: [{ url, height, W }] altura del modelo y medio ancho de
//   cada vista (la vista es un cuadrado de 2W de lado con la base abajo)
export function impostorTrees(trees, kinds) {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  kinds.forEach((kind, t) => {
    const mine = trees.filter((_, i) => i % kinds.length === t);
    if (!mine.length) return;
    const parts = [0, 1, 2].map((k) => {
      const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.48, 0); // base un poco hundida: oculta el disco de suelo del modelo
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / 3);
      return g.rotateY((k * Math.PI) / 3);
    });
    const geo = mergeGeometries(parts);
    const tex = new THREE.TextureLoader().load(kind.url);
    tex.colorSpace = THREE.SRGBColorSpace;
    // toneMapped: false, la imagen ya salió con el mapeo de tono al renderizarla; aplicarlo otra vez la oscurece
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, toneMapped: false });
    const inst = new THREE.InstancedMesh(geo, mat, mine.length);
    const tint = new THREE.Color();
    mine.forEach((tr, i) => {
      dummy.position.set(tr.x, tr.y, tr.z);
      dummy.rotation.set(0, (i * 2.4) % (Math.PI * 2), 0);
      dummy.scale.setScalar((tr.h * 2 * kind.W) / kind.height);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, tint.setScalar(0.92 + ((i * 37) % 12) / 100)); // variación leve de tono entre árboles
    });
    inst.computeBoundingSphere();
    group.add(inst);
  });
  return group;
}
