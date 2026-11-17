import * as THREE from 'three';

import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

// Texturas PBR de Poly Haven (CC0) en KTX2: se quedan comprimidas en la GPU (tools/make_ktx2.py).
// Dos tamaños: 'hi' (2K) en escritorio y 'lo' (1K) en móvil o pantallas pequeñas.
// táctil o con poca memoria -> 'lo'. (El tamaño de pantalla no sirve: con escalado de Windows un portátil reporta 1280x720.)
export const TEX_TIER = matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory ?? 8) <= 4 ? 'lo' : 'hi';
let ktx = null;

// Textura PBR a escala real: 'size' = metros que cubre la textura (según Poly Haven),
// 'uvMeters' = metros por unidad de UV en la malla (worldUV(o, tile) usa 'tile').
function phx(id, size, uvMeters = 1, tint = 0xffffff) {
  const m = new THREE.MeshStandardMaterial({ name: id, color: tint, metalness: 0 });
  m.userData.textured = true; // la textura KTX2 llega después: las mallas deben recibir UV en metros desde ya
  const r = uvMeters / size;
  const load = (map, slot) => ktx.load(`/tex/ktx2/${TEX_TIER}/${id}_${map}.ktx2`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(r, r);
    m[slot] = t; // el espacio de color (sRGB o lineal) viene declarado en el propio KTX2
    m.needsUpdate = true;
  });
  load('diff', 'map');
  load('nor_gl', 'normalMap');
  load('rough', 'roughnessMap');
  m.normalScale.set(1, -1); // KTX2 no se voltea en Y como los JPG: se compensa el canal verde del relieve
  return m;
}

// Ruido de valor simple, determinista
function noiseCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function woodTexture() {
  return noiseCanvas(512, (g, n) => {
    g.fillStyle = '#7a5a3c';
    g.fillRect(0, 0, n, n);
    for (let i = 0; i < 160; i++) {
      const y = rnd() * n, a = 0.08 + rnd() * 0.18;
      g.strokeStyle = rnd() > 0.5 ? `rgba(60,38,22,${a})` : `rgba(150,112,76,${a})`;
      g.lineWidth = 1 + rnd() * 2.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= n; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
      g.stroke();
    }
  });
}

