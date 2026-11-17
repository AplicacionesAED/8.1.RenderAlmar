import * as THREE from 'three';
import almar from '../data/almar_units.json';
import levels from '../data/almar_levels.json';
import geom from '../data/almar_units_geom.json';
import interiores from '../data/almar_interiores.json';
import l16 from '../data/l16_units_geom.json';
import { openPano } from './pano.js';

// Selector de apartamentos de la Torre 2 (Lote 21), portado de visor-oliv-3d (src/almar.js).
// Datos de HubSpot (data/almar_units.json). Cada apartamento es un prisma delimitado (data/almar_units_geom.json),
// medido sobre el GLB del visor (almar_l21_c.glb, centrado en su caja). Aquí se reubica en la escena:
// x y z coinciden al milímetro con el IFC (anchos 30.698 m y 50.594 m); la altura sale de las cotas de piso.
// Torre 1 (Lote 16): 21 apartamentos medidos del IFC (data/l16_units_geom.json, ya en coordenadas de la escena).
// HubSpot registra 24 (8 por piso) y no coincide con el IFC: se toma de HubSpot solo el estado del mismo número;
// área y tipo quedan pendientes.
const TOWER = 2;
const MODEL_TO_SCENE = new THREE.Vector3(825205.374 - 825200, 60.588, -1615128.669 + 1615100);
const MODEL_MIN_Y = -7.528; // mínimo en y del GLB del visor (base de almar_levels.json)

export const STATUS = {
  Disponible: { hex: 0x2fbf71, css: '#2fbf71' },
  Separado: { hex: 0xf2c200, css: '#f2c200' },
  Reservado: { hex: 0xf28c28, css: '#f28c28' },
  Vendido: { hex: 0xe5484d, css: '#e5484d' },
  'No Disponible': { hex: 0x8a94a0, css: '#8a94a0' },
  Pendiente: { hex: 0x5b8def, css: '#5b8def' }, // Torre 1: sin datos comerciales confirmados
};
const fmt = (n) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const key = (u) => `${u.t}-${u.n}`; // los números se repiten entre torres
const code = (u) => `Torre ${u.t} - ${u.n}`;
const planUrl = (u) => `${almar.planBase}${almar.torres[u.t].carpeta}${u.p}`;
// panoramas del apartamento: los de su unidad, si no los de su tipo, si no los de por defecto
const panosOf = (u) => interiores.porUnidad[`${u.t}-${u.n}`] ?? interiores.porTipo[u.tipo] ?? interiores.porDefecto;

