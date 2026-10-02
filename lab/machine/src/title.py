"""The name "LIZ VAMPIRE TATTOO" as letter outlines (inline SVG), cut from the Metamorphous face.
Why outlines and not text: the name is the largest thing on the first screen. As outlines it paints with the very first
frame — no web-font wait, no flash of a fallback face — and it can carry the steel gradient + the pass of light.
Each word is its own <svg>, laid out by CSS exactly like a line of text (same line boxes as the type it replaces)."""
import pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = pathlib.Path(__file__).resolve().parent.parent / "fonts" / "metamorphous-latin.woff2"


def word(font, text, cls, line_height, tracking=0.0):
    upm = font["head"].unitsPerEm
    asc, desc = font["hhea"].ascent, -font["hhea"].descent
    cmap, glyphs = font.getBestCmap(), font.getGlyphSet()
    pen = SVGPathPen(glyphs, ntos=lambda v: ("%.0f" % v))
    x = 0.0
    for i, ch in enumerate(text):
        g = glyphs[cmap[ord(ch)]]
        g.draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))  # font units, y flipped to SVG's y-down
        x += g.width + (tracking * upm if i < len(text) - 1 else 0)
    box_h = line_height * upm                      # the CSS line box this word used to occupy
    top = -((box_h - (asc + desc)) / 2 + asc)      # half-leading + ascent above the baseline
    d = pen.getCommands()
    pid = "bt-" + cls
    return (
        f'<svg class="bt bt-{cls}" viewBox="0 {top:.0f} {x:.0f} {box_h:.0f}" aria-hidden="true" focusable="false">'
        f'<path id="{pid}" class="bt-ink" d="{d}"/>'
        f'<clipPath id="{pid}-c"><use href="#{pid}"/></clipPath>'
        f'<g clip-path="url(#{pid}-c)"><rect class="bt-sheen" x="0" y="{top:.0f}" width="{x:.0f}" height="{box_h:.0f}"/></g>'
        f"</svg>"
    ), x / upm, line_height


def markup():
    font = TTFont(str(FONT))
    liz, w1, _ = word(font, "LIZ", "liz", 1.13)
    vam, w2, _ = word(font, "VAMPIRE", "vampire", 1.13)
    tat, w3, _ = word(font, "TATTOO", "tattoo", 1.6, tracking=0.25)
    defs = (
        '<svg class="bt-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>'
        # brushed steel, top to bottom of each word
        '<linearGradient id="bt-steel" x1="0" y1="0" x2="0.04" y2="1">'
        '<stop offset="0.06" stop-color="#f7f4ee"/><stop offset="0.33" stop-color="#c2beb5"/><stop offset="0.51" stop-color="#5b5853"/>'
        '<stop offset="0.59" stop-color="#dcd8cf"/><stop offset="0.8" stop-color="#928e87"/><stop offset="1" stop-color="#cfcbc2"/>'
        "</linearGradient>"
        # the pass of light
        '<linearGradient id="bt-light" x1="0" y1="0" x2="1" y2="0.18">'
        '<stop offset="0.36" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.95"/><stop offset="0.64" stop-color="#fff" stop-opacity="0"/>'
        "</linearGradient>"
        "</defs></svg>"
    )
    html = (
        '<p class="brand-title" role="img" aria-label="Liz Vampire Tattoo" lang="en">'
        + liz + vam + tat + "</p>"
    )
    return defs, html, {"liz": w1, "vampire": w2, "tattoo": w3}


if __name__ == "__main__":
    d, h, w = markup()
    print(len(d) + len(h), "bytes", w)
