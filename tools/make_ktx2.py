"""Convierte las texturas de public/tex a KTX2 (se quedan comprimidas en la GPU) en dos tamaños.

  public/tex/ktx2/hi/<id>_<mapa>.ktx2   2K (o 1K si el original es 1K): escritorio
  public/tex/ktx2/lo/<id>_<mapa>.ktx2   1K (o 512): móvil
Color (diff): ETC1S/BasisLZ, sRGB. Normal (nor_gl): UASTC + zstd, lineal. Rugosidad (rough): ETC1S, lineal.
Requiere toktx (KTX-Software 4.4.2) y Pillow. Uso: python tools/make_ktx2.py
"""
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'tex')
TOKTX = os.path.join(os.environ['LOCALAPPDATA'], 'Programs', 'KTX-Software', 'bin', 'toktx.exe')
PAT = re.compile(r'^(?P<id>.+)_(?P<map>diff|nor_gl|rough)_(?P<res>[12]k)\.jpg$')

ARGS = {
    'diff': ['--encode', 'etc1s', '--clevel', '2', '--qlevel', '160', '--assign_oetf', 'srgb'],
    'nor_gl': ['--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18', '--assign_oetf', 'linear'],
    'rough': ['--encode', 'etc1s', '--clevel', '2', '--qlevel', '128', '--assign_oetf', 'linear'],
}


def encode(src_img, kind, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, 'in.png')
        src_img.convert('RGB').save(png)
        cmd = [TOKTX, '--t2', '--genmipmap', *ARGS[kind], dst, png]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            sys.exit(f'toktx falló en {dst}: {r.stderr.strip()}')


def main():
    files = sorted(f for f in os.listdir(ROOT) if PAT.match(f))
    for f in files:
        m = PAT.match(f)
        img = Image.open(os.path.join(ROOT, f))
        w = img.width
        name = f"{m['id']}_{m['map']}.ktx2"
        encode(img, m['map'], os.path.join(ROOT, 'ktx2', 'hi', name))
        lo = img.resize((w // 2, w // 2), Image.LANCZOS)
        encode(lo, m['map'], os.path.join(ROOT, 'ktx2', 'lo', name))
        print(f'{f}: {w}px -> hi {w}px, lo {w // 2}px')


if __name__ == '__main__':
    main()
