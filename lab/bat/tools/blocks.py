"""Pull the exact copy/markup the lab page reuses from the live homepage, build the flat SVG emblem and the craft photo.
Run from lab/bat:  python tools/blocks.py  ->  tools/blocks.json, assets/craft*.jpg"""
import json, re, pathlib
from PIL import Image, ImageOps
ROOT = pathlib.Path("../..")
src = (ROOT / "index.html").read_text(encoding="utf-8")

bar = re.search(r'<div class="mobile-bar".*?\n</div>', src, re.S).group(0)
price = re.search(r'<section id="price">.*?</section>', src, re.S).group(0)
price = price.replace(' reveal"', '"').replace('"reveal ', '"').replace('href="#gallery"', 'href="/#gallery"')
wa = re.search(r'href="(https://wa\.me/972542264377\?text=[^"]+)"', src).group(1)
fonts = re.search(r'(<link rel="preconnect" href="https://fonts.googleapis.com">.*?</noscript>)', src, re.S).group(1)
story_k = re.search(r'<section id="story".*?<h2 class="kicker reveal">(.*?)</h2>', src, re.S).group(1)
story_p = re.search(r'<p class="reveal story-p">(.*?)</p>', src, re.S).group(1).replace(" <br>", " ").replace("<br>", " ")
story_t = re.search(r'<p class="display story-title reveal">(.*?)</p>', src, re.S).group(1)
craft = re.findall(r'<section id="craft".*?</section>', src, re.S)[0]
craft_a = re.search(r'data-to="0\.45">(.*?)</p>', craft).group(1)
craft_b = re.search(r'data-to="0\.95">(.*?)</p>', craft, re.S).group(1).replace(" <br>", " ").replace("<br>", " ")
h1 = re.search(r'<h1 class="hero-h1">(.*?)</h1>', src).group(1)
meta = re.search(r'<p class="hero-meta">(.*?)</p>', src).group(1)

E = json.loads(pathlib.Path("src/emblem.json").read_text(encoding="utf-8"))
def d(poly): return "M" + "L".join(f"{x:g} {y:g}" for x, y in poly) + "Z"
gx, gy, gw, gh = E["ground"][0]
svg = (f'<svg class="emblem-flat" viewBox="0 0 {E["w"]} {E["h"]}" role="img" aria-label="ליז ואמפייר טאטו">'
       f'<path id="batShape" fill="currentColor" fill-rule="evenodd" d="{d(E["bat"]["outer"])}{"".join(d(h) for h in E["bat"]["holes"])}"/>'
       f'<ellipse class="emblem-ground" fill="currentColor" cx="{gx + gw / 2:g}" cy="{gy + gh / 2:g}" rx="{gw / 2:g}" ry="{gh / 2:g}"/></svg>')

im = Image.open(ROOT / "assets/img/work/w21.jpg").convert("L")   # 900x1200: keep the face and the pegasus, drop the floor
im = ImageOps.autocontrast(im.crop((60, 40, 840, 1140)), cutoff=1)
im.resize((780, 1100), Image.LANCZOS).save("assets/craft.jpg", quality=64, optimize=True, progressive=True)
im.resize((390, 550), Image.LANCZOS).save("assets/craft-s.jpg", quality=60, optimize=True, progressive=True)

out = dict(bar=bar, price=price, wa=wa, fonts=fonts, story_k=story_k, story_p=story_p, story_t=story_t, craft_a=craft_a, craft_b=craft_b, h1=h1, meta=meta, svg=svg)
pathlib.Path("tools/blocks.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
for k in ("story_k", "story_t", "story_p", "craft_a", "craft_b", "h1", "meta"): print(k, "=", out[k])
print("svg bytes", len(svg), "| craft.jpg", pathlib.Path("assets/craft.jpg").stat().st_size, "| craft-s.jpg", pathlib.Path("assets/craft-s.jpg").stat().st_size)