export function createUnits({ scene, camera, canvas, orbit }) {
  const hub1 = (n) => almar.unidades.find((u) => u.t === 1 && u.n === n);
  const t1 = l16.units.map((a) => ({ t: 1, n: a.n, f: a.f, s: hub1(a.n)?.s ?? 'Pendiente', g: a.g, geo: a,
    area: (a.u[1] - a.u[0]) * (a.w[1] - a.w[0]) }));
  const units = [...almar.unidades.filter((u) => u.t === TOWER), ...t1];
  const listEl = document.getElementById('list');
  const legendEl = document.getElementById('legend');
  const panel = document.getElementById('panel');

  let active = false, selected = null, hovered = null, filter = null, statusMode = false, flyTo = null;

  // Un prisma por apartamento (rectángulo con su terraza, de la losa del piso a la del siguiente)
  const group = new THREE.Group();
  group.position.copy(MODEL_TO_SCENE);
  group.visible = false;
  scene.add(group);
  const g = geom[TOWER];
  const phi = THREE.MathUtils.degToRad(g.phi), cp = Math.cos(phi), sp = Math.sin(phi);
  const at = (p, q) => [g.c[0] + p * cp - q * sp, g.c[1] + p * sp + q * cp]; // (p, q) -> (x, z)
  // Torre 1: ya en coordenadas de la escena, marco (u, w) de la torre
  const group1 = new THREE.Group();
  group1.visible = false;
  scene.add(group1);
  const a1 = THREE.MathUtils.degToRad(l16.axis), cu = Math.cos(a1), su = Math.sin(a1);
  const at1 = (u, w) => [u * cu - w * su, u * su + w * cu]; // (u, w) -> (x, z)
  const meshes = new Map();
  for (const u of units) {
    const e = 0.15; // sale un poco de los muros para no pelear con ellos
    let pts, y0, y1;
    if (u.t === 1) {
      const r = u.geo;
      pts = [at1(r.u[0] - e, r.w[0] - e), at1(r.u[0] - e, r.w[1] + e), at1(r.u[1] + e, r.w[1] + e), at1(r.u[1] + e, r.w[0] - e)];
      y0 = l16.floors[u.f]; y1 = y0 + l16.height;
    } else {
      const r = g.rects[(u.n % 100) - 1]; // x01 = índice 0 ... x06 = índice 5
      pts = [at(r.p[0] - e, r.q[0] - e), at(r.p[0] - e, r.q[1] + e), at(r.p[1] + e, r.q[1] + e), at(r.p[1] + e, r.q[0] - e)];
      [y0, y1] = levels[TOWER][u.f];
    }
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: y1 - y0 - 0.1, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // (x, y, profundidad) -> (x, profundidad, z)
    geo.translate(0, (u.t === 1 ? 0 : MODEL_MIN_Y) + y0 + 0.05, 0);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 3;
    mesh.userData.unit = u;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, toneMapped: false }));
    edges.visible = false;
    edges.renderOrder = 4;
    (u.t === 1 ? group1 : group).add(mesh, edges);
    meshes.set(key(u), { u, mesh, edges, mat });
  }

  const shown = (u) => !filter || filter === u.s;
  function refresh() {
    for (const { u, mesh, edges, mat } of meshes.values()) {
      const isSel = selected === u, isHov = hovered === u;
      const on = statusMode ? shown(u) || isSel : isSel || isHov;
      mat.color.setHex(isHov && !statusMode && !isSel ? 0x7fd0ff : STATUS[u.s].hex);
      mat.opacity = on ? (isSel ? 0.7 : isHov ? 0.8 : statusMode ? 0.5 : 0.35) : 0;
      mesh.visible = on;
      edges.visible = on && (isSel || statusMode);
    }
  }

  function showPanel(u) {
    if (!u) { panel.hidden = true; return; }
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    panel.hidden = false;
    if (u.t === 1) { // estado y plano de HubSpot (mismo número); el resto, solo lo medido en el IFC
      const hub = hub1(u.n);
      panel.innerHTML = `
      <div class="p-kind">Apartamento · ${u.g}</div>
      <div class="p-name">${code(u)}</div>
      <dl>
        ${row('Estado', `<span class="dot" style="background:${STATUS[u.s].css}"></span>${u.s}`)}
        ${row('Piso', u.f)}
        ${row('Huella aprox.', `${fmt(Math.round(u.area))} m²`)}
        ${row('Vista', almar.torres[u.t].vista)}
      </dl>
      ${hub ? `<img class="p-plan" src="${planUrl(hub)}" alt="Plano del apartamento ${code(u)}" title="Clic para ampliar">
      <div class="p-cap">Plano de HubSpot del ${u.n}: puede no coincidir con este apartamento del IFC (${u.g})</div>` : ''}
      <p class="p-cap">Estado y plano de HubSpot. Huella medida del IFC (incluye balcón y muros). Área y tipo pendientes: HubSpot registra 8 apartamentos por piso y el IFC 7.</p>
      ${panosOf(u).length ? '<button id="p-pano" class="p-primary">Ver interior 360°</button>' : ''}
      <button id="p-close" aria-label="Cerrar">Cerrar</button>`;
    } else panel.innerHTML = `
      <div class="p-kind">Apartamento · Tipo ${u.tipo}</div>
      <div class="p-name">${code(u)}</div>
      <dl>
        ${row('Estado', `<span class="dot" style="background:${STATUS[u.s].css}"></span>${u.s}`)}
        ${row('Piso', u.f)}
        ${row('Área privada', `${fmt(u.pa)} m²`)}
        ${row('Terraza', `${fmt(u.te)} m²`)}
        ${row('Área total', `${fmt(u.at)} m²`)}
        ${row('Habitaciones', u.al)}
        ${row('Baños', fmt(u.ba))}
        ${row('Vista', almar.torres[u.t].vista)}
      </dl>
      <img class="p-plan" src="${planUrl(u)}" alt="Plano del apartamento ${code(u)}" title="Clic para ampliar">
      <div class="p-cap">Plano tipo ${u.tipo}</div>
      ${panosOf(u).length ? '<button id="p-pano" class="p-primary">Ver interior 360°</button>' : ''}
      <button id="p-close" aria-label="Cerrar">Cerrar</button>`;
    panel.querySelector('#p-pano')?.addEventListener('click', () => openPano(`${code(u)} · interior`, panosOf(u)));
    const plan = panel.querySelector('.p-plan');
    if (plan) plan.onclick = (e) => {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.innerHTML = `<img src="${e.target.src}" alt="${e.target.alt}">`;
      box.onclick = () => box.remove();
      document.body.appendChild(box);
    };
    document.getElementById('p-close').onclick = () => select(null);
  }

  function select(u, fly = false) {
    selected = u;
    refresh();
    showPanel(u);
    if (u && fly) {
      const rec = meshes.get(key(u));
      flyTo = new THREE.Box3().setFromObject(rec.mesh).getCenter(new THREE.Vector3());
    }
    listEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !!u && b.dataset.k === key(u)));
  }

  function buildList() {
    const tip = (u) => (u.t === 1 ? `${u.s} · ${u.g} · ~${fmt(Math.round(u.area))} m²` : `${u.s} · Tipo ${u.tipo} · ${fmt(u.at)} m²`);
    listEl.innerHTML = [TOWER, 1].map((t) => `<div class="lv"><span><b>${almar.torres[t].nombre}</b></span></div>` + [3, 2, 1].map((f) => {
      const us = units.filter((u) => u.t === t && u.f === f).sort((a, b) => a.n - b.n);
      return `
      <div class="lv"><span>Piso ${f}</span>${us.map((u) => `
        <button data-k="${key(u)}" style="--st:${STATUS[u.s].css}" title="${tip(u)}" ${filter && filter !== u.s ? 'hidden' : ''}>${u.n}</button>`).join('')}</div>`;
    }).join('')).join('');
    listEl.querySelectorAll('button').forEach((b) => {
      b.onclick = () => select(units.find((u) => key(u) === b.dataset.k), true);
    });
  }

  function buildLegend() {
    const count = {};
    units.forEach((u) => { count[u.s] = (count[u.s] ?? 0) + 1; });
    legendEl.innerHTML = `<button class="mode ${statusMode ? 'on' : ''}" data-mode>Estados</button>` + Object.keys(STATUS).filter((s) => count[s]).map((s) => `
      <button data-st="${s}" class="${filter && filter !== s ? 'off' : ''}">
        <span class="dot" style="background:${STATUS[s].css}"></span>${s} <b>${count[s]}</b></button>`).join('');
    legendEl.querySelector('[data-mode]').onclick = () => { statusMode = !statusMode; refresh(); buildLegend(); };
    legendEl.querySelectorAll('[data-st]').forEach((b) => {
      b.onclick = () => {
        filter = filter === b.dataset.st ? null : b.dataset.st;
        statusMode = true; // elegir un estado en la leyenda muestra esos apartamentos
        buildList(); buildLegend(); refresh();
      };
    });
  }

  // clic y cursor sobre los prismas (el rayo ignora si se ven o no; con filtro solo cuentan los mostrados)
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const cand = [...meshes.values()].filter((x) => !statusMode || shown(x.u) || selected === x.u);
    const hit = ray.intersectObjects(cand.map((x) => x.mesh), false)[0];
    return hit ? hit.object.userData.unit : null;
  }
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (active) down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!active || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; // arrastrar es girar, no elegir
    const u = pick(e);
    select(u && u === selected ? null : u); // clic en el elegido lo suelta; clic en vacío, también
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.buttons) return;
    const u = pick(e);
    if (u === hovered) return;
    hovered = u;
    canvas.style.cursor = u ? 'pointer' : '';
    refresh();
  });

  return {
    setActive(on) {
      active = on;
      group.visible = group1.visible = on;
      if (on) { buildList(); buildLegend(); refresh(); }
      else { hovered = null; select(null); canvas.style.cursor = ''; }
    },
    // acerca suavemente el punto de mira al apartamento elegido
    update() {
      if (!flyTo) return;
      orbit.target.lerp(flyTo, 0.12);
      if (orbit.target.distanceTo(flyTo) < 0.05) flyTo = null;
    },
    center: () => new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()),
  };
}
