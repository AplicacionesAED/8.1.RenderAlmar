import * as THREE from 'three';

// Órbita realista: fondo = fotos renderizadas en Twinmotion (72 vistas cada 5°, ver public/orbital) y encima el IFC en vivo.
// El IFC no se ve: solo escribe profundidad (para que los edificios tapen los prismas) y los prismas de apartamentos se
// dibujan después, con la misma cámara de cada foto.
//
// Cámaras de Twinmotion (CAMARAS_ORBITALES_TM2025_2.csv) -> escena de la app. Sin rotación, solo desplazamiento:
//   x = X + 68.729,  y = Z + 40.710,  z = Y - 274.899   (el centro de la órbita es el pivote "Todas")
// La órbita es un círculo de R = 128.025 m alrededor de (X -62.971, Y 247.468); el ángulo 0 está al sur y crece al este;
// Z 32.909 m, inclinación -10°, 55.1° de campo vertical, 16:9.
const TM = { cx: -62.971, cy: 247.468, R: 128.025, z: 32.909, pitch: -10, fov: 55.1 }; // pitch -10 de Twinmotion; trim -1.1 = ajuste medido sobre la foto 000
const OFF = { x: 68.729, y: 40.710, z: -274.899 };
// Una foto por grado: las múltiplos de 5° son las de Twinmotion (falta 290° en la entrega); las demás son cuadros
// intermedios generados con interpolación (RIFE) entre cada par de fotos vecinas.
const FRAMES = [...Array(360).keys()];
const isKey = (a) => a % 5 === 0 && a !== 290;
const VERSION = '20261125'; // cambia con cada entrega de fotos: evita que el navegador muestre fotos viejas en caché
const url = (a) => `/orbital/ALMAR_ORBITAL_${String(a).padStart(3, '0')}.jpg?v=${VERSION}`;
const params = new URLSearchParams(location.search);

