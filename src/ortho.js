import * as THREE from 'three';

// Suelo con la ortofoto ContextCapture abr-2026 a nivel. Malla regular sobre la foto:
//  - dentro del lote: altura del terreno del IFC (un poco por debajo, para que el diseño quede encima)
//  - fuera: el DSM de la misma captura (sin árboles, ver filter), corregido al datum del
//    levantamiento con el desfase medido sobre las vías existentes (IFC − DSM; en PC-5 da ≈ 5.85 m)
//  - sin datos: altura de la celda conocida más cercana, suavizada
//   orto: { e0, n0 } esquina noroeste (EPSG:3116), { cols, rows, step } malla del DSM, { W, H } píxeles de la foto,
//         res (m/px), url de la foto; dsm: Float32Array cols × rows, fila 0 al norte, NaN = sin datos
//   earth / paved: mallas del terreno y de los pavimentos del IFC, ya con su matrixWorld
export function createOrthoGround({ orto, dsm, earth, paved, renderer, below = 0.15 }) {
  const { cols, rows, step } = orto;
  const x0 = orto.e0 - 825200, z0 = -(orto.n0 - 1615100); // escena: x = E − 825200, z = −(N − 1615100)
  const idx = (c, r) => r * cols + c;

  // Rasteriza triángulos del IFC sobre la malla: altura más alta (superficie superior del sólido), NaN fuera
  function raster(meshes) {
    const out = new Float32Array(cols * rows).fill(NaN);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const o of meshes) {
      const pos = o.geometry.attributes.position, index = o.geometry.index;
      const n = index ? index.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        const [ia, ib, ic] = index ? [index.getX(t), index.getX(t + 1), index.getX(t + 2)] : [t, t + 1, t + 2];
        a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
        const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(den) < 1e-6) continue; // cara vertical
        const c0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - x0) / step));
        const c1 = Math.min(cols - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / step));
        const r0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - z0) / step));
        const r1 = Math.min(rows - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / step));
        for (let r = r0; r <= r1; r++) {
          const z = z0 + r * step;
          for (let k = c0; k <= c1; k++) {
            const x = x0 + k * step;
            const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
            const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
            const l3 = 1 - l1 - l2;
            if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
            const y = l1 * a.y + l2 * b.y + l3 * c.y, i = idx(k, r);
            if (!(y <= out[i])) out[i] = y; // NaN o menor: se reemplaza
          }
        }
      }
    }
    return out;
  }

  // El DSM trae la copa de los árboles (picos al pegar la foto): apertura morfológica (mínimo y luego máximo en una
  // ventana de ±R celdas, ~6 m) para quedarse con el suelo, y un suavizado leve
  function filter(src, R, op) {
    const out = new Float32Array(src.length);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let v = op === 'min' ? Infinity : op === 'max' ? -Infinity : 0, m = 0;
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const s = src[idx(cc, rr)];
        if (isNaN(s)) continue;
        if (op === 'min') v = Math.min(v, s); else if (op === 'max') v = Math.max(v, s); else { v += s; m++; }
      }
      out[idx(c, r)] = isNaN(src[idx(c, r)]) ? NaN : op === 'mean' ? v / m : v;
    }
    return out;
  }
  dsm = filter(filter(filter(dsm, 3, 'min'), 3, 'max'), 1, 'mean');

  // Desfase vertical DSM -> levantamiento: mediana de (vía del IFC − DSM) donde ambos existen
  const road = raster(paved);
  const diffs = [];
  for (let i = 0; i < road.length; i++) if (!isNaN(road[i]) && !isNaN(dsm[i])) diffs.push(road[i] - dsm[i]);
  diffs.sort((p, q) => p - q);
  const offset = diffs.length ? diffs[diffs.length >> 1] : 0;

  const ifc = raster([...earth, ...paved]);
  const H = new Float32Array(cols * rows);
  const known = new Uint8Array(H.length);
  for (let i = 0; i < H.length; i++) {
    if (!isNaN(ifc[i])) { H[i] = ifc[i] - below; known[i] = 1; }
    else if (!isNaN(dsm[i])) { H[i] = dsm[i] + offset; known[i] = 1; }
  }
  // Sin datos (bordes de la captura; la foto ahí es transparente): celda conocida más cercana y suavizado
  const queue = [];
  for (let i = 0; i < H.length; i++) if (known[i]) queue.push(i);
  const seen = known.slice();
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], c = i % cols, r = (i / cols) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const j = idx(cc, rr);
      if (seen[j]) continue;
      seen[j] = 1; H[j] = H[i]; queue.push(j);
    }
  }
  for (let it = 0; it < 50; it++) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = idx(c, r);
      if (known[i]) continue;
      let s = 0, m = 0;
      if (c > 0) { s += H[i - 1]; m++; }
      if (c < cols - 1) { s += H[i + 1]; m++; }
      if (r > 0) { s += H[i - cols]; m++; }
      if (r < rows - 1) { s += H[i + cols]; m++; }
      H[i] = s / m;
    }
  }

  // Malla con la foto: el vértice (c, r) cae en el píxel (c, r) · step / res
  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(H.length * 3), UV = new Float32Array(H.length * 2), I = [];
  const pxStep = step / orto.res;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = idx(c, r);
    P.set([x0 + c * step, H[i], z0 + r * step], i * 3);
    UV.set([(c * pxStep) / orto.W, 1 - (r * pxStep) / orto.H], i * 2);
    if (c < cols - 1 && r < rows - 1) I.push(i, i + cols, i + 1, i + 1, i + cols, i + cols + 1);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setIndex(I);
  const tex = new THREE.TextureLoader().load(orto.url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // alphaTest: los bordes sin datos se recortan sin problemas de orden de transparencias
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
  mesh.userData.offset = offset;
  return mesh;
}
