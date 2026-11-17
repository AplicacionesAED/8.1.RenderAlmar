// RECONSTRUCCIÓN (no es del IFC): completa los pisos 2 y 3 del tramo central de la Torre 1 (Lote 16).
// El IFC de arquitectura (versión del 03/11/2026) solo modela el primer nivel del tramo central y la
// cubierta a +10.80 (cota 56.77 = 45.97 + 3 x 3.60). Los bloques de los extremos sí tienen 3 pisos.
// Aquí se copian los elementos del primer nivel del centro a +3.60 y +7.20 (piso tipo).
// Entrada: GLB ya recentrado (tools/recenter.mjs). Uso: node tools/replicate_floors.mjs entrada.glb salida.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const [, , src, dst] = process.argv;
const AXIS = (78 * Math.PI) / 180;          // eje largo de la torre en planta (x, z de escena)
const CENTER_U = [-36, 0.5];                // tramo central sobre ese eje (m); extremos: < -45.9 y > 0.7
const FLOOR1 = [45.85, 49.6];               // franja del primer nivel: el elemento debe caber completo en ella
const OFFSETS = [3.6, 7.2];                 // segundo nivel y altillo

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const cu = Math.cos(AXIS), su = Math.sin(AXIS);
let copied = 0;
for (const node of doc.getRoot().listNodes()) {
  if (!node.getMesh()) continue;
  const b = getBounds(node);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const u = cx * cu + cz * su;
  if (u < CENTER_U[0] || u > CENTER_U[1]) continue;
  if (b.min[1] < FLOOR1[0] || b.max[1] > FLOOR1[1]) continue;
  const parent = node.getParentNode();
  for (const dy of OFFSETS) {
    const t = node.getTranslation();
    const c = doc.createNode(`${node.getName()}_rep${dy}`)
      .setMesh(node.getMesh()) // comparte la malla: no aumenta el peso del archivo
      .setRotation(node.getRotation()).setScale(node.getScale())
      .setTranslation([t[0], t[1] + dy, t[2]]); // el padre solo traslada (origen del proyecto)
    if (parent) parent.addChild(c); else doc.getRoot().listScenes()[0].addChild(c);
    copied++;
  }
}
await io.write(dst, doc);
console.log('elementos copiados', copied / OFFSETS.length, 'x', OFFSETS.length);
