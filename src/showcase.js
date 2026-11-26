import almar from '../data/almar_units.json';

// Presentación comercial: barra lateral flotante con secciones numeradas sobre la escena 3D.
// Cada sección decide qué muestra la escena (órbita realista o modelo 3D) y qué capa de contenido va encima.
// Los textos marcados como provisionales esperan el contenido real de Almar.
const ORB = (a) => `/orbital/ALMAR_ORBITAL_${String(a).padStart(3, '0')}.jpg?v=20261125`;
const SECTIONS = [
  ['inicio', 'Inicio'], ['nosotros', 'Nosotros'], ['ubicacion', 'Ubicación'], ['zonas', 'Zonas comunes'],
  ['unidades', 'Unidades'], ['disponibilidad', 'Disponibilidad'], ['contacto', 'Contacto'],
];
const fmt = (n) => n.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const range = (vals, unit = '') => {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return (lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`) + unit;
};
const planUrl = (u) => `${almar.planBase}${almar.torres[u.t].carpeta}${u.p}`;

// Tipologías a partir de las unidades de HubSpot: rangos de áreas, habitaciones y baños por tipo
const TIPOS = Object.values(almar.unidades.reduce((acc, u) => {
  (acc[u.tipo] ??= { tipo: u.tipo, us: [] }).us.push(u);
  return acc;
}, {})).sort((a, b) => a.tipo.localeCompare(b.tipo));

export function createShowcase({ setMode }) {
  const sb = document.getElementById('sb');
  const nav = sb.querySelector('nav');
  const secs = Object.fromEntries(SECTIONS.map(([id]) => [id, document.getElementById(`sec-${id}`)]));
  let current = null, dispoMode = 'real', tipo = TIPOS[0]?.tipo;

  nav.innerHTML = SECTIONS.map(([id, label], i) => `
    <button type="button" data-s="${id}"><span class="n">0${i + 1}</span><span>${label}</span>${id === 'unidades' ? '<span class="chev" aria-hidden="true">›</span>' : ''}</button>
    ${id === 'unidades' ? `<div class="sub" data-sub="unidades">${TIPOS.map((t) => `<button type="button" data-t="${t.tipo}">Tipo ${t.tipo}</button>`).join('')}</div>` : ''}`).join('');
  nav.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => go(b.dataset.s); });
  nav.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { tipo = b.dataset.t; go('unidades'); }; });

  // Abrir y cerrar la barra (en pantallas angostas empieza cerrada)
  const setOpen = (open) => document.body.classList.toggle('sb-closed', !open);
  document.getElementById('sb-close').onclick = () => setOpen(false);
  document.getElementById('sb-open').onclick = () => setOpen(true);
  const narrow = matchMedia('(max-width: 760px)');
  setOpen(!narrow.matches);
  narrow.addEventListener('change', () => setOpen(!narrow.matches));

  // --- Contenido de cada sección
  const stats = {
    area: range(almar.unidades.map((u) => u.at), ' m²'),
    hab: range(almar.unidades.map((u) => u.al)),
    n: almar.unidades.length,
  };
  secs.inicio.innerHTML = `
    <div class="hero">
      <p class="eyebrow">Isla de Barú · Cartagena, Colombia</p>
      <h2>Almar</h2>
      <p class="lead">Apartamentos frente al Caribe <span class="tbd">texto provisional</span></p>
      <button type="button" class="cta" data-go="nosotros">Conoce el proyecto <span aria-hidden="true">→</span></button>
    </div>
    <p class="note">*Render ilustrativo</p>`;
  secs.nosotros.innerHTML = `
    <div class="split">
      <div class="split-img" style="background-image:url('${ORB(265)}')"><p class="note">*Render ilustrativo</p></div>
      <div class="split-text dark">
        <p class="eyebrow">02 — Sobre el proyecto</p>
        <h2>Vivir entre el mar y el bosque.</h2>
        <p>Dos torres de tres pisos en Isla de Barú: la Torre 2 con vista al mar y la Torre 1 con vista al bosque,
        y una tercera torre en proyecto. <span class="tbd">Texto provisional: falta la descripción oficial de Almar.</span></p>
        <dl class="stats">
          <div><dt>${stats.area}</dt><dd>Área total</dd></div>
          <div><dt>${stats.hab}</dt><dd>Habitaciones</dd></div>
          <div><dt>${stats.n}</dt><dd>Unidades</dd></div>
          <div><dt>${TIPOS.length}</dt><dd>Tipologías</dd></div>
        </dl>
      </div>
    </div>`;
  secs.ubicacion.innerHTML = `
    <div class="full-img" style="background-image:url('/showcase/ubicacion_dron.webp')"></div>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="on" data-tab="datos">Datos</button>
      <button type="button" role="tab" data-tab="entorno">Beneficios del entorno</button>
    </div>
    <div class="place">
      <h2>Isla de Barú, Cartagena</h2>
      <p data-pane="datos">Bolívar, Colombia · 10°09′ N, 75°40′ O · a 0,8 km del Parque Nacional Natural Corales del Rosario</p>
      <p data-pane="entorno" hidden><span class="tbd">Provisional: playas, distancias a Cartagena y servicios cercanos.</span></p>
    </div>
    <p class="note">Foto del lote, abril de 2026</p>`;
  secs.ubicacion.querySelectorAll('[data-tab]').forEach((b) => {
    b.onclick = () => {
      secs.ubicacion.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      secs.ubicacion.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    };
  });
  secs.zonas.innerHTML = `<div class="chip">Zonas comunes · <span class="tbd">pendiente: lista y renders de cada zona</span></div>`;
  secs.contacto.innerHTML = `
    <div class="split">
      <div class="split-text dark contact-left" style="--bg:url('${ORB(315)}')">
        <p class="eyebrow">07 — Contacto</p>
        <h2>Hablemos sobre tu próximo hogar.</h2>
        <p>Solicita información detallada del proyecto. <span class="tbd">Datos de contacto provisionales.</span></p>
        <dl class="contact-data"><dt>Correo</dt><dd>—</dd><dt>Sala de ventas</dt><dd>—</dd></dl>
      </div>
      <form class="split-text form" id="contact-form" novalidate>
        <h3>Solicita información</h3>
        <div class="row2">
          <label>Nombre<input name="nombre" autocomplete="given-name" required></label>
          <label>Apellidos<input name="apellidos" autocomplete="family-name"></label>
        </div>
        <div class="row2">
          <label>Correo<input name="correo" type="email" autocomplete="email" required></label>
          <label>Teléfono<input name="telefono" type="tel" autocomplete="tel"></label>
        </div>
        <label>Mensaje<textarea name="mensaje" rows="3" placeholder="Cuéntanos qué buscas"></textarea></label>
        <button type="submit" class="cta solid">Enviar mensaje</button>
        <p class="form-msg" role="status"></p>
      </form>
    </div>`;
  const form = document.getElementById('contact-form');
  form.onsubmit = (e) => {
    e.preventDefault();
    form.querySelector('.form-msg').textContent = 'El envío aún no está configurado: falta definir a dónde llegan las solicitudes.';
  };

  function renderUnidades() {
    const t = TIPOS.find((x) => x.tipo === tipo) ?? TIPOS[0];
    const u0 = t.us.find((u) => u.t === 2) ?? t.us[0];
    const torres = [...new Set(t.us.map((u) => almar.torres[u.t].nombre))].join(' y ');
    secs.unidades.innerHTML = `
      <div class="units-plan">
        <p class="eyebrow">05 — Tipología · Tipo ${t.tipo}</p>
        <img src="${planUrl(u0)}" alt="Plano del apartamento ${u0.n}, tipo ${t.tipo}">
        <p class="note">*Plano ilustrativo · apartamento ${u0.n} de la ${almar.torres[u0.t].nombre}</p>
      </div>
      <aside class="units-card">
        <p class="eyebrow">05 — Tipología</p>
        <h2>Tipo ${t.tipo}</h2>
        <p class="sub-line">${range(t.us.map((u) => u.al))} habitaciones · ${range(t.us.map((u) => u.ba))} baños</p>
        <dl class="stats">
          <div><dt>${range(t.us.map((u) => u.pa), ' m²')}</dt><dd>Área privada</dd></div>
          <div><dt>${range(t.us.map((u) => u.te), ' m²')}</dt><dd>Terraza</dd></div>
          <div><dt>${range(t.us.map((u) => u.at), ' m²')}</dt><dd>Área total</dd></div>
          <div><dt>${t.us.length}</dt><dd>Unidades · ${torres}</dd></div>
        </dl>
        <p class="price">Precio desde <span class="tbd">pendiente</span></p>
        <button type="button" class="cta solid" data-ask="${t.tipo}">Solicitar información</button>
        <button type="button" class="cta ghost" data-go="disponibilidad">Ver disponibilidad</button>
      </aside>`;
    secs.unidades.querySelector('[data-ask]').onclick = () => {
      form.mensaje.value = `Me interesa la tipología ${t.tipo}.`;
      go('contacto');
    };
    secs.unidades.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
    nav.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === t.tipo));
  }

  // Disponibilidad: órbita realista (fotos) o modelo 3D navegable, ambos con los apartamentos por estado
  const dispoTabs = document.getElementById('dispo-tabs');
  dispoTabs.querySelectorAll('[data-m]').forEach((b) => {
    b.onclick = () => { dispoMode = b.dataset.m; go('disponibilidad'); };
  });

  document.querySelectorAll('.sec [data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); });
  document.getElementById('legal').onclick = () => document.getElementById('legal-dlg').showModal();

  function go(id) {
    if (!secs[id]) id = 'inicio';
    current = id;
    for (const [k, el] of Object.entries(secs)) el.classList.toggle('on', k === id);
    SECTIONS.forEach(([k]) => document.body.classList.toggle(`sec-${k}`, k === id));
    nav.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === id));
    nav.querySelector('[data-sub="unidades"]').classList.toggle('open', id === 'unidades');
    if (id === 'unidades') renderUnidades();
    // escena: el modelo 3D solo en Disponibilidad si se eligió; en lo demás, la órbita realista de fondo
    setMode(id === 'disponibilidad' && dispoMode === 'units' ? 'units' : 'real');
    dispoTabs.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === dispoMode));
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    if (matchMedia('(max-width: 760px)').matches) setOpen(false);
  }
  addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id !== current) go(id); });
  go(location.hash.slice(1) || 'inicio');
  return { go };
}
