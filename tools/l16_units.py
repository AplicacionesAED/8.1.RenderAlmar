# Apartamentos de la Torre 1 (Lote 16) desde los grupos de modelo de Revit del IFC (APTO_TB, APTO_3HABITACIONES,
# APTO_TC, APTO). No hay IfcSpace: cada apartamento es la caja de sus muros, losas, celosías, puertas y ventanas,
# medida en el marco de la torre (eje u a 78° en planta, w perpendicular), en coordenadas de la escena.
# Numeración como la Torre 2: x01 en el extremo sur (u mayor), x07 en el norte.
# Uso: python tools/l16_units.py ALM-L16-GEN-MO-ARQ-001.ifc data/l16_units_geom.json
import sys, json, math, ifcopenshell, ifcopenshell.geom
import numpy as np

AXIS = 78
FLOORS = {1: 45.97, 2: 49.57, 3: 53.17}  # cota del tope de losa de cada piso de venta
f = ifcopenshell.open(sys.argv[1])
s = ifcopenshell.geom.settings(); s.set(s.USE_WORLD_COORDS, True)
cu, su = math.cos(math.radians(AXIS)), math.sin(math.radians(AXIS))
KEEP = ('IfcWallStandardCase', 'IfcWall', 'IfcSlab', 'IfcMember', 'IfcDoor', 'IfcWindow')
aptos = []
for g in f.by_type('IfcGroup'):
    name = g.Name.split(':')[-1].replace('(elementos excluidos)', '').strip()
    if not name.startswith('APTO'):
        continue
    pts = []
    for r in g.IsGroupedBy:
        for o in r.RelatedObjects:
            if o.is_a() in KEEP:
                try:
                    pts.append(np.array(ifcopenshell.geom.create_shape(s, o).geometry.verts).reshape(-1, 3))
                except Exception:
                    pass
    v = np.vstack(pts)
    x, z = v[:, 0] - 825200, -(v[:, 1] - 1615100)  # escena: x = X - 825200, z = -(Y - 1615100)
    u, w = x * cu + z * su, -x * su + z * cu
    zb = float(np.percentile(v[:, 2], 2))
    floor = min(FLOORS, key=lambda k: abs(FLOORS[k] - zb))
    aptos.append({'f': floor, 'g': name, 'guid': g.GlobalId,
                  'u': [round(float(u.min()), 2), round(float(u.max()), 2)],
                  'w': [round(float(w.min()), 2), round(float(w.max()), 2)]})
# Balcón: su losa (porcelanato) y su baranda no están en el grupo del apartamento. Se extiende la caja (w mayor,
# fachada de balcones) hasta el borde de la losa o baranda del mismo piso que lo enfrenta. Sin deck ni piscina.
balc = []
for e in f.by_type('IfcSlab') + f.by_type('IfcRailing'):
    t = (e.ObjectType or e.Name or '').upper()
    if e.is_a('IfcSlab') and 'PORCELANATO' not in t:
        continue
    try:
        v = np.array(ifcopenshell.geom.create_shape(s, e).geometry.verts).reshape(-1, 3)
    except Exception:
        continue
    x, z = v[:, 0] - 825200, -(v[:, 1] - 1615100)
    u, w = x * cu + z * su, -x * su + z * cu
    balc.append((float(u.min()), float(u.max()), float(w.max()), float(v[:, 2].min()), float(v[:, 2].max())))
for a in aptos:
    zf, (u0, u1), w1 = FLOORS[a['f']], a['u'], a['w'][1]
    edge = [b[2] for b in balc if min(b[1], u1) - max(b[0], u0) > 1.0 and b[3] < zf + 1.2 and b[4] > zf - 0.6 and w1 < b[2] < w1 + 4]
    if edge:
        a['w'][1] = round(max(edge), 2)
units = []
for fl in sorted(FLOORS):
    row = sorted((a for a in aptos if a['f'] == fl), key=lambda a: -a['u'][0])  # sur -> norte
    for i, a in enumerate(row):
        units.append({'n': fl * 100 + i + 1, **a})
json.dump({
    'nota': 'Apartamentos de la Torre 1 medidos del IFC (grupos de modelo de Revit; tools/l16_units.py). Caja en el marco '
            'de la torre: eje u a "axis" grados del eje x de la escena, w perpendicular; incluye muros y llega hasta el '
            'borde del balcón (losa de porcelanato o baranda). '
            'HubSpot registra 8 por piso y el IFC 7: los datos comerciales quedan pendientes.',
    'axis': AXIS, 'floors': FLOORS, 'height': 3.6, 'units': units,
}, open(sys.argv[2], 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(len(units), 'apartamentos')
