// Simplifica solo las mallas muy densas de un GLB (p. ej. las pérgolas de parqueo del fabricante,
// ~42 000 triángulos cada una) sin tocar terreno, vías ni losas.
// Uso: node tools/simplify_heavy.mjs entrada.glb salida.glb [min_triangulos=20000] [ratio=0.06]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , src, dst, minArg, ratioArg] = process.argv;
const MIN = Number(minArg ?? 20000), RATIO = Number(ratioArg ?? 0.06);

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const triCount = (prim) => (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
// IfcConvert duplica vértices por cara (normales planas): sin quitar NORMAL, 'weld' no une nada y
// cada triángulo queda suelto. En las mallas densas se quita; la web recalcula normales al cargar.
const heavy = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => triCount(p) >= MIN);
for (const prim of heavy) prim.setAttribute('NORMAL', null);
await doc.transform(weld());
let n = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    if (!heavy.includes(prim)) continue;
    const tris = triCount(prim);
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.03 }); // 3 % del tamaño de la pieza
    const after = prim.getIndices().getCount() / 3;
    console.log(mesh.getName() || '(sin nombre)', Math.round(tris), '->', Math.round(after));
    n++;
  }
}
await io.write(dst, doc);
console.log('mallas simplificadas', n);
