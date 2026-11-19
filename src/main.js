import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { loadTowerIfc, loadIfcModel } from './towerIfc.js';
import portMats from '../data/port_materials.json';
import l16Mats from '../data/l16_materials.json';
import topMats from '../data/top_materials.json';
import topRoles from '../data/top_roles.json';
import { ifcMaterial, TEX_TIER } from './materials.js';
import { makeMaterials } from './materials.js';
import { scatter } from './vegetation.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { sunAt, smooth } from './sun.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createUnits } from './units.js';

// Coordenadas IFC compartidas (x, y, cota) -> escena (x, cota, -y), recentradas
const O = { x: 825200, y: 1615100 };
const S = (x, y, z = 0) => new THREE.Vector3(x - O.x, z, -(y - O.y));

const canvas = document.getElementById('c');
// Profundidad logarítmica: la geometría del IFC tiene caras casi coincidentes (muros sobre losas,
// capas de acabado) que con profundidad lineal parpadean (z-fighting) al mover la cámara.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
// Sombra estática temporal: se calcula una sola vez (autoUpdate = false), casi sin costo por fotograma.
// Se reemplaza por luz horneada en Blender cuando la geometría esté cerrada.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NeutralToneMapping; // conserva los colores de los materiales mejor que ACES
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true;

const PAPER = new THREE.Color(0xf1ece2);
const scene = new THREE.Scene();
scene.background = PAPER.clone();
scene.fog = new THREE.Fog(PAPER.clone(), 400, 1200);

// Luz: sol bajo dorado desde el oeste + cielo suave
const hemi = new THREE.HemisphereLight(0xc9d6e6, 0xb39a72, 0.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc98a, 3.4);
sun.position.set(-170, 48, 90); // ~13° sobre el horizonte: hora dorada, sombras largas
sun.target.position.set(10, 55, -28); // centro aproximado de la torre L21
sun.position.add(sun.target.position);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 70, bottom: -70, near: 20, far: 500 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 5000);

// Plano de corte de los materiales (fijo por encima de las torres)
const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 40);
const CLIP_HIGH = 90;

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));

const mat = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
const MM = makeMaterials(renderer);
const M = { earth: MM.earth, paved: MM.paved, concrete: mat(0xe4ddcf) };

// UV en coordenadas de mundo (metros / tile): la textura mantiene su escala real sobre el terreno
function worldUV(o, tile) {
  const pos = o.geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const nor = o.geometry.attributes.normal;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    n.fromBufferAttribute(nor, i).transformDirection(o.matrixWorld);
    // caras inclinadas o verticales: se proyecta de lado para que no se estire la textura
    if (Math.abs(n.y) < 0.6) {
      uv[i * 2] = (v.x * Math.abs(n.z) + v.z * Math.abs(n.x)) / tile;
      uv[i * 2 + 1] = v.y / tile;
    } else {
      uv[i * 2] = v.x / tile;
      uv[i * 2 + 1] = v.z / tile;
    }
  }
  o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
const walls = []; // materiales que usan el plano de corte
const useClip = (m) => { m.clippingPlanes = [clip]; walls.push(m); return m; };

// Solo la torre L21 y su plataforma (fase de optimización); portería y L16 quedan fuera por ahora
// Los GLB se convierten con --model-offset -O (vértices cerca de cero): con coordenadas
// georreferenciadas en los vértices, float32 solo da ~6 cm de precisión (temblor, huecos entre pisos).
const SHIFT = new THREE.Vector3(0, 0, 0);
const topG = await load('/models/top_opt.glb');
// Torre con geometría real del IFC (sin mobiliario), un GLB por tipo de elemento
const l21G = { scene: await loadTowerIfc(load, MM, SHIFT, worldUV) };
// Portería: IFC propio, sin mobiliario ni proxies, con sus materiales
const portG = { scene: await loadIfcModel(load, '/models/port_ifc.glb', portMats.styles, MM, worldUV) };
// Torre 1 (Lote 16): mismo proceso, con el IFC completo (descarga del 17/11/2026: pisos 2 y 3 del tramo
// central, puertas y ventanas con ubicación, barandas y escaleras).
const l16G = { scene: await loadTowerIfc(load, MM, SHIFT, worldUV, { base: '/models/l16', styles: l16Mats.styles }) };
topG.scene.position.copy(SHIFT);

