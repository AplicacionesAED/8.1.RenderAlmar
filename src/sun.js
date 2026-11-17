import * as THREE from 'three';

// Posición solar (aprox. NOAA, error < 1°) para el sitio del proyecto.
// IFCSITE de Almar: lat 10°9'15.95" N, lon 75°40'22.8" O; hora local UTC-5.
export const SITE = { lat: 10 + 9 / 60 + 15.948 / 3600, lon: -(75 + 40 / 60 + 22.8 / 3600), tz: -5 };

const rad = Math.PI / 180;

/** Dirección hacia el sol en coordenadas de escena (x = este, y = arriba, z = sur) y elevación en grados. */
export function sunAt(date, hour, site = SITE) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const doy = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86400000);
  const g = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqtime + 4 * site.lon - 60 * site.tz;
  const ha = (tst / 4 - 180) * rad;
  const lat = site.lat * rad;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.PI / 2 - Math.acos(Math.min(1, Math.max(-1, cosZ)));
  // azimut desde el norte, en sentido horario
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return { dir, elevation: el / rad };
}

export const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
