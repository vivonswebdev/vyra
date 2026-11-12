"""Lecture indépendante des fichiers exportés avec pyembroidery (MIT).
Affiche, pour chaque fichier : points cousus, changements de couleur, largeur et hauteur (mm)."""
import os
import sys
import json
import pyembroidery

out = {}
d = sys.argv[1]
for name in sorted(os.listdir(d)):
    if not (name.endswith(".pes") or name.endswith(".dst")):
        continue
    p = pyembroidery.read(os.path.join(d, name))
    st = sum(1 for s in p.stitches if (s[2] & pyembroidery.COMMAND_MASK) == pyembroidery.STITCH)
    cc = sum(1 for s in p.stitches if (s[2] & pyembroidery.COMMAND_MASK) in (pyembroidery.COLOR_CHANGE, pyembroidery.COLOR_BREAK))
    xs = [s[0] for s in p.stitches if (s[2] & pyembroidery.COMMAND_MASK) == pyembroidery.STITCH]
    ys = [s[1] for s in p.stitches if (s[2] & pyembroidery.COMMAND_MASK) == pyembroidery.STITCH]
    out[name] = {"stitches": st, "colorChanges": cc, "threads": len(p.threadlist),
                 "widthMm": round((max(xs) - min(xs)) / 10, 1), "heightMm": round((max(ys) - min(ys)) / 10, 1)}
print(json.dumps(out))