const ground = [];

// --- Implantación (TOP): papel de cada elemento por GUID (tools/top_roles.py), el resto por su material del IFC
const topMeshes = [], earthMeshes = [], pavedMeshes = [];
topG.scene.updateMatrixWorld(true);
topG.scene.traverse((o) => { if (o.isMesh) topMeshes.push({ o }); });
let lawns = 0;
for (const { o } of topMeshes) {
  o.castShadow = o.receiveShadow = true;
  if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); // mallas simplificadas (tools/simplify_heavy.mjs)
  const role = topRoles[o.name] ?? topRoles[o.parent?.name];
  switch (role) {
    case 'earth': worldUV(o, 6); o.material = M.earth; ground.push(o); earthMeshes.push(o); break;
    case 'lawn': // plataforma del Lote 16 (3 losas superpuestas, sin torre aún): una sola, como prado
      if (lawns++ > 0) { o.visible = false; break; }
      worldUV(o, 6); o.material = M.earth; ground.push(o); earthMeshes.push(o); break;
    case 'road':
    case 'parking': worldUV(o, 1); o.material = MM.asphalt; ground.push(o); pavedMeshes.push(o); break;
    case 'paving': worldUV(o, 3); o.material = M.paved; ground.push(o); pavedMeshes.push(o); break;
    default: { // muros del tanque, pérgolas de parqueo, líneas de parqueadero, carro, accesos: material del IFC
      const style = topMats.styles[o.material.name] ?? o.material.name;
      const m = ifcMaterial(style, MM);
      if (m) { if (m.map || m.userData.textured) worldUV(o, m === MM.tower.wall ? 3 : 1); o.material = m; }
      if (o.material !== MM.paint) useClip(o.material); // suben con el dibujo (sin clonar: las texturas KTX2 llegan después)
    }
  }
}
scene.add(topG.scene);

// --- Edificios con plano de corte (conservan su paleta de color del IFC)
function prepare(g) {
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach((m) => { m.clippingPlanes = [clip]; walls.push(m); });
    ground.push(o);
  });
  scene.add(g.scene);
}
prepare(l21G);
prepare(portG);
prepare(l16G);


// --- Vegetación alrededor de la torre (fuera de su huella y de los pavimentos)
scene.updateMatrixWorld(true);
const towerBox = new THREE.Box3().setFromObject(l21G.scene).expandByScalar(3);
const portBox = new THREE.Box3().setFromObject(portG.scene).expandByScalar(2);
const l16Box = new THREE.Box3().setFromObject(l16G.scene).expandByScalar(3);
const vegArea = towerBox.clone().expandByVector(new THREE.Vector3(70, 0, 70));
const [shrubG, treeG] = await Promise.all([load('/models/shrub_04.glb'), load('/models/pachira_aquatica_01.glb')]);
for (const [g, opts] of [
  [shrubG, { count: 100, scale: [0.9, 1.6] }],
  [treeG, { count: 55, scale: [1.6, 2.6] }],
]) {
  const veg = scatter(g, { ...opts, area: vegArea, avoid: [towerBox, portBox, l16Box], earth: earthMeshes, paved: pavedMeshes });
  veg.traverse((o) => { if (o.isMesh) useClip(o.material); });
  scene.add(veg);
}

// Sin suelo generado: solo el terreno de los IFC (el disco de papel y el terreno circundante se quitaron).

// --- Cielo de atardecer (shader Sky de three.js, sin descargas). Aparece cuando la torre ya subió.
const sky = new Sky();
sky.scale.setScalar(4500); // más allá del suelo lejano: la niebla funde el borde del suelo con el horizonte
const skyU = sky.material.uniforms;
skyU.turbidity.value = 8;
skyU.rayleigh.value = 2.2;
skyU.mieCoefficient.value = 0.006;
skyU.mieDirectionalG.value = 0.85;
sky.visible = false;
scene.add(sky);

