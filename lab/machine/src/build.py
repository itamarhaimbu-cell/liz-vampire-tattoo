"""Builds the lab page from the site's own pieces, so the copy and the contact bar can't drift:
   ../index.html   = index.tpl.html + the live #price block + the live .mobile-bar markup + the ink path
   ../machine.css  = machine.base.css + the site's film grain + the service pages' sticky-bar CSS
   ../machine.js   = esbuild bundle of machine.src.js (three.js inside, tree-shaken)        [--js]
Run from anywhere:  python lab/machine/src/build.py [--js]"""
import pathlib, re, subprocess, sys

SRC = pathlib.Path(__file__).resolve().parent
LAB = SRC.parent
SITE = LAB.parent.parent
BUILD = pathlib.Path(r"C:\Users\PC\AppData\Local\Temp\claude\C--Users-PC\c4122aca-483d-4ad8-a465-de7fc647e757\scratchpad\lab\machine\build")

# one unbroken stroke (viewBox 0 0 360 300): starts at the bat's tail point, draws the bat — the studio's emblem —
# round the right wing, over the ears, round the left wing, back to where it began, then runs down toward the sentence.
INK = ("M 180 252 "
       "Q 197 224 221 226 Q 246 208 270 222 Q 302 204 334 170 "
       "Q 268 186 214 188 Q 205 175 197 158 Q 189 170 180 177 Q 171 170 163 158 Q 155 175 146 188 "
       "Q 92 186 26 170 Q 58 204 90 222 Q 114 208 139 226 Q 163 224 180 252 "
       "C 183 270 181 292 180 318")

site_html = (SITE / "index.html").read_text(encoding="utf-8")
main_css = (SITE / "css" / "main.css").read_text(encoding="utf-8")
pages_css = (SITE / "css" / "pages.css").read_text(encoding="utf-8")

# --- the live price block: everything inside .price-inner except the gallery link (it moves under the machine)
m = re.search(r'<section id="price">\s*<div class="section-inner price-inner">\n(.*?)\n\s*<a class="price-gallery', site_html, re.S)
price = m.group(1).replace(' reveal"', '"').replace('"reveal ', '"').replace(' reveal ', ' ')
price = price.replace('<br>', ' <br>').replace('  <br>', ' <br>')
assert 'price-steps' in price and 'wa.me/972542264377' in price and 'tel:039503487' in price

# --- the live sticky contact bar
m = re.search(r'<div class="mobile-bar".*?\n</div>', site_html, re.S)
bar = m.group(0)
assert bar.count('<a ') == 2

html = (SRC / "index.tpl.html").read_text(encoding="utf-8")
sys.path.insert(0, str(SRC)); import title
tdefs, thtml, _ = title.markup()
html = html.replace("{{INK}}", INK).replace("{{PRICE}}", price).replace("{{BAR}}", bar).replace("{{TITLE_DEFS}}", tdefs).replace("{{TITLE}}", thtml)
assert "{{" not in html
(LAB / "index.html").write_text(html, encoding="utf-8", newline="\n")

# --- css: base + grain + sticky bar
g0 = main_css.index("/* ---------- film grain ---------- */"); g1 = main_css.index("/* ---------- loader ---------- */")
grain = main_css[g0:g1].rstrip()
b0 = pages_css.index(".mobile-bar{display:none}")
tail = pages_css[b0:]
# take up to and including the two phone media blocks that style the bar
end = tail.index("@media (max-width:350px){"); end = tail.index("\n}", end) + 2
barcss = tail[:end]
barcss = re.sub(r"\n  (body|\.page-top[^{]*|\.crumbs|\.work-grid)\{[^}]*\}[^\n]*", "", barcss)  # page-specific rules the lab page doesn't need
css = (SRC / "machine.base.css").read_text(encoding="utf-8")
css += "\n" + grain + "\n@media (prefers-reduced-motion:reduce){.grain{animation:none}}\nhtml.a11y-still .grain{animation:none}\n"
css += "\n/* ---------- sticky contact bar (from the site's css/pages.css) ---------- */\n" + barcss + "\n"
(LAB / "machine.css").write_text(css, encoding="utf-8", newline="\n")
print("index.html", len(html), "bytes · machine.css", len(css), "bytes")

if "--js" in sys.argv:
    out = LAB / "machine.js"
    r = subprocess.run(["cmd", "/c", "npx", "esbuild", str(SRC / "machine.src.js"), "--bundle", "--minify", "--format=esm",
                        "--target=es2019", "--legal-comments=none", "--outfile=" + str(out)], cwd=BUILD, capture_output=True, text=True,
                       env=dict(__import__("os").environ, NODE_PATH=str(BUILD / "node_modules")))
    print(r.stdout[-400:], r.stderr[-800:])
    import gzip
    b = out.read_bytes(); print("machine.js", len(b), "bytes ·", len(gzip.compress(b, 9)), "gzip")
