// Completa las losas de entrepiso: el IFC de arquitectura de L21 solo trae el piso de acabado
// (6-7 cm). Los muros de cada nivel llegan 0.50 m por debajo del piso siguiente (p. ej. 59.90 vs 60.40),
// donde iría la losa estructural, que no está en el modelo. Aquí cada losa de entrepiso baja su
// cara inferior 0.50 m. Las losas sobre el terreno (cota < MIN_Y) no se tocan.
// Entrada: GLB ya recentrado (tools/recenter.mjs). Uso: node tools/thicken_slabs.mjs entrada.glb salida.glb [cota_min=55]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// matriz 4x4 en columnas (glTF): punto a mundo, y desplazamiento de mundo a local
const toWorld = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
// para rotación + escala uniforme: R^-1 = R^T / s^2
function worldDeltaToLocal(m, d) {
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
  return [
    (m[0] * d[0] + m[1] * d[1] + m[2] * d[2]) / s2,
    (m[4] * d[0] + m[5] * d[1] + m[6] * d[2]) / s2,
    (m[8] * d[0] + m[9] * d[1] + m[10] * d[2]) / s2,
  ];
}

const [, , src, dst, minYArg] = process.argv;
const DROP = 0.5;   // espesor faltante: cabeza de muro -> piso siguiente
const MIN_Y = Number(minYArg ?? 55); // por debajo, losas sobre terreno (L21: primer piso a 53.2; L16: 45.9 -> pasar 47)
const EPS = 0.02;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.listScenes()[0];
let moved = 0, slabs = 0;

for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const world = node.getWorldMatrix();
  const delta = worldDeltaToLocal(world, [0, -DROP, 0]);
  for (const prim of mesh.listPrimitives()) {
    // copia propia del accessor: los nodos pueden compartir geometría
    const pos = prim.getAttribute('POSITION').clone();
    prim.setAttribute('POSITION', pos);
    const n = pos.getCount();
    const wy = [];
    let minY = Infinity;
    for (let i = 0; i < n; i++) {
      const y = toWorld(world, pos.getElement(i, []))[1];
      wy.push(y); if (y < minY) minY = y;
    }
    if (minY < MIN_Y) continue;
    slabs++;
    for (let i = 0; i < n; i++) {
      if (wy[i] > minY + EPS) continue;
      const p = pos.getElement(i, []);
      pos.setElement(i, [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]]);
      moved++;
    }
  }
}
await io.write(dst, doc);
console.log('losas engrosadas', slabs, 'vértices movidos', moved);