// Reflejos: el mismo cielo, prefiltrado, como entorno para vidrio y metales (se rehace al cambiar la hora)
const envScene = new THREE.Scene();
const skyEnv = new Sky();
skyEnv.scale.setScalar(1000);
envScene.add(skyEnv);
const pmrem = new THREE.PMREMGenerator(renderer);
let envMap = null;

const HORIZON = new THREE.Color(); // tono del cielo cerca del horizonte, para la niebla
let isReal = false; // papel (intro) o mundo real

// --- Hora del día: sol, cielo, luces, reflejos, niebla y ventanas encendidas se adaptan
const C = (h) => new THREE.Color(h);
const SUN_DAY = C(0xfff1de), SUN_GOLD = C(0xff9c55);
const HOR_DAY = C(0xd7dde2), HOR_GOLD = C(0xe5b07a), HOR_NIGHT = C(0x1b2230);
const today = new Date();
function setHour(hour) {
  const { dir, elevation: el } = sunAt(today, hour);
  const day = smooth(-6, 8, el);      // 0 noche .. 1 día
  const gold = 1 - smooth(4, 30, el); // 1 con sol bajo
  sun.position.copy(sun.target.position).addScaledVector(dir, 250);
  sun.color.copy(SUN_DAY).lerp(SUN_GOLD, gold);
  sun.intensity = 3.4 * smooth(-1, 6, el);
  sun.castShadow = el > 0;
  hemi.intensity = 0.08 + 0.62 * day;
  skyU.sunPosition.value.copy(dir);
  Object.entries(skyU).forEach(([k, u]) => { skyEnv.material.uniforms[k].value = u.value; });
  envMap?.dispose();
  envMap = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.08 + 0.47 * day;
  HORIZON.copy(HOR_DAY).lerp(HOR_GOLD, gold * day).lerp(HOR_NIGHT, 1 - day);
  // de noche las ventanas se encienden
  const glass = MM.tower.glass;
  glass.emissive.set(0xffb466);
  glass.emissiveIntensity = 1.4 * (1 - day);
  renderer.toneMappingExposure = 1.0 + 0.25 * (1 - day);
  if (isReal) applyWorld(true);
  renderer.shadowMap.needsUpdate = true;
}
function applyWorld(real) {
  isReal = real;
  sky.visible = real;
  scene.background = real ? null : PAPER;
  scene.environment = real ? envMap : null;
  scene.fog.near = real ? 160 : 400;
  scene.fog.far = real ? 650 : 1200;
  scene.fog.color.copy(real ? HORIZON : PAPER);
}


