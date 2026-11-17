// Asigna a cada losa el material de su acabado de piso (capa superior en el IFC).
// IfcConvert usa el estilo de la capa de hormigón, así que todas las losas salen "plantilla de hormigón".
// Aquí cada nodo (nombrado por GUID con --use-element-guids) recibe un material "FIN:<acabado>",
// que la web traduce a su textura. Uso: node tools/slab_finishes.mjs entrada.glb mapa.json salida.glb
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , src, mapPath, dst] = process.argv;
const { slab_finish: finish } = JSON.parse(readFileSync(mapPath, 'utf8'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const mats = new Map();
const matFor = (name) => {
  // color distinto por acabado: si fueran iguales, la optimización (dedup) los fusionaría en uno solo
  if (!mats.has(name)) mats.set(name, doc.createMaterial(`FIN:${name}`).setBaseColorFactor([0.8, 0.8, 0.5 + mats.size * 0.05, 1]));
  return mats.get(name);
};
let hit = 0, miss = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const name = finish[node.getName()];
  if (!name) { miss++; continue; }
  // malla propia: varios nodos pueden compartirla con acabados distintos
  const own = mesh.listParents().filter((p) => p.propertyType === 'Node').length > 1 ? mesh.clone() : mesh;
  node.setMesh(own);
  for (const prim of own.listPrimitives()) prim.setMaterial(matFor(name));
  hit++;
}
await io.write(dst, doc);
console.log('losas con acabado', hit, 'sin dato', miss, 'acabados', [...mats.keys()]);
