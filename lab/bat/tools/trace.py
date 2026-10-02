"""Trace the bat emblem's alpha channel into polygons (outer shape + true letter holes) for the 3D emblem,
and bake the relief (normal) map its faces use.
Run from lab/bat:  python tools/trace.py [debug.png]  ->  src/emblem.json, assets/relief.webp"""
import json, sys, pathlib
import numpy as np, cv2
from PIL import Image

SRC = pathlib.Path("../../assets/img/logo.png")
UP = 4            # trace at 4x so curves come out smooth
EPS = 2.0         # simplification tolerance, in upscaled px (0.5 logo px: a fifth of a pixel at phone size)
im = Image.open(SRC).convert("RGBA")
W, H = im.size
alpha = im.split()[3]
a = np.array(alpha.resize((W * UP, H * UP), Image.LANCZOS))
a = cv2.GaussianBlur(a, (0, 0), 1.2)
_, mask = cv2.threshold(a, 127, 255, cv2.THRESH_BINARY)
cnts, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
hier = hier[0]

def simp(c):
    p = cv2.approxPolyDP(c, EPS, True)[:, 0, :].astype(float) / UP
    return [[round(float(x), 1), round(float(y), 1)] for x, y in p]

shapes = []
for i, c in enumerate(cnts):
    if hier[i][3] != -1: continue                       # holes are attached below
    if cv2.contourArea(c) < 400 * UP * UP: continue      # specks
    holes = [simp(cnts[j]) for j in range(len(cnts)) if hier[j][3] == i and cv2.contourArea(cnts[j]) > 20 * UP * UP]
    x, y, w, h = cv2.boundingRect(c)
    shapes.append({"outer": simp(c), "holes": holes, "bbox": [x / UP, y / UP, w / UP, h / UP], "area": cv2.contourArea(c) / UP / UP})
shapes.sort(key=lambda s: -s["area"])
bat, rest = shapes[0], shapes[1:]
out = {"w": W, "h": H, "bat": {"outer": bat["outer"], "holes": bat["holes"], "bbox": bat["bbox"]},
       "ground": [r["bbox"] for r in rest]}   # the oval under the bat = its shadow on the ground
pathlib.Path("src").mkdir(exist_ok=True)
pathlib.Path("src/emblem.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print("bat outer pts", len(bat["outer"]), "holes", [len(h) for h in bat["holes"]], "bbox", bat["bbox"], "ground", out["ground"])
print("json bytes", pathlib.Path("src/emblem.json").stat().st_size)

# ---- relief: a height field from the emblem itself (edges and letter cut-outs rounded over, a shallow dome over the
# wings), stored as a normal map in the emblem's own axes (x right, y up, z toward the viewer) ----
S = 2                                                   # work at 2x the logo
m = np.zeros((H * S, W * S), np.float32)
poly = lambda pts: np.round(np.array(pts) * S * 16).astype(np.int32)
cv2.fillPoly(m, [poly(bat["outer"])], 1.0, lineType=cv2.LINE_AA, shift=4)
for h in bat["holes"]: cv2.fillPoly(m, [poly(h)], 0.0, lineType=cv2.LINE_AA, shift=4)
edge = cv2.GaussianBlur(m, (0, 0), 6.0 * S)             # rounded edge, about 12 logo px wide
dome = cv2.GaussianBlur(m, (0, 0), 44.0 * S)            # shallow dome across each wing
height = edge * 20.0 + dome * 34.0                      # in logo px
gy, gx = np.gradient(height, 1.0 / S)                   # d/d(logo px); gy is along image-down
n = np.dstack([-gx, gy, np.ones_like(gx)])
n /= np.linalg.norm(n, axis=2, keepdims=True)
n = cv2.resize(n, (256, 256), interpolation=cv2.INTER_AREA)   # power of two (WebGL1 mipmaps); the relief is a 6px-sigma blur, so 256 samples it fully
n /= np.linalg.norm(n, axis=2, keepdims=True)
rgb = np.clip(np.round((n * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
pathlib.Path("assets").mkdir(exist_ok=True)
# lossless: lossy WebP is 14 KB but its ~0.7 degree noise shows up in the reflections as a brushed texture
Image.fromarray(rgb, "RGB").save("assets/relief.webp", "WEBP", lossless=True, method=6)
print("relief.webp", pathlib.Path("assets/relief.webp").stat().st_size, "bytes; max tilt deg", float(np.degrees(np.arccos(n[..., 2].min()))))

if len(sys.argv) > 1:
    D = 2
    dbg = np.zeros((H * D, W * D * 2, 3), np.uint8)
    pd = lambda pts: (np.array(pts) * D).astype(np.int32)
    cv2.fillPoly(dbg, [pd(bat["outer"])], (221, 231, 236))
    for h in bat["holes"]: cv2.fillPoly(dbg, [pd(h)], (0, 0, 0))
    dbg[:, W * D:, :] = cv2.resize(rgb[:, :, ::-1], (W * D, H * D))
    cv2.imwrite(sys.argv[1], dbg)