function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Vista libre: arrastrar para girar, rueda/pellizco para acercar, clic derecho o dos dedos para desplazar
// Punto de giro: el centro de las dos torres. WASD, el desplazamiento y el zoom al cursor mueven el punto de
// mira; al empezar a arrastrar con el botón izquierdo, vuelve suave a las torres para girar siempre sobre ellas.
// Foco del giro: las dos torres, o solo una (Torre 1 = Lote 16, Torre 2 = Lote 21).
const FOCUS = {
  all: towerBox.clone().union(l16Box).getCenter(new THREE.Vector3()),
  t1: l16Box.getCenter(new THREE.Vector3()),
  t2: towerBox.getCenter(new THREE.Vector3()),
};
let towersPivot = FOCUS.all;
let unitPivot = null; // centro del apartamento elegido: mientras exista, la cámara gira alrededor de él
let glideToTowers = false;
const orbit = new OrbitControls(camera, canvas);
orbit.enabled = false;
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
// Encuadre fijo de las dos torres: sin zoom, a distancia y altura fijas; solo se gira alrededor de ellas.
// Por defecto ~10° sobre el horizonte, de frente a los balcones de la Torre 1 (la Torre 2 asoma detrás).
// El panel "Cámara" ajusta distancia, altura, ángulo y lente; se guarda en este navegador.
const D2R = THREE.MathUtils.degToRad;
const CAM_DEFAULT = { dist: 100, elev: 10, az: -70, mm: 23 }; // 23 mm ≈ los 55° verticales de la cámara del recorrido
const mmToFov = (mm) => THREE.MathUtils.radToDeg(2 * Math.atan(24 / (2 * mm))); // sensor de 36 x 24 mm
let CAM = { ...CAM_DEFAULT };
try { Object.assign(CAM, JSON.parse(localStorage.getItem('almar.cam') || '{}')); } catch { /* sin almacenamiento */ }
orbit.enableZoom = false;
orbit.screenSpacePanning = false;     // desplazar sobre el plano del suelo
// aplica el encuadre: fija distancia y altura del giro; con az, además coloca la cámara en ese ángulo
function applyCam(az = null) {
  const polar = D2R(90 - CAM.elev);
  orbit.minDistance = orbit.maxDistance = CAM.dist;
  orbit.minPolarAngle = orbit.maxPolarAngle = polar;
  if (!(mode === 'orbit' || mode === 'units')) return;
  camera.fov = mmToFov(CAM.mm);
  camera.updateProjectionMatrix();
  const theta = az === null ? orbit.getAzimuthalAngle() : D2R(az);
  camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSphericalCoords(CAM.dist, polar, theta));
  orbit.update();
}
const ui = { orbit: document.getElementById('m-orbit'), units: document.getElementById('m-units') };
// Elegir un apartamento lo convierte en el pivote del giro (tomas de dron); soltarlo vuelve al pivote de la torre.
// Su torre pasa a ser la elegida, para que la otra se oculte si estorba.
function setUnitPivot(center, tower) {
  unitPivot = center;
  if (center) {
    focusKey = `t${tower}`;
    focusBtns.forEach((x) => x.classList.toggle('on', x.dataset.f === focusKey));
  }
  pivotMark.visible = !camPanel.hidden || !!unitPivot;
  glideToTowers = true;
}
const units = createUnits({ scene, camera, canvas, orbit, onPivot: setUnitPivot });
let mode = null;
function setMode(m) {
  const first = mode === null;
  mode = m;
  for (const [k, b] of Object.entries(ui)) b.classList.toggle('on', k === m);
  document.body.classList.add('orbit');
  document.body.classList.toggle('units', m === 'units');
  orbit.enabled = true;
  units.setActive(m === 'units');
  if (!first) return; // cambiar entre vista libre y apartamentos no mueve la cámara
  applyWorld(true);
  clip.constant = CLIP_HIGH;
  renderer.shadowMap.needsUpdate = true;
  camera.up.set(0, 1, 0);
  orbit.target.copy(towersPivot);
  applyCam(CAM.az);
}
// Teclado en vista libre: W/S adelante y atrás, A/D izquierda y derecha (en el plano del suelo).
// Se mueven juntos la cámara y el punto que mira, así la vista no cambia de ángulo.
const keys = new Set();
addEventListener('keydown', (e) => { if ((mode === 'orbit' || mode === 'units') && /^Key[WASD]$/.test(e.code)) keys.add(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), step = new THREE.Vector3();
function orbitKeys(dt) {
  if (!keys.size) return;
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) return;
  fwd.normalize();
  right.set(-fwd.z, 0, fwd.x);
  step.set(0, 0, 0);
  if (keys.has('KeyW')) step.add(fwd);
  if (keys.has('KeyS')) step.sub(fwd);
  if (keys.has('KeyD')) step.add(right);
  if (keys.has('KeyA')) step.sub(right);
  if (!step.lengthSq()) return;
  // velocidad proporcional a la distancia: lento de cerca para ver detalles, rápido de lejos
  const speed = Math.max(3, camera.position.distanceTo(orbit.target) * 0.6);
  step.normalize().multiplyScalar(speed * dt);
  camera.position.add(step);
  orbit.target.add(step);
}
// solo al arrastrar de verdad (> 5 px): un clic simple sirve para elegir apartamentos
let dragFrom = null;
canvas.addEventListener('pointerdown', (e) => {
  dragFrom = orbit.enabled && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey ? [e.clientX, e.clientY] : null;
});
canvas.addEventListener('pointermove', (e) => {
  if (dragFrom && Math.hypot(e.clientX - dragFrom[0], e.clientY - dragFrom[1]) > 5) { glideToTowers = true; dragFrom = null; }
});
addEventListener('pointerup', () => { dragFrom = null; });
// --- Panel de cámara
const camBtn = document.getElementById('camBtn'), camPanel = document.getElementById('campanel');
// cada valor tiene deslizador y campo de texto numérico; los dos se mantienen iguales
const camFields = ['dist', 'elev', 'az', 'mm'];
const slider = (k) => document.getElementById(`cam-${k}`), field = (k) => document.getElementById(`cam-${k}-n`);
// Altura de la cámara en metros sobre el pivote (orbit.target): dist · sen(elevación). No se guarda: se deriva de la
// distancia y la elevación, y al editarla se traduce a elevación (con la distancia actual).
const heightOf = () => Math.round(CAM.dist * Math.sin(D2R(CAM.elev)) * 10) / 10;
let heightTyping = false; // mientras se escribe la altura no se reescribe su campo de texto
function showHeight() {
  slider('h').value = heightOf();
  if (!heightTyping) field('h').value = heightOf();
}
function setHeight(raw) {
  const h = Number(raw);
  if (raw === '' || !Number.isFinite(h)) { showHeight(); return; }
  setCam('elev', THREE.MathUtils.radToDeg(Math.asin(Math.min(1, Math.max(0, h / CAM.dist)))));
}
function showCam() {
  for (const k of camFields) slider(k).value = field(k).value = CAM[k];
  showHeight();
}
function setCam(k, raw, from) {
  const q = k === 'elev' ? 10 : 1; // la elevación admite décimas para que la altura en metros sea precisa
  const s = slider(k), v = Math.min(Number(s.max), Math.max(Number(s.min), Math.round(Number(raw) * q) / q));
  if (raw === '' || !Number.isFinite(v)) { field(k).value = CAM[k]; return; } // vacío o no numérico: vuelve al valor actual
  CAM[k] = v;
  if (from !== 'slider') s.value = v;
  if (from !== 'field') field(k).value = v; // mientras se escribe no se toca el texto
  if (k === 'dist' || k === 'elev') showHeight();
  applyCam(k === 'az' ? CAM.az : null);
  try { localStorage.setItem('almar.cam', JSON.stringify(CAM)); } catch { /* sin almacenamiento */ }
}
slider('h').addEventListener('input', (e) => setHeight(e.target.value));
field('h').addEventListener('input', (e) => {
  const n = Number(e.target.value);
  if (e.target.value === '' || !(n >= Number(slider('h').min) && n <= Number(slider('h').max))) return;
  heightTyping = true; setHeight(n); heightTyping = false;
});
field('h').addEventListener('change', (e) => { setHeight(e.target.value); showHeight(); });
for (const k of camFields) {
  slider(k).addEventListener('input', (e) => setCam(k, e.target.value, 'slider'));
  // al escribir se aplica cuando hay un número completo; al salir del campo o con Enter se ajusta al rango
  field(k).addEventListener('input', (e) => {
    const n = Number(e.target.value), s = slider(k);
    if (e.target.value !== '' && n >= Number(s.min) && n <= Number(s.max)) setCam(k, n, 'field');
  });
  field(k).addEventListener('change', (e) => setCam(k, e.target.value, 'blur'));
}
// Pivote de la órbita (orbit.target): punto alrededor del que gira la cámara. Se ve con el panel abierto,
// por encima de todo (sin prueba de profundidad), con tamaño constante en pantalla.
const pivotMat = new THREE.MeshBasicMaterial({ color: 0xa8432a, depthTest: false, fog: false });
const pivotMark = new THREE.Group();
pivotMark.add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), pivotMat));
for (const [c, d] of [[0xd04040, [1, 0, 0]], [0x3fa34d, [0, 1, 0]], [0x3f6fd0, [0, 0, 1]]]) { // ejes x, y, z
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...d).multiplyScalar(-6), new THREE.Vector3(...d).multiplyScalar(6)]);
  pivotMark.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c, depthTest: false, fog: false })));
}
pivotMark.traverse((o) => { o.renderOrder = 999; });
pivotMark.visible = false;
scene.add(pivotMark);
camBtn.addEventListener('click', () => {
  camPanel.hidden = !camPanel.hidden;
  pivotMark.visible = !camPanel.hidden || !!unitPivot;
  camBtn.classList.toggle('on', !camPanel.hidden);
  camBtn.setAttribute('aria-expanded', String(!camPanel.hidden));
  if (!camPanel.hidden) { CAM.az = Math.round(THREE.MathUtils.radToDeg(orbit.getAzimuthalAngle())); showCam(); }
});
document.getElementById('cam-reset').addEventListener('click', () => {
  CAM = { ...CAM_DEFAULT };
  try { localStorage.removeItem('almar.cam'); } catch { /* sin almacenamiento */ }
  showCam();
  orbit.target.copy(unitPivot ?? towersPivot);
  applyCam(CAM.az);
});
showCam();
applyCam();

