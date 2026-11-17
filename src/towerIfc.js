import * as THREE from 'three';
import ifcMats from '../data/l21_materials.json';
import { ifcMaterial } from './materials.js';

// Torre con la geometría real del IFC (solo arquitectura, sin mobiliario ni sanitarios),
// un GLB por tipo de elemento. Cada malla conserva su material del IFC (estilo, o acabado de piso
// "FIN:<nombre>" en las losas) y se traduce a un material de la web por su nombre.

const PARTS = ['walls', 'slabs', 'doors', 'windows', 'rails', 'members', 'stairs'];
// si un estilo no tiene regla, material por defecto según el tipo de elemento
const FALLBACK = { walls: 'wall', slabs: 'slab', stairs: 'slab', members: 'slat', rails: 'rail', windows: 'frame', doors: 'frame' };

// Reordena los triángulos: primero los que miran hacia arriba (material 0), luego el resto (material 1).
function topOnly(o, top, rest) {
  const g = o.geometry;
  const idx = g.index.array, nor = g.attributes.normal;
  const n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
  const up = [], other = [];
  for (let i = 0; i < idx.length; i += 3) {
    n.fromBufferAttribute(nor, idx[i]).applyMatrix3(nm).normalize();
    (n.y > 0.7 ? up : other).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex([...up, ...other]);
  g.clearGroups();
  g.addGroup(0, up.length, 0);
  g.addGroup(up.length, other.length, 1);
  o.material = [top, rest];
}

// Otro IFC del conjunto (p. ej. la portería) en un solo GLB: mismo criterio de materiales que la torre.
// Si un estilo no tiene regla, se conserva el color que trae del IFC.
export async function loadIfcModel(load, url, styles, mats, worldUV) {
  const g = await load(url);
  g.scene.updateMatrixWorld(true);
  const tileOf = (m) => (m === mats.tower.wall ? 3 : m === mats.chestnut || m === mats.oak ? 1.2 : 1); // UV en metros
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const style = styles[o.material.name] ?? o.material.name;
    const m = ifcMaterial(style, mats);
    if (!m) return;
    if (m.map || m.userData.textured) worldUV(o, tileOf(m));
    o.material = m;
    if (style.startsWith('FIN:') && m !== mats.tower.slab) topOnly(o, m, mats.tower.wall);
  });
  return g.scene;
}

// base: carpeta de los GLB por tipo; styles: mapa IfcSurfaceStyleRendering-<id> -> nombre (de tools/ifc_materials.py);
// parts: tipos presentes en ese IFC.
export async function loadTowerIfc(load, mats, shift, worldUV, { base = '/models/l21', styles = ifcMats.styles, parts = PARTS } = {}) {
  const root = new THREE.Group();
  const loaded = await Promise.all(parts.map((p) => load(`${base}/${p}.glb`)));
  const unknown = new Set();
  loaded.forEach((g, i) => {
    const part = parts[i];
    g.scene.position.copy(shift);
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const raw = o.material.name;
      const style = styles[raw] ?? raw; // IfcSurfaceStyleRendering-<id> -> nombre del estilo
      let m = ifcMaterial(style, mats);
      if (part === 'rails' && m === mats.tower.glass) m = mats.tower.rail; // vidrio de baranda: más claro
      if (!m) { unknown.add(style); m = mats.tower[FALLBACK[part]]; }
      if (m.map || m.userData.textured) worldUV(o, part === 'walls' ? 3 : part === 'slabs' || part === 'stairs' ? 1 : 1.2); // pisos: UV en metros
      o.material = m;
      // el acabado de piso va solo en la cara superior; cantos y cielo raso de la losa, revocados
      if (style.startsWith('FIN:') && m !== mats.tower.slab) topOnly(o, m, mats.tower.wall);
      o.name = part;
    });
    root.add(g.scene);
  });
  if (unknown.size) console.info('Estilos del IFC sin regla de material:', [...unknown]);
  return root;
}