export function createOrbital({ renderer, scene, camera, canvas, onEnter, onLeave }) {
  const img = document.getElementById('orbimg');
  const info = document.getElementById('orbinfo');
  const D2R = THREE.MathUtils.degToRad;
  const state = { active: false, angle: 0, want: 0, trim: Number(params.get('trim') ?? -1.1), loaded: new Set(), started: false };
  // máscara de profundidad: invisible; con ?calib se ve el IFC en magenta translúcido para ajustar la alineación
  const mask = params.has('calib')
    ? new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.35, depthWrite: true })
    : new THREE.MeshBasicMaterial({ colorWrite: false });

  const gap = (f, a) => Math.abs(((f - a + 540) % 360) - 180); // distancia angular
  const nearest = (a, list = FRAMES) => list.reduce((b, f) => (gap(f, a) < gap(b, a) ? f : b), list[0]);

  function poseFor(a) {
    const r = D2R(a), yaw = D2R(-90 - a), pitch = D2R(TM.pitch + state.trim);
    const pos = new THREE.Vector3(TM.cx + TM.R * Math.sin(r) + OFF.x, TM.z + OFF.y, TM.cy + TM.R * Math.cos(r) + OFF.z);
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    return { pos, dir };
  }

  // La cámara sigue siempre a la foto que se ve: si la del ángulo pedido aún no descargó, se muestra la cargada más
  // cercana (con su cámara) y se cambia cuando llegue. Antes la cámara avanzaba con la foto vieja en pantalla.
  // La foto se decodifica antes de cambiarla y la cámara se mueve en ese mismo momento, para que no quede un cuadro
  // con la cámara nueva sobre la foto anterior; si llegan varias, solo se aplica la más reciente.
  let asked = 0, applied = 0;
  function showFrame(a) {
    state.want = a;
    if (!state.loaded.size) return;
    const f = nearest(a, [...state.loaded]);
    state.angle = f;
    const tok = ++asked, im = new Image();
    im.src = url(f);
    im.decode().catch(() => {}).then(() => {
      if (tok < applied) return;
      applied = tok;
      img.src = im.src;
      const { pos, dir } = poseFor(f);
      camera.position.copy(pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(pos.clone().add(dir));
    });
    info.textContent = `${f}° · arrastra o usa ← →` + (state.loaded.size < FRAMES.length ? ` · cargando ${state.loaded.size}/${FRAMES.length}` : '');
  }

  // la imagen y el lienzo comparten un rectángulo 16:9 que cubre toda la ventana (sin barras; se recortan los bordes
  // que sobran), para que coincidan píxel a píxel
  function layout() {
    const w = Math.max(innerWidth, innerHeight * 16 / 9), h = w * 9 / 16;
    const box = { left: `${(innerWidth - w) / 2}px`, top: `${(innerHeight - h) / 2}px`, width: `${w}px`, height: `${h}px` };
    Object.assign(canvas.style, { inset: 'auto', ...box });
    Object.assign(img.style, box);
    renderer.setSize(w, h, false);
    camera.aspect = 16 / 9;
    camera.fov = TM.fov;
    camera.updateProjectionMatrix();
  }

  function preload() {
    if (state.started) return;
    state.started = true;
    // primero las de Twinmotion (cada 5°) y luego las intermedias; en cada grupo, las más cercanas al ángulo actual
    const order = [...FRAMES].sort((a, b) => (isKey(b) - isKey(a)) || gap(a, state.want) - gap(b, state.want));
    for (const f of order) {
      const im = new Image();
      im.onload = () => {
        state.loaded.add(f);
        // si la recién llegada queda más cerca del ángulo pedido que la que se ve, se cambia (foto y cámara juntas)
        if (gap(f, state.want) < gap(state.angle, state.want) || state.loaded.size === 1 || state.loaded.size === FRAMES.length) showFrame(state.want);
        else info.textContent = `${state.angle}° · arrastra o usa ← → · cargando ${state.loaded.size}/${FRAMES.length}`;
      };
      im.src = url(f);
    }
  }

  // Los cuadros intermedios tienen defectos en fachadas repetitivas (la interpolación confunde balcones vecinos), así
  // que solo se usan en movimiento: al soltar o con las flechas la vista se desliza grado a grado hasta una foto real.
  const KEYS = FRAMES.filter(isKey);
  let glide = null, glideTarget = 0;
  function glideTo(target) {
    clearInterval(glide);
    glideTarget = target;
    let a = Math.round(state.want);
    glide = setInterval(() => {
      const d = ((target - a + 540) % 360) - 180;
      if (Math.abs(d) < 1) { clearInterval(glide); glide = null; showFrame(target); return; }
      a = (a + Math.sign(d) + 360) % 360;
      showFrame(a);
    }, 30);
  }

  // arrastrar en horizontal gira; cada 4 px un ángulo de 1° (una foto nueva cada 4 px)
  let dragX = null, acc = 0;
  canvas.addEventListener('pointerdown', (e) => { if (state.active && e.button === 0) { clearInterval(glide); dragX = e.clientX; acc = state.angle; } });
  addEventListener('pointermove', (e) => {
    if (!state.active || dragX === null) return;
    acc -= (e.clientX - dragX) * 0.25; // arrastrar a la derecha: la cámara se mueve a la izquierda (ángulo menor)
    dragX = e.clientX;
    acc = ((acc % 360) + 360) % 360;
    if (nearest(acc) !== state.angle) showFrame(acc);
  });
  addEventListener('pointerup', () => { if (dragX !== null) glideTo(nearest(state.want, KEYS)); dragX = null; });
  addEventListener('keydown', (e) => {
    if (!state.active) return;
    // siguiente foto real a partir del ángulo pedido (o del destino, si ya se está deslizando): funciona aunque la foto
    // no haya llegado y permite encadenar varias pulsaciones
    const i = KEYS.indexOf(glide ? glideTarget : nearest(state.want, KEYS));
    if (e.code === 'ArrowLeft') glideTo(KEYS[(i + 1) % KEYS.length]);
    if (e.code === 'ArrowRight') glideTo(KEYS[(i - 1 + KEYS.length) % KEYS.length]);
  });

  return {
    get active() { return state.active; },
    state,
    layout,
    enter() {
      state.active = true;
      onEnter?.();
      document.body.classList.add('real');
      layout();
      preload();
      showFrame(state.angle);
    },
    leave() {
      state.active = false;
      document.body.classList.remove('real');
      canvas.style.cssText = '';
      onLeave?.();
    },
    // pasada 1: IFC como máscara de profundidad (transparente); pasada 2: el suelo con la ortofoto (capa 2) alrededor
    // del lote, tapado por esa profundidad donde está el proyecto; pasada 3: los prismas (capa 1)
    render() {
      const keep = camera.layers.mask;
      renderer.setClearColor(0x000000, 0);
      camera.layers.set(0);
      scene.overrideMaterial = mask;
      renderer.autoClear = true;
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
      renderer.autoClear = false;
      camera.layers.set(2);
      renderer.render(scene, camera);
      camera.layers.set(1);
      renderer.render(scene, camera);
      renderer.autoClear = true;
      camera.layers.mask = keep;
    },
  };
}