// Selector de torre: el punto de giro pasa al centro de la torre elegida (la cámara se desliza hasta ella).
// Si la otra torre queda entre la cámara y la elegida, se oculta mientras estorba (updateOcclusion, cada fotograma).
const focusBtns = [...document.querySelectorAll('#focus button')];
let focusKey = 'all', occluded = null; // occluded: torre oculta ahora (1 o 2)
const OTHER = { t1: { t: 2, key: 't2', root: l21G.scene }, t2: { t: 1, key: 't1', root: l16G.scene } };
// Caja orientada de cada torre (la de menor área en planta, probando ángulos): una caja alineada a los ejes es muy holgada
// en torres giradas y ocultaría la otra sin que tape nada.
function obbOf(root) {
  root.updateMatrixWorld(true);
  const pts = [], v = new THREE.Vector3();
  let y0 = Infinity, y1 = -Infinity;
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return; // las instancias guardan su geometría en el origen: contarían como puntos falsos
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.z); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
  });
  let best = null;
  for (let a = 0; a < 180; a += 3) {
    const c = Math.cos(D2R(a)), s = Math.sin(D2R(a));
    let u0 = Infinity, u1 = -Infinity, w0 = Infinity, w1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const u = pts[i] * c + pts[i + 1] * s, w = -pts[i] * s + pts[i + 1] * c;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (w < w0) w0 = w; if (w > w1) w1 = w;
    }
    const area = (u1 - u0) * (w1 - w0);
    if (!best || area < best.area) best = { c, s, area, u0, u1, w0, w1, y0, y1 };
  }
  return best;
}
const OBB = { t1: obbOf(l16G.scene), t2: obbOf(l21G.scene) };
const occRay = new THREE.Ray(), occHit = new THREE.Vector3(), occBox = new THREE.Box3();
const occCam = new THREE.Vector3(), occDir = new THREE.Vector3(), occPt = new THREE.Vector3();
const toFrame = (b, x, y, z, out) => out.set(x * b.c + z * b.s, y, -x * b.s + z * b.c);
function updateOcclusion() {
  const o = OTHER[focusKey];
  let hide = false;
  if (o) {
    // puntos de la torre elegida (centro y esquinas de su caja reducida): si el rayo de la cámara a alguno cruza la otra torre, estorba
    const fb = OBB[focusKey], ob = OBB[o.key];
    const cu = (fb.u0 + fb.u1) / 2, cw = (fb.w0 + fb.w1) / 2, cy = (fb.y0 + fb.y1) / 2;
    const hu = (fb.u1 - fb.u0) * 0.35 / 2, hw = (fb.w1 - fb.w0) * 0.35 / 2, hy = (fb.y1 - fb.y0) * 0.35 / 2;
    const m = occluded === o.t ? 8 : 2; // al ocultarse, margen extra para que no parpadee en el borde
    occBox.min.set(ob.u0 - m, ob.y0 - m, ob.w0 - m); occBox.max.set(ob.u1 + m, ob.y1 + m, ob.w1 + m);
    toFrame(ob, camera.position.x, camera.position.y, camera.position.z, occCam);
    for (let i = 0; i < 9 && !hide; i++) {
      const u = cu + (i === 0 ? 0 : (i & 1 ? hu : -hu)), w = cw + (i === 0 ? 0 : (i & 4 ? hw : -hw)), y = cy + (i === 0 ? 0 : (i & 2 ? hy : -hy));
      toFrame(ob, u * fb.c - w * fb.s, y, u * fb.s + w * fb.c, occPt); // de la caja de la torre elegida al marco de la otra
      const d = occPt.distanceTo(occCam);
      occRay.set(occCam, occDir.copy(occPt).sub(occCam).normalize());
      hide = !!occRay.intersectBox(occBox, occHit) && occHit.distanceTo(occCam) < d;
    }
  }
  const want = hide ? o.t : null;
  if (want === occluded) return;
  if (occluded) OTHER[occluded === 2 ? 't1' : 't2'].root.visible = true;
  if (want) o.root.visible = false;
  occluded = want;
  units.hideTower(want);
  renderer.shadowMap.needsUpdate = true;
}
for (const b of focusBtns) b.addEventListener('click', () => {
  focusKey = b.dataset.f;
  towersPivot = FOCUS[b.dataset.f];
  unitPivot = null; // elegir torre suelta el apartamento como pivote
  pivotMark.visible = !camPanel.hidden;
  glideToTowers = true;
  focusBtns.forEach((x) => x.classList.toggle('on', x === b));
});
ui.orbit.addEventListener('click', () => setMode('orbit'));
ui.units.addEventListener('click', () => setMode('units'));

