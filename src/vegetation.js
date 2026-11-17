import * as THREE from 'three';

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
