"""Terreno circundante: continúa el borde del modelo de urbanismo hasta el horizonte.

El IFC de implantación solo modela ~177 x 155 m: el sólido topográfico termina en un corte vertical
y las vías llegan hasta ese borde. Aquí se rasteriza la cara superior del terreno y de las vías
(celda de 4 m), se propaga la altura del borde hacia afuera y se baja suave hasta la cota del
horizonte. Dentro del área modelada la malla queda 0.6 m por debajo (oculta bajo el terreno real).
El terreno de afuera es INVENTADO: no hay levantamiento topográfico de esa zona.

Salida: public/data/skirt.bin (Float32, filas en z) + public/data/skirt.json (rejilla).
Coordenadas de escena: x = X - 825200, z = -(Y - 1615100), y = cota.
Uso: python terrain_skirt.py <implantacion.ifc>
"""
import json
import math
import os
import sys

import ifcopenshell
import ifcopenshell.geom
import numpy as np

O = (825200.0, 1615100.0)
CELL = 4.0
HALF = 600.0            # la rejilla cubre +-600 m alrededor del origen del proyecto
HORIZON_Y = 30.0        # cota del suelo lejano de la escena (disco del horizonte)
FADE = 220.0            # metros en los que el borde baja hasta el horizonte
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')

f = ifcopenshell.open(sys.argv[1])
s = ifcopenshell.geom.settings()
s.set('use-world-coords', True)
elems = [e for e in f.by_type('IfcBuildingElementProxy') if 'topogr' in (e.Name or '').lower()] + list(f.by_type('IfcSlab'))

n = int(2 * HALF / CELL) + 1
x0 = z0 = -HALF
H = np.full((n, n), -np.inf)          # [iz, ix] altura máxima de superficie hacia arriba
for e in elems:
    try:
        g = ifcopenshell.geom.create_shape(s, e).geometry
    except Exception:
        continue
    v = np.array(g.verts).reshape(-1, 3)
    sx, sz, sy = v[:, 0] - O[0], -(v[:, 1] - O[1]), v[:, 2]   # a escena
    tri = np.array(g.faces).reshape(-1, 3)
    for a, b, c in tri:
        ax, az, bx, bz, cx, cz = sx[a], sz[a], sx[b], sz[b], sx[c], sz[c]
        den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if abs(den) < 1e-9:
            continue  # cara vertical: no aporta a la superficie
        i0 = max(0, int(math.floor((min(ax, bx, cx) - x0) / CELL)))
        i1 = min(n - 1, int(math.ceil((max(ax, bx, cx) - x0) / CELL)))
        j0 = max(0, int(math.floor((min(az, bz, cz) - z0) / CELL)))
        j1 = min(n - 1, int(math.ceil((max(az, bz, cz) - z0) / CELL)))
        if i1 < i0 or j1 < j0:
            continue
        px, pz = np.meshgrid(x0 + np.arange(i0, i1 + 1) * CELL, z0 + np.arange(j0, j1 + 1) * CELL)
        w1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den
        w2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den
        w3 = 1 - w1 - w2
        inside = (w1 >= -1e-6) & (w2 >= -1e-6) & (w3 >= -1e-6)
        if not inside.any():
            continue
        y = w1 * sy[a] + w2 * sy[b] + w3 * sy[c]
        sub = H[j0:j1 + 1, i0:i1 + 1]
        sub[inside] = np.maximum(sub[inside], y[inside])

known = np.isfinite(H)
print('celdas con superficie del modelo', int(known.sum()))

# propaga hacia afuera la altura del borde (vecino conocido más cercano, por anillos)
near = np.where(known, H, np.nan)
dist = np.where(known, 0.0, np.inf)
step = 0
while np.isnan(near).any() and step < n:
    step += 1
    acc = np.zeros_like(H); cnt = np.zeros_like(H)
    for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(near, dz, 0), dx, 1)
        ok = np.isfinite(sh)
        acc[ok] += sh[ok]; cnt[ok] += 1
    grow = np.isnan(near) & (cnt > 0)
    near[grow] = acc[grow] / cnt[grow]
    dist[grow] = step * CELL

# afuera: del borde al horizonte, con lomas suaves que crecen con la distancia
gx, gz = np.meshgrid(x0 + np.arange(n) * CELL, z0 + np.arange(n) * CELL)
t = np.clip(dist / FADE, 0, 1); t = t * t * (3 - 2 * t)
hills = (np.sin(gx / 61.0) * np.cos(gz / 47.0) + 0.5 * np.sin((gx + gz) / 23.0)) * 2.5
edge = np.clip(dist / 40.0, 0, 1)
out = near * (1 - t) + HORIZON_Y * t + hills * edge * (1 - t * 0.6)
# la propagación por anillos deja escalones: se suaviza solo la parte inventada (afuera)
for _ in range(12):
    avg = sum(np.roll(np.roll(out, dz, 0), dx, 1) for dz in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    out = np.where(known | (dist <= CELL), out, avg)
Y = np.where(known, H - 0.6, out).astype(np.float32)

os.makedirs(OUT, exist_ok=True)
Y.tofile(os.path.join(OUT, 'skirt.bin'))
json.dump({'n': n, 'x0': x0, 'z0': z0, 'cell': CELL, 'nota': 'terreno circundante inventado; ver tools/terrain_skirt.py'},
          open(os.path.join(OUT, 'skirt.json'), 'w'))
print('rejilla', n, 'x', n, 'alturas', round(float(Y.min()), 1), '-', round(float(Y.max()), 1))