const hourIn = document.getElementById('hour'), hourOut = document.getElementById('hourv');
let hourPending = null;
function showHour(h) { hourOut.textContent = `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; }
hourIn.addEventListener('input', () => { hourPending = +hourIn.value; showHour(hourPending); });
setHour(+hourIn.value);
showHour(+hourIn.value);

const clock = new THREE.Clock();
const glideStep = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (hourPending !== null) { setHour(hourPending); hourPending = null; } // una vez por fotograma como máximo
  if (glideToTowers) { // el punto de giro vuelve a las torres en ~0.4 s, sin salto de cámara
    // se mueven juntos el pivote y la cámara, así el ángulo y la distancia elegidos se conservan
    const p = unitPivot ?? towersPivot;
    glideStep.copy(p).sub(orbit.target).multiplyScalar(1 - Math.pow(0.0005, dt));
    orbit.target.add(glideStep);
    camera.position.add(glideStep);
    if (orbit.target.distanceTo(p) < 0.05) glideToTowers = false;
  }
  orbitKeys(dt);
  orbit.update();
  updateOcclusion();
  if (pivotMark.visible) {
    pivotMark.position.copy(orbit.target);
    pivotMark.scale.setScalar(camera.position.distanceTo(orbit.target) * 0.012);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
setMode('orbit');
document.getElementById('load').style.opacity = 0;
setTimeout(() => document.getElementById('load').remove(), 700);
window.__scene = { THREE, scene, camera, renderer, orbit, setMode, setHour, towers: { t1: l16G.scene, t2: l21G.scene } };
frame();

// Medición en equipos reales: abrir con ?fps para ver fluidez, carga y carga gráfica en pantalla.
if (new URLSearchParams(location.search).has('fps')) {
  const box = Object.assign(document.createElement('div'), { className: 'glass' });
  box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:40;padding:6px 10px;font:12px/1.4 monospace;white-space:pre;pointer-events:none';
  document.body.append(box);
  const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'GPU no disponible';
  const loadS = (performance.now() / 1000).toFixed(1);
  let n = 0, worst = 0, last = performance.now(), start = last;
  (function tick() {
    const now = performance.now();
    worst = Math.max(worst, now - last); last = now; n++;
    if (now - start >= 1000) {
      const { triangles, calls } = renderer.info.render;
      box.textContent = `${(n * 1000 / (now - start)).toFixed(0)} fps · peor ${worst.toFixed(0)} ms\n`
        + `carga ${loadS} s · texturas ${TEX_TIER}\n`
        + `${renderer.domElement.width}×${renderer.domElement.height} px · ${(triangles / 1e6).toFixed(2)} M tri · ${calls} llamadas\n${gpu}`;
      n = 0; worst = 0; start = now;
    }
    requestAnimationFrame(tick);
  })();
}
