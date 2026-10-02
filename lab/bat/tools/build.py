"""Write lab/bat/index.html from the blocks pulled off the live homepage (tools/blocks.py).  Run from lab/bat."""
import json, pathlib
B = json.loads(pathlib.Path("tools/blocks.json").read_text(encoding="utf-8"))
MENU = [("/#story", "הסיפור"), ("/#artists", "האמנים"), ("/#gallery", "עבודות"), ("/#studio", "הסטודיו"), ("/#proof", "לקוחות מספרים"), ("/#contact", "צרו קשר")]
html = f"""<!DOCTYPE html>
<html lang="he" dir="rtl" class="at-hero">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>ליז ואמפייר טאטו — סטודיו לקעקועים בראשון לציון (lab: chrome bat)</title>
<meta name="theme-color" content="#060606">
{B["fonts"]}
<link rel="stylesheet" href="css/bat.css">
<link rel="stylesheet" href="/css/common.css">
<script src="/js/common.js"></script>
<link rel="icon" href="/favicon.ico" sizes="any">
</head>
<body>

<a class="skip-link" href="#main">דלג לתוכן</a>
<div class="grain" aria-hidden="true"></div>

<header class="topbar">
  <a class="brand" href="/"><img class="brand-mark" src="/assets/img/logo-nav.png" width="165" height="132" alt="ליז ואמפייר טאטו"></a>
  <button id="menuBtn" aria-label="תפריט" aria-expanded="false" aria-controls="mobileMenu"><span></span><span></span></button>
</header>
<div id="mobileMenu" role="dialog" aria-modal="true" aria-label="תפריט ניווט" hidden>
  <button id="menuClose" aria-label="סגירה">✕</button>
  <nav>
{chr(10).join(f'    <a href="{h}">{t}</a>' for h, t in MENU)}
  </nav>
</div>

<!-- the emblem in 3D: one canvas behind the text, drawn only when something moves -->
<canvas id="stage" aria-hidden="true"></canvas>

<main id="main">

<!-- 0 · HERO — the emblem is the logo: flat at first paint, chrome a moment later, in the same place -->
<section class="chapter" id="c-hero" data-yaw="0" data-pitch="0" data-roll="0" data-sway="1">
  <div class="hero-lockup">
    <div class="emblem" id="emblem">{B["svg"]}</div>
    <p class="wordmark">LIZ VAMPIRE TATTOO</p>
    <span class="hero-rule" aria-hidden="true"></span>
    <h1 class="hero-h1">{B["h1"]}</h1>
    <p class="hero-meta">{B["meta"]}</p>
  </div>
</section>

<!-- 1 · STORY — 1996 -->
<section class="chapter" id="c-story" data-yaw="-0.62" data-pitch="0.14" data-roll="0.07" data-sway="0.45">
  <!-- the emblem's place in this chapter; the flat copy inside only shows when the 3D one is not running -->
  <div class="bat-area" aria-hidden="true"><div class="bat-slot"><svg viewBox="0 0 763 520"><use href="#batShape"/></svg></div></div>
  <div class="story-copy">
    <p class="mark" aria-hidden="true">01 · 1996</p>
    <h2 class="kicker">{B["story_k"]}</h2>
    <p class="display story-title">{B["story_t"]}</p>
    <p class="story-p">{B["story_p"]}</p>
  </div>
</section>

<!-- 2 · CRAFT — the emblem turns edge-on and becomes the one continuous line; real work behind it -->
<section class="chapter" id="c-craft" data-yaw="0" data-pitch="1.5708" data-roll="0" data-sway="0" data-thin="0.16">
  <img class="craft-photo" src="assets/craft-s.jpg" srcset="assets/craft-s.jpg 390w, assets/craft.jpg 780w" sizes="(min-width:821px) 46vw, 100vw" width="780" height="1100" alt="קעקוע — פסל האלה" loading="lazy" decoding="async">
  <div class="craft-shade" aria-hidden="true"></div>
  <div class="craft-copy">
    <p class="mark" aria-hidden="true">02 · 2026</p>
    <h2 class="display craft-title">{B["craft_a"]}</h2>
    <div class="craft-line" aria-hidden="true"><span class="bat-slot"></span></div>
    <p class="craft-p">{B["craft_b"]}</p>
  </div>
</section>

<!-- PRICE + HOW TO BOOK — normal scrolling from here on -->
{B["price"]}

<p class="onward"><span dir="ltr">lab · chrome bat</span><a href="/#gallery">המשך האתר ←</a></p>

</main>

{B["bar"]}

<script src="js/page.js" defer></script>
</body>
</html>
"""
pathlib.Path("index.html").write_text(html, encoding="utf-8")
print("index.html", len(html.encode("utf-8")), "bytes")
