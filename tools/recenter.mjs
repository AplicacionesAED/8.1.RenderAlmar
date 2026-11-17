// Recentra un GLB georreferenciado antes de fusionarlo/optimizarlo.
// IfcConvert deja ~825 000 m en la matriz de cada nodo; si 'join' hornea eso en vértices float32
// se pierden ~6 cm (temblor, huecos entre pisos). Aquí se agrega un nodo padre con el origen
// restado (en doble precisión), así lo horneado queda cerca de cero.
// Uso: node tools/recenter.mjs entrada.glb salida.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , src, dst] = process.argv;
const O = [-825200, 0, 1615100]; // origen del proyecto en ejes del GLB (x, cota, -y)

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
for (const scene of doc.getRoot().listScenes()) {
  const parent = doc.createNode('origen_proyecto').setTranslation(O);
  for (const child of scene.listChildren()) parent.addChild(child);
  scene.addChild(parent);
}
await io.write(dst, doc);
console.log('recentrado', src, '->', dst);