// Pisos con el formato real de las piezas que nombra el IFC (cm). La textura cubre 'cols' x 'rows' piezas;
// su tamaño en metros va en userData.size para escalar la repetición con UV en metros.
const PX = 200; // píxeles por metro
function tileTexture({ w, h, cols, rows, color, vary, joint, grain = false, stagger = 0 }) {
  const W = (w / 100) * cols, H = (h / 100) * rows;
  const c = document.createElement('canvas');
  c.width = Math.round(W * PX); c.height = Math.round(H * PX);
  const g = c.getContext('2d');
  const [r0, g0, b0] = color;
  for (let j = 0; j < rows; j++) {
    const off = stagger ? ((j * stagger) % 1) * (w / 100) * PX : 0;
    for (let i = -1; i < cols; i++) {
      const x = i * (w / 100) * PX + off, y = j * (h / 100) * PX, pw = (w / 100) * PX, ph = (h / 100) * PX;
      const k = 1 + (rnd() - 0.5) * vary;
      g.fillStyle = `rgb(${r0 * k},${g0 * k},${b0 * k})`;
      g.fillRect(x, y, pw, ph);
      if (grain) { // vetas a lo largo de la pieza
        for (let v = 0; v < 18; v++) {
          g.strokeStyle = `rgba(${rnd() > 0.5 ? '60,45,35' : '255,240,220'},${0.04 + rnd() * 0.08})`;
          g.lineWidth = 0.5 + rnd() * 1.5;
          const yy = y + rnd() * ph;
          g.beginPath(); g.moveTo(x, yy);
          for (let xx = x; xx <= x + pw; xx += 20) g.lineTo(xx, yy + Math.sin(xx * 0.05 + v) * 1.5);
          g.stroke();
        }
      } else { // moteado suave
        for (let v = 0; v < 400; v++) {
          g.fillStyle = `rgba(${rnd() > 0.5 ? '0,0,0' : '255,255,255'},${0.02 + rnd() * 0.04})`;
          g.fillRect(x + rnd() * pw, y + rnd() * ph, 1 + rnd() * 3, 1 + rnd() * 3);
        }
      }
      g.strokeStyle = joint; g.lineWidth = 2; // junta
      g.strokeRect(x + 1, y + 1, pw - 2, ph - 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1 / W, 1 / H); // las UV de la losa van en metros
  return t;
}

// Material de la web para cada estilo/material del IFC, por palabras clave del nombre.
export function ifcMaterial(name, mats) {
  let n = (name || '').toLowerCase();
  if (n.startsWith('fin:')) { // acabado de piso: textura propia si la hay, si no, reglas por nombre
    if (mats.floors[name.slice(4)]) return mats.floors[name.slice(4)];
    n = n.slice(4);
  }
  if (/plaza de aparcamiento/.test(n)) return mats.paint; // líneas de parqueadero
  if (/piedra|stone/.test(n)) return mats.stone;
  if (/masonry|bloque/.test(n)) return mats.block;
  if (/roof|cubierta(?! por defecto)/.test(n)) return mats.roofing;
  if (/door - frame/.test(n)) return mats.chestnut;
  if (/door - panel|sash/.test(n)) return mats.oak;
  if (/gypsum|laminate|porcelain/.test(n)) return mats.tower.wall;
  if (/steel|xal|jet/.test(n)) return mats.blackMetal;
  if (/relleno|logo saxun/.test(n)) return mats.aluminium; // lamas y piezas de las pérgolas de parqueo
  if (/glass|vidrio|cristal/.test(n)) return mats.tower.glass;
  if (/aluminio[ _]color[ _]madera|cubierta por defecto/.test(n)) return mats.tower.slat; // celosías y pérgolas
  if (/negro|black/.test(n)) return mats.blackMetal;
  if (/aluminio|alumin|metal|inox|chrome/.test(n)) return mats.aluminium;
  if (/casta/.test(n)) return mats.chestnut;
  if (/oak|roble|madera|wood/.test(n)) return mats.oak;
  if (/hormig|concrete|plantilla/.test(n)) return mats.tower.slab;
  if (/muro|ladrillo/.test(n)) return mats.tower.wall;
  return null; // sin regla: se deja el color del IFC
}

export function makeMaterials(renderer) {
  ktx = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  const wood = woodTexture();
  const floor = (opts, rough) => new THREE.MeshStandardMaterial({ map: tileTexture(opts), roughness: rough });
  // Poly Haven (CC0), 2K: ver public/tex/LICENSES.md. El terreno usa UV de 6 m y los muros de 3 m (worldUV).
  const woodFloor = phx('laminate_floor_02', 1.7);
  return {
    earth: phx('aerial_grass_rock', 15, 6),
    paved: phx('concrete_pavement', 1, 1, 0xe9e4d8),
    // acabados de piso del IFC (capa superior de cada losa)
    floors: {
      'ARQ_SUE_SUELO_PORCELANATO_MADERA_VILEMA_23X120_TAUPE': woodFloor,
      'ARQ_SUE_SUELO_PORCELANATO_MADERA_VILEMA_ADZ_20X120_TAUPE': woodFloor,
      'ARQ_SUE_PISO_CER_CERAMICA_ESTILO_CEMENTO_MAHAL_OFF_58X118_GRIS': phx('concrete_tiles', 1.85),
      'ARQ_SUE_SUELO_PORCELANATO_MERLOT_INOUT_60X120_BEIGE': phx('floor_tiles_08', 1.5),
    },
    asphalt: phx('asphalt_02', 3), // ya estaba en el disco (visor-oliv-3d), 1K
    // pintura de demarcación: va sobre el asfalto, con desplazamiento de profundidad para no parpadear
    paint: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    stone: phx('stacked_stone_wall', 2),
    block: floor({ w: 40, h: 20, cols: 3, rows: 6, color: [196, 194, 188], vary: 0.05, joint: 'rgba(110,108,104,.6)', stagger: 0.5 }, 0.9),
    roofing: new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.8 }),
    blackMetal: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.4, metalness: 0.7 }),
    aluminium: new THREE.MeshStandardMaterial({ color: 0xb4b6b9, roughness: 0.35, metalness: 0.8 }),
    chestnut: new THREE.MeshStandardMaterial({ color: 0x8a5a36, map: wood, roughness: 0.6 }),
    oak: new THREE.MeshStandardMaterial({ color: 0xb07a4e, map: wood, roughness: 0.6 }),
    tower: {
      wall: phx('white_stucco_02', 1.8, 3),
      slab: phx('concrete_pavement', 2, 1, 0xd9d2c3), // UV en metros: una repetición cada 2 m
      glass: new THREE.MeshStandardMaterial({ color: 0x2c4a52, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.82 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.45, metalness: 0.6 }),
      rail: new THREE.MeshStandardMaterial({ color: 0xc9e0e2, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.28, depthWrite: false }),
      slat: new THREE.MeshStandardMaterial({ color: 0x9a7650, map: wood, roughness: 0.7 }),
    },
  };
}
