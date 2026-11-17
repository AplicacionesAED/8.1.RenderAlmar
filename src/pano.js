import * as THREE from 'three';

// Visor de panoramas 360 (imagenes equirectangulares 2:1) en una capa a pantalla completa.
// Arrastrar gira la vista, la rueda cambia el zoom y las miniaturas cambian de ambiente. Escape o "×" cierran.
export function openPano(title, items, start = 0) {
  const box = document.createElement('div');
  box.className = 'pano';
  box.innerHTML = `
    <canvas></canvas>
    <div class="pano-head glass"><span>${title}</span><button class="pano-x" aria-label="Cerrar">×</button></div>
    <div class="pano-thumbs glass">${items.map((it, i) => `<button data-i="${i}" title="${it.nombre}"><img src="${it.mini}" alt="${it.nombre}"></button>`).join('')}</div>
    <div class="pano-hint glass">Arrastra para mirar · rueda para acercar</div>`;
  document.body.appendChild(box);

  const canvas = box.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1100);
  const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 64, 40).scale(-1, 1, 1), mat)); // vista desde adentro

  // arranca mirando al centro de la imagen: asi la costura izquierda-derecha queda a las espaldas
  let yaw = Math.PI / 2, pitch = 0, dirty = true, raf = 0, drag = null, current = -1;
  const loader = new THREE.TextureLoader();
  const cache = new Map();
  function setPano(i) {
    current = i;
    box.querySelectorAll('.pano-thumbs button').forEach((b) => b.classList.toggle('on', Number(b.dataset.i) === i));
    const apply = (t) => { if (current === i) { mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; dirty = true; } };
    if (cache.has(i)) return apply(cache.get(i));
    loader.load(items[i].foto, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      cache.set(i, t);
      apply(t);
    });
  }

  const resize = () => {
    renderer.setSize(box.clientWidth, box.clientHeight, false);
    camera.aspect = box.clientWidth / box.clientHeight;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const onDown = (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); };
  const onMove = (e) => {
    if (!drag) return;
    const k = (camera.fov / 75) * 0.0045;
    yaw += (e.clientX - drag[0]) * k;
    pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag[1]) * k, -1.45, 1.45);
    drag = [e.clientX, e.clientY];
    dirty = true;
  };
  const onUp = () => { drag = null; };
  const onWheel = (e) => {
    camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.04, 30, 100);
    camera.updateProjectionMatrix();
    dirty = true;
    e.preventDefault();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    removeEventListener('keydown', onKey);
    cache.forEach((t) => t.dispose());
    mat.dispose();
    renderer.dispose();
    box.remove();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('resize', resize);
  addEventListener('keydown', onKey);
  box.querySelector('.pano-x').onclick = close;
  box.querySelectorAll('.pano-thumbs button').forEach((b) => { b.onclick = () => setPano(Number(b.dataset.i)); });

  (function loop() {
    raf = requestAnimationFrame(loop);
    if (!dirty) return;
    dirty = false;
    camera.rotation.set(pitch, yaw, 0, 'YXZ'); // arrastrar mueve la imagen con el cursor
    renderer.render(scene, camera);
  })();
  resize();
  setPano(start);
  return close;
}
