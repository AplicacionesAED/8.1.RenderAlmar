"""Mapas de materiales del IFC para la web.

- styles: id de IfcSurfaceStyleRendering -> nombre del estilo (IfcConvert nombra así los materiales del GLB).
- slab_finish: GUID de cada losa -> nombre de su capa superior (el acabado de piso). IfcConvert usa el
  estilo de la capa de hormigón, así que el acabado se asigna aparte, por elemento.
Uso: python ifc_materials.py <entrada.ifc> <salida.json>
"""
import json
import sys

import ifcopenshell
import ifcopenshell.util.element as E

f = ifcopenshell.open(sys.argv[1])
styles = {}
for r in f.by_type('IfcSurfaceStyleRendering'):
    owner = next((s for s in f.get_inverse(r) if s.is_a('IfcSurfaceStyle')), None)
    if owner is not None and owner.Name:
        styles[f'IfcSurfaceStyleRendering-{r.id()}'] = owner.Name
slab_finish = {}
for e in f.by_type('IfcSlab'):
    m = E.get_material(e)
    if m is not None and m.is_a('IfcMaterialLayerSetUsage'):
        m = m.ForLayerSet
    if m is not None and m.is_a('IfcMaterialLayerSet') and m.MaterialLayers:
        slab_finish[e.GlobalId] = m.MaterialLayers[0].Material.Name
json.dump({'styles': styles, 'slab_finish': slab_finish}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('estilos', len(styles), 'losas con acabado', len(slab_finish))
