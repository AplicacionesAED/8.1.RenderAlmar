import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Coordenadas IFC compartidas -> escena (x, z_ifc -> y, -y_ifc -> z)
const ORIGIN = new THREE.Vector3(825200, 0, -1615100);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xf1ece2);
const scene = new THREE.Scene();
const root = new THREE.Group();
root.position.copy(ORIGIN).multiplyScalar(-1);
scene.add(root);

const ink = new THREE.LineBasicMaterial({ color: 0x3b352c });
const inkLight = new THREE.LineBasicMaterial({ color: 0x9a8f7c, transparent: true, opacity: 0.55 });

const loader = new GLTFLoader();
const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));

function sketch(gltf, mat, angle = 30) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, angle), mat);
    o.add(e);
    o.material = new THREE.MeshBasicMaterial({ visible: false });
  });
  root.add(gltf.scene);
}

const [top, port] = await Promise.all([load('/models/top.glb'), load('/models/port.glb')]);
sketch(top, inkLight, 25);
sketch(port, ink, 30);

// Vista cenital ortográfica
const box = new THREE.Box3().setFromObject(root);
const size = box.getSize(new THREE.Vector3());
const ctr = box.getCenter(new THREE.Vector3());
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
cam.position.set(ctr.x, 1000, ctr.z);
cam.up.set(0, 0, -1);
cam.lookAt(ctr.x, 0, ctr.z);

// Paradas del recorrido (coordenadas IFC x, y) y etiquetas
const STOPS = [
  ['Portería', 825180, 1615055],
  ['Vía de acceso', 825188, 1615078],
  ['Tanque SUM/RCI', 825203, 1615087],
  ['Lote 21', 825193, 1615112],
  ['Lote 16', 825192, 1615135],
  ['Vista aérea', 825200, 1615100],
];
const toScene = ([, x, y]) => new THREE.Vector3(x - ORIGIN.x, 60, -y - ORIGIN.z);
const routeCurve = new THREE.CatmullRomCurve3(STOPS.slice(0, 5).map(toScene), false, 'catmullrom', 0.5);
const routeLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(routeCurve.getPoints(120)),
  new THREE.LineDashedMaterial({ color: 0xa8432a, dashSize: 3, gapSize: 2 })
);
routeLine.computeLineDistances();
scene.add(routeLine);

const labels = STOPS.map((s, i) => {
  const el = document.createElement('div');
  el.textContent = `${i + 1} · ${s[0]}`;
  el.style.cssText = 'position:fixed;font:12px Georgia,serif;color:#a8432a;white-space:nowrap;pointer-events:none;transform:translate(8px,-50%)';
  document.body.appendChild(el);
  return el;
});
function placeLabels() {
  STOPS.forEach((s, i) => {
    const p = toScene(s).project(cam);
    labels[i].style.left = ((p.x + 1) / 2) * innerWidth + 'px';
    labels[i].style.top = ((1 - p.y) / 2) * innerHeight + 'px';
  });
}

function fit() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const a = w / h, pad = 1.12;
  let hw = (size.x * pad) / 2, hh = (size.z * pad) / 2;
  if (hw / hh > a) hh = hw / a; else hw = hh * a;
  Object.assign(cam, { left: -hw, right: hw, top: hh, bottom: -hh });
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  placeLabels();
}
addEventListener('resize', fit);
fit();
window.__ready = true;
