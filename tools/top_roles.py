"""Papel de cada elemento del IFC de implantación (urbanismo) para la web.

El IFC no trae materiales de pavimento: vías, rampas y plataformas son "Suelo por defecto 30 cm".
Aquí se clasifica cada elemento por su nivel y su geometría:
  earth   sólido topográfico
  road    losas inclinadas (> 1 m de desnivel): red de vías y rampas            -> asfalto
  parking losas planas de la plataforma del Lote 21 (parqueaderos)               -> asfalto
  lawn    plataforma del Lote 16 (aún sin torre en la escena)                    -> prado
  paving  losas de portería y tanque                                             -> concreto
  lines   líneas de plaza de parqueadero                                         -> pintura blanca
Uso: python top_roles.py <implantacion.ifc> <salida.json>
"""
import json
import sys

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as E
import numpy as np

f = ifcopenshell.open(sys.argv[1])
s = ifcopenshell.geom.settings()
s.set('use-world-coords', True)
roles = {}
for e in f.by_type('IfcBuildingElementProxy'):
    n = (e.Name or '').lower()
    if 'topogr' in n:
        roles[e.GlobalId] = 'earth'
    elif 'aparcamiento' in n:
        roles[e.GlobalId] = 'lines'
for e in f.by_type('IfcSlab'):
    try:
        v = np.array(ifcopenshell.geom.create_shape(s, e).geometry.verts).reshape(-1, 3)
    except Exception:
        continue  # losa sin geometría
    level = (E.get_container(e).Name or '').upper()
    drop = v[:, 2].max() - v[:, 2].min()
    if drop > 1.0:
        roles[e.GlobalId] = 'road'
    elif 'LOTE 16' in level:
        roles[e.GlobalId] = 'lawn'
    elif 'LOTE 21' in level:
        roles[e.GlobalId] = 'parking'
    else:
        roles[e.GlobalId] = 'paving'
json.dump(roles, open(sys.argv[2], 'w'), indent=0)
from collections import Counter
print(Counter(roles.values()))
