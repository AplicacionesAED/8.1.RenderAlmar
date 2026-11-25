import * as THREE from 'three';

// Suelo con la ortofoto a nivel: malla regular sobre toda la foto. Dentro del lote toma la altura del terreno del IFC
// (un poco por debajo, para que el diseño quede encima); fuera del lote no hay levantamiento, así que la altura se
// extiende desde el borde del lote y se suaviza (estimada, no real: el relieve real saldría del DSM de ContextCapture).
//   orto: { e0, n0 } esquina inferior izquierda en EPSG:3116, { w, h } tamaño en metros, url de la imagen
//   meshes: mallas del terreno y pavimentos del IFC, ya con su matrixWorld
export function createOrthoGround({ orto, meshes, renderer, step = 2, below = 0.15 }) {
  const nx = Math.ceil(orto.w / step), nz = Math.ceil(orto.h / step);
  const x0 = orto.e0 - 825200, zS = -(orto.n0 - 1615100); // escena: x = E − 825200, z = −(N − 1615100)
  const dx = orto.w / nx, dz = orto.h / nz;
  const H = new Float32Array((nx + 1) * (nz + 1)).fill(-Infinity); // fila j = 0 al sur
  const idx = (i, j) => j * (nx + 1) + i;

  // 1. Rasterizar los triángulos del IFC sobre la malla: altura más alta (superficie superior del sólido)
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
      const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - x0) / dx)), i1 = Math.min(nx, Math.floor((Math.max(a.x, b.x, c.x) - x0) / dx));
      const j0 = Math.max(0, Math.ceil((zS - Math.max(a.z, b.z, c.z)) / dz)), j1 = Math.min(nz, Math.floor((zS - Math.min(a.z, b.z, c.z)) / dz));
      for (let j = j0; j <= j1; j++) {
        const z = zS - j * dz;
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * dx;
          const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den;
          const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c.y - below;
          const k = idx(i, j);
          if (y > H[k]) H[k] = y;
        }
      }
    }
  }

  // 2. Fuera del lote: altura del punto conocido más cercano (recorrido en anchura) y luego suavizado solo ahí
  const known = new Uint8Array(H.length);
  const queue = [];
  for (let k = 0; k < H.length; k++) if (H[k] > -Infinity) { known[k] = 1; queue.push(k); }
  if (!queue.length) return null;
  const seen = known.slice();
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], i = k % (nx + 1), j = (k / (nx + 1)) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii > nx || jj > nz) continue;
      const kk = idx(ii, jj);
      if (seen[kk]) continue;
      seen[kk] = 1; H[kk] = H[k]; queue.push(kk);
    }
  }
  for (let it = 0; it < 150; it++) {
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = idx(i, j);
      if (known[k]) continue;
      let s = 0, m = 0;
      if (i > 0) { s += H[k - 1]; m++; }
      if (i < nx) { s += H[k + 1]; m++; }
      if (j > 0) { s += H[k - nx - 1]; m++; }
      if (j < nz) { s += H[k + nx + 1]; m++; }
      H[k] = s / m;
    }
  }

  // 3. Malla con la foto: u de oeste a este, v de sur a norte
  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(H.length * 3), UV = new Float32Array(H.length * 2), I = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = idx(i, j);
    P.set([x0 + i * dx, H[k], zS - j * dz], k * 3);
    UV.set([i / nx, j / nz], k * 2);
    if (i < nx && j < nz) I.push(k, k + 1, k + nx + 1, k + 1, k + nx + 2, k + nx + 1);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  geo.setIndex(I);
  const tex = new THREE.TextureLoader().load(orto.url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // alphaTest: los bordes sin datos de la ortofoto se recortan sin problemas de orden de transparencias
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
}
