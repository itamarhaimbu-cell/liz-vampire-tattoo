/* ============ DRAFT A+D — INK + WINDOW ============
   1. Film stage: every section after the hero has a film (or photo) in the fixed .bd-stack. For story, price and
      artists, while a section's top travels from the bottom of the screen to 22% of it, its film bleeds in over the
      current one through ink — a WebGL shader (domain-warped noise, fibrous capillary edge, a light-catching rim, a
      faint bleed halo ahead of it). When the ink has covered the screen the DOM layer takes over and the canvas sleeps.
   2. CRAFT is the window (concept D): the screen goes to black, the needle film appears whole in a small, wide (16:9)
      framed window, and as the reader scrolls (the section pins) the window opens to full bleed with the film always
      cover-fitted to it — the camera moving into the frame. Only once it is fully open does the craft copy rise in.
   3. Everything follows the scroll with a little lag. If the reader stops halfway, it finishes (or recedes) by
      itself, calmly, without moving the page — the ink to covered/uncovered, the window to one of its three resting
      states (price film / small window / full bleed). The page never rests on a half-done transition.
   4. Text never rides the scroll: lines rise in once from a mask, on a clock (GSAP SplitText).
   FINAL DRAFT: artists sit on plain black (the ink floods the craft film to black); styles' film soaks back in;
   from the gallery on, the live sections sit on solid black over the stage and share the same text system
   (lines rise once, photos settle). The chapter mark follows every section, not only the opening. */
(function () {
  'use strict';

  var root = document.documentElement;
  var isSmall = window.matchMedia('(max-width:820px)').matches;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || root.classList.contains('a11y-still');
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(a, b, v) { v = clamp01((v - a) / (b - a)); return v * v * (3 - 2 * v); }
  var FREEZE = /[?&]freeze\b/.test(location.search);

  /* ---------- the four transitions (origin in screen coordinates: x right, y down) ----------
     edge: light on the leading edge · glow: pale light in the fringe fibres · settle: how far the film settles in */
  var CFG = [
    { sec: 'story',   kind: 'ink', origin: [0.50, 1.06], seed: 1.7, edge: 0.5, glow: 0, settle: 0.14 }, // a cut: rises from below as the hero lets go
    { sec: 'price',   kind: 'ink', origin: [1.08, 0.28], seed: 4.3, edge: 0.8, glow: 0, settle: 0.08 }, // from the right edge, where Hebrew starts
    { sec: 'craft',   kind: 'window' },                                                                     // the window opens
    { sec: 'artists', kind: 'ink', origin: [-0.08, 0.86], seed: 2.6, edge: 0.42, glow: 0, settle: 0.04 }, // FINAL: the ink floods the film to black (artists sit on plain black, as live)
    { sec: 'styles',  kind: 'ink', origin: [1.06, 0.84], seed: 3.4, edge: 0.34, glow: 0, settle: 0.1 }    // FINAL: the styles film soaks back in from the lower right
  ];
  var SPAN = 0.78;            // an ink transition = the section's top travelling from the bottom edge to 22% of the screen
  var WIN_ENTRY_FROM = 0.62, WIN_ENTRY_TO = 0.12; // window: black + small window fade in while the craft top travels from 62% to 12% of the screen
                              // (by then the last price lines have left the screen)
  var WIN_TRAVEL = isSmall ? 1.1 : 1.3; // then the section pins and the window opens over this many screens
  var WIN_K = 0.35;           // the window's timeline: 0..K = fade in small, K..1 = open to full bleed

  function posOf(el) {
    var s = (isSmall && el.getAttribute('data-pos-m')) || el.getAttribute('data-pos') || '0.5 0.5';
    var a = s.split(/\s+/).map(parseFloat);
    return [isNaN(a[0]) ? 0.5 : a[0], isNaN(a[1]) ? 0.5 : a[1]];
  }

  var T = CFG.map(function (c) {
    var layer = document.querySelector('.bd[data-bd="' + c.sec + '"]');
    var media = layer.querySelector('.bd-media');
    var pos = posOf(layer);
    media.style.objectPosition = (pos[0] * 100) + '% ' + (pos[1] * 100) + '%'; // the shader reads the same numbers
    var x = {
      sec: document.getElementById(c.sec), layer: layer, media: media, isVideo: media.tagName === 'VIDEO',
      kind: c.kind, origin: c.origin, seed: c.seed, edge: c.edge || 0, glow: c.glow || 0, settleAmp: c.settle || 0.08, pos: pos,
      shade: ['--s0', '--s1', '--s2'].map(function (k) { return parseFloat(layer.style.getPropertyValue(k)); }),
      chapter: document.getElementById(c.sec).getAttribute('data-chapter'),
      top: 0, h: 0, t: 0, v: 0, mode: 'follow', settleTo: 0, anchor: 0,
      loaded: false, stillLoaded: false, poster: null, tex: null, texW: 0, texH: 0, lastSrc: null, on: false, playing: false, kb: -1
    };
    if (c.kind === 'window') {
      x.black = document.querySelector('.bd-black');
      x.frame = document.querySelector('.win-frame');
      x.cap = document.querySelector('.win-cap');
      x.shown = 0; x.clip = ''; x.rect = null; x.restart = true;
      x.shadeEl = layer.querySelector('.bd-shade');
    }
    return x;
  });
  var WIN = T.filter(function (x) { return x.kind === 'window'; })[0];
  var WIN_I = T.indexOf(WIN);

  /* ---------- geometry: measured on resize / load / fonts, never per frame ---------- */
  var vw = 0, vh = 0;
  // every section with a chapter label (the opening and the rest of the site) — measured here, never per frame
  var CH = Array.prototype.map.call(document.querySelectorAll('[data-chapter]'), function (el) {
    return { el: el, label: el.getAttribute('data-chapter'), top: 0, h: 0 };
  });
  function measure() {
    var w = root.clientWidth, h = window.innerHeight;
    // the iOS URL bar changes innerHeight by ~80px while scrolling: ignore that, keep the mapping still
    if (!vh || w !== vw || Math.abs(h - vh) > 160) { vw = w; vh = h; WIN.rect = null; }
    var y = window.pageYOffset;
    T.forEach(function (x) { var r = x.sec.getBoundingClientRect(); x.top = r.top + y; x.h = r.height; });
    CH.forEach(function (c) { var r = c.el.getBoundingClientRect(); c.top = r.top + y; c.h = r.height; });
  }
  measure();
  window.addEventListener('resize', function () { measure(); sizeCanvas(); });
  window.addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  setTimeout(measure, 1500);

  /* the window's closed rect: wide 16:9 — the film's own shape, so the whole shot shows in it — centred in the visible
     area above the phone contact bar. Desktop: half the screen wide (on a 2560 screen that's the 1080p film at ~2/3) */
  function winRect() {
    if (WIN.rect) return WIN.rect;
    var w0, h0, cy;
    if (isSmall) { w0 = vw * 0.86; h0 = w0 * 9 / 16; cy = (vh - 68) * 0.5; }
    else { w0 = Math.min(vw * 0.5, vh * 0.56 * 16 / 9); h0 = w0 * 9 / 16; cy = vh * 0.5; }
    WIN.rect = { l: (vw - w0) / 2, t: cy - h0 / 2, w: w0, h: h0, r: isSmall ? 6 : 8 };
    return WIN.rect;
  }

  /* ---------- media: loaded about two screens ahead, played only while on screen ---------- */
  // the still (a poster, ~25 KB) is fetched ~2.5 screens ahead so the ink always has a picture to draw;
  // the film itself only ~1.3 screens ahead, so nothing heavy competes with the first screen
  function loadStill(x) {
    if (x.stillLoaded) return;
    x.stillLoaded = true;
    if (x.isVideo) {
      // the stills sit in data-poster so none of them is fetched with the page (they competed with the hero on a slow
      // phone); each one arrives ~2.5 screens ahead, for the ink to draw and as the film's poster until it plays
      var still = x.media.getAttribute('data-poster');
      x.poster = new Image(); x.poster.decoding = 'async'; x.poster.src = still;
      x.media.poster = still;
    }
    else { x.media.src = x.media.getAttribute('data-ink-src'); x.loaded = true; }
  }
  function load(x) {
    if (x.loaded) return;
    loadStill(x);
    x.loaded = true;
    x.media.src = (isSmall && x.media.getAttribute('data-ink-src-m')) || x.media.getAttribute('data-ink-src'); // phones: a lighter cut
    x.media.preload = 'auto';
  }
  function setPlaying(x, on) {
    if (!x.isVideo || x.playing === on || reduced) return;
    x.playing = on;
    if (on) { var p = x.media.play(); if (p && p.catch) p.catch(function () {}); } else x.media.pause();
  }

  /* ---------- WebGL ink ---------- */
  var canvas = document.querySelector('.ink-gl');
  var gl = null, prog = null, U = {}, canvasOn = false;
  // glReady: the program is linked and warmed up. pcx: KHR_parallel_shader_compile, so the driver compiles the shader
  // off the main thread (the compile used to freeze the first scroll for ~0.25s on a fast PC, far longer on a phone).
  // glSlow: this machine can't draw the ink at a steady frame rate (a weak or software GPU) — cross-fades instead.
  var glReady = false, pcx = null, glSlow = false;
  var lowGPU = !!window.__lowGPU; // set in <head>: no working graphics card (software rendering) = light mode

  var VERT = window.INK_SHADER.VERT, FRAG = window.INK_SHADER.FRAG; // ink-shader.js

  function initGL() {
    if (reduced || lowGPU) return false;
    if (gl) return true;
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
        powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
    } catch (e) { gl = null; }
    if (!gl) return false;
    pcx = gl.getExtension('KHR_parallel_shader_compile');
    // start the compile and the link, and don't ask for their status here: asking blocks until the driver is done
    var vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vs, VERT); gl.compileShader(vs);
    gl.shaderSource(fs, FRAG); gl.compileShader(fs);
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    prog._vs = vs; prog._fs = fs;
    sizeCanvas();
    return true;
  }
  // checked once a frame until it succeeds: finishes the setup only once the driver says the program is linked
  function finishGL() {
    if (glReady) return true;
    if (!gl || !prog) return false;
    if (pcx && !gl.getProgramParameter(prog, pcx.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('ink shader:', gl.getShaderInfoLog(prog._fs) || gl.getProgramInfoLog(prog));
      gl = null; prog = null; return false;
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uTex', 'uTexSize', 'uRes', 'uP', 'uOrigin', 'uSeed', 'uScale', 'uShade', 'uMaxD', 'uTime', 'uEdge', 'uGlow', 'uPos'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // warm-up: one tiny draw while nothing is on screen, so the driver's first-draw work never lands on a scroll frame
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
    gl.uniform1i(U.uTex, 0); gl.uniform2f(U.uTexSize, 1, 1); gl.uniform2f(U.uRes, 1, 1); gl.uniform1f(U.uMaxD, 1); gl.uniform1f(U.uScale, 1);
    gl.viewport(0, 0, 1, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.deleteTexture(t);
    glReady = true;
    return true;
  }
  function sizeCanvas() {
    if (!gl) return;
    var dpr = Math.min(window.devicePixelRatio || 1, isSmall ? 1.5 : 2);
    // pixel budget: the ink is soft-edged and the films are 720p, so a big monitor gains nothing from a full-size buffer
    // (a 2560-wide screen draws ~2.4 MP instead of 3.3 MP; 1080p screens and phones are unchanged)
    dpr = Math.min(dpr, Math.sqrt((isSmall ? 1.3e6 : 2.4e6) / Math.max(1, window.innerWidth * window.innerHeight)));
    var w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault(); gl = null; prog = null; glReady = false; T.forEach(function (x) { x.tex = null; x.lastSrc = null; });
  }, false);
  canvas.addEventListener('webglcontextrestored', function () { initGL(); }, false);

  function upload(x) {
    var src = null;
    if (x.isVideo && x.media.readyState >= 2 && x.media.videoWidth) src = x.media;
    else if (x.isVideo && x.poster && x.poster.complete && x.poster.naturalWidth) src = x.poster;
    else if (!x.isVideo && x.media.complete && x.media.naturalWidth) src = x.media;
    if (!src) return false;
    if (!x.tex) {
      x.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, x.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else gl.bindTexture(gl.TEXTURE_2D, x.tex);
    if (src.tagName === 'IMG' && src === x.lastSrc) return true; // stills upload once
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src); } catch (e) { return !!x.lastSrc; }
    x.texW = src.videoWidth || src.naturalWidth; x.texH = src.videoHeight || src.naturalHeight; x.lastSrc = src;
    return true;
  }
  function easeInOut(v) { return 0.5 * v + 0.25 * (1 - Math.cos(Math.PI * v)); } // half linear: the drop shows early, lands softly
  function easeCam(v) { return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2; } // the window: a camera move, soft at both ends
  function draw(x, now) {
    if (!gl || glSlow || !finishGL()) return false;
    if (!upload(x)) return false;
    var W = canvas.width, H = canvas.height, asp = W / H;
    var ox = x.origin[0], oy = 1 - x.origin[1], maxD = 0;
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (c) {
      var dx = (c[0] - ox) * asp, dy = c[1] - oy; maxD = Math.max(maxD, Math.sqrt(dx * dx + dy * dy));
    });
    gl.viewport(0, 0, W, H);
    gl.uniform1i(U.uTex, 0);
    gl.uniform2f(U.uTexSize, x.texW, x.texH);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform1f(U.uP, easeInOut(x.v));
    gl.uniform2f(U.uOrigin, ox, oy);
    gl.uniform1f(U.uSeed, x.seed);
    gl.uniform1f(U.uScale, 1 + x.settleAmp * (1 - x.v)); // the film settles to 1 as it arrives
    gl.uniform3f(U.uShade, x.shade[0], x.shade[1], x.shade[2]);
    gl.uniform1f(U.uMaxD, maxD);
    gl.uniform1f(U.uTime, now / 1000);
    gl.uniform1f(U.uEdge, x.edge);
    gl.uniform1f(U.uGlow, x.glow);
    gl.uniform2f(U.uPos, x.pos[0], x.pos[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
  function showCanvas(on) {
    if (on === canvasOn) return;
    canvasOn = on;
    canvas.classList.toggle('on', on);
    if (!on && gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  }

  // build the GL context once the page has loaded and gone quiet, or at the reader's first move (or when the first bleed
  // comes near) — never during page load. The shader then compiles in the background and is warmed up long before the
  // first bleed, which is ~2 screens of hero away.
  var glTried = false;
  function boot() { if (glTried || reduced || lowGPU) return; glTried = true; initGL(); }
  function bootWhenQuiet() {
    setTimeout(function () { if (window.requestIdleCallback) requestIdleCallback(boot, { timeout: 1500 }); else boot(); }, 2500);
  }
  if (document.readyState === 'complete') bootWhenQuiet(); else window.addEventListener('load', bootWhenQuiet);
  ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function first() { window.removeEventListener(ev, first); setTimeout(boot, 0); }, { passive: true });
  });

  /* ---------- the window (craft) ---------- */
  // three resting states on one timeline: 0 = previous film, WIN_K = small framed window on black, 1 = full bleed
  function winTarget(y) {
    var e = clamp01((vh * WIN_ENTRY_FROM - (WIN.top - y)) / (vh * (WIN_ENTRY_FROM - WIN_ENTRY_TO)));
    var p = clamp01((y - WIN.top) / (vh * WIN_TRAVEL));
    return e < 1 ? e * WIN_K : WIN_K + p * (1 - WIN_K);
  }
  function winRestFor(t) {
    if (t <= WIN_K) return t / WIN_K >= 0.3 ? WIN_K : 0;
    return (t - WIN_K) / (1 - WIN_K) >= 0.3 ? 1 : WIN_K;
  }
  function isRest(t) { return t === 0 || t === 1 || Math.abs(t - WIN_K) < 1e-6; }
  var copyShown = false, copyTweens = [];
  function setCopy(show) {
    if (show === copyShown) return;
    copyShown = show;
    copyTweens.forEach(function (fn) { fn(show); });
  }
  function css(el, prop, val) { // write a style only when it changes (no per-frame style invalidation)
    var k = '_' + prop; if (el[k] === val) return; el[k] = val; el.style[prop] = val;
  }
  // the window's film, cover-fitted (with its object-position) to the rect r and pushed in by kb about the screen centre.
  // The element is sized to the whole film as a full-screen cover would place it (not to the screen: an object-fit box
  // the shape of the screen would trim the film before it shrinks into the window — on a phone, to a thin strip);
  // the stage clips it to the screen. One transform (origin 0 0) maps that box onto the fit, so at full bleed
  // (r = the screen, kb = 1) it is exactly the plain cover layer, and the hand-over is invisible.
  function fitWin(x, r, kb) {
    var a = (x.media.videoWidth && x.media.videoHeight) ? x.media.videoWidth / x.media.videoHeight : 16 / 9;
    var px = x.pos[0], py = x.pos[1];
    var w0 = Math.max(vw, vh * a), h0 = w0 / a, l0 = (vw - w0) * px, t0 = (vh - h0) * py;            // full-screen cover
    var box = l0.toFixed(1) + ',' + t0.toFixed(1) + ',' + w0.toFixed(1) + ',' + h0.toFixed(1);
    if (box !== x.box) { // only on resize / when the film's shape is known — never per frame
      x.box = box; var st = x.media.style;
      st.left = l0.toFixed(1) + 'px'; st.top = t0.toFixed(1) + 'px'; st.right = 'auto'; st.bottom = 'auto';
      st.width = w0.toFixed(1) + 'px'; st.height = h0.toFixed(1) + 'px';
    }
    var w = Math.max(r.w, r.h * a), h = w / a, l = r.l + (r.w - w) * px, t = r.t + (r.h - h) * py;  // where it should be
    if (kb !== 1) { var cx = vw / 2, cy = vh / 2; l = cx - (cx - l) * kb; t = cy - (cy - t) * kb; w *= kb; }
    var k = w / w0;
    // the element's own origin sits at (l0, t0): move it to (l, t), then scale about it
    var tf = 'translate3d(' + (l - l0).toFixed(2) + 'px,' + (t - t0).toFixed(2) + 'px,0) scale(' + k.toFixed(5) + ')';
    if (tf !== x.tf) { x.tf = tf; x.media.style.transformOrigin = '0 0'; x.media.style.transform = tf; }
  }
  function renderWindow(x, base) {
    // a fresh line every time the window appears (checked every frame: the film may get ready while the window rests)
    if (x.v < 0.001 || base >= WIN_I) x.restart = true;
    else if (x.restart && x.isVideo && x.media.readyState >= 1) { x.restart = false; try { x.media.currentTime = 0; } catch (e) {} }
    var key = x.v + '|' + base + '|' + vw + '|' + vh + '|' + (x.media.videoWidth || 0);
    if (key === x.rkey) return; x.rkey = key;
    var v = x.v, ve = clamp01(v / WIN_K), vp = clamp01((v - WIN_K) / (1 - WIN_K));
    var isBase = base === WIN_I, below = base < WIN_I;
    // black backdrop over the previous film, under the window
    var bo = below && !reduced ? ve : 0;
    css(x.black, 'opacity', bo ? bo.toFixed(3) : '');
    // the window itself: the craft layer, clipped
    if (isBase) {
      if (x.clip !== 'none') { x.clip = 'none'; x.layer.style.clipPath = ''; x.layer.style.webkitClipPath = ''; css(x.layer, 'opacity', ''); }
    } else if (below && ve > 0.001 && !reduced) {
      var r = winRect(), k = 1 - easeCam(vp);
      var top = r.t * k, left = r.l * k, bottom = (vh - r.t - r.h) * k, rad = r.r * k;
      var clip = 'inset(' + top.toFixed(1) + 'px ' + left.toFixed(1) + 'px ' + bottom.toFixed(1) + 'px ' + left.toFixed(1) + 'px round ' + rad.toFixed(1) + 'px)';
      if (clip !== x.clip) { x.clip = clip; x.layer.style.clipPath = clip; x.layer.style.webkitClipPath = clip; }
      css(x.layer, 'opacity', ve.toFixed(3));
    } else if (x.clip !== '') { x.clip = ''; x.layer.style.clipPath = ''; x.layer.style.webkitClipPath = ''; css(x.layer, 'opacity', ''); }
    // the film follows the window: the whole shot in the small frame, growing with it to full bleed (no extra zoom)
    if (!isBase && !reduced) {
      var wr = winRect(), wk = below && ve > 0.001 ? 1 - easeCam(vp) : 0;
      var wl = wr.l * wk, wt = wr.t * wk;
      fitWin(x, { l: wl, t: wt, w: vw - 2 * wl, h: vh - wt - (vh - wr.t - wr.h) * wk }, 1);
      x.kb = -1;
      // the text shade only matters once the copy can rise (window open): the small window shows the film clear
      css(x.shadeEl, 'opacity', below && ve > 0.001 ? (0.35 + 0.65 * easeCam(vp)).toFixed(3) : '');
    } else if (isBase) css(x.shadeEl, 'opacity', '');
    // hairline frame + its caption, both gone by the time the window reaches the edges
    var showWin = below && !reduced ? ve : 0;
    var fo = showWin * (1 - smooth(0.62, 0.96, vp)), co = (below && !reduced ? smooth(0.45, 1, ve) : 0) * (1 - smooth(0, 0.3, vp));
    if (fo > 0.002 || co > 0.002) {
      var rr = winRect(), kk = 1 - easeCam(vp);
      var ft = rr.t * kk, fl = rr.l * kk, fw = vw - 2 * fl, fh = vh - ft - (vh - rr.t - rr.h) * kk;
      x.frame.style.transform = 'translate3d(' + fl.toFixed(1) + 'px,' + ft.toFixed(1) + 'px,0)';
      x.frame.style.width = fw.toFixed(1) + 'px'; x.frame.style.height = fh.toFixed(1) + 'px';
      x.frame.style.borderRadius = (rr.r * kk).toFixed(1) + 'px';
      x.cap.style.transform = 'translate3d(0,' + (ft - 30).toFixed(1) + 'px,0)';
    }
    css(x.frame, 'opacity', fo > 0.002 ? fo.toFixed(3) : '0');
    css(x.cap, 'opacity', co > 0.002 ? co.toFixed(3) : '0');
    // the copy: only on a fully open window; it leaves (quickly, on a clock) if the window closes again
    if (v >= 0.985) setCopy(true); else if (v < 0.9) setCopy(false);
  }

  /* ---------- chapter mark (desktop) ---------- */
  var chapterEl = document.querySelector('.ink-chapter'), chapterTxt = document.querySelector('.ink-chapter-t'), chapterNow = -2;
  function setChapter(i) {
    if (i === chapterNow) return;
    chapterNow = i;
    if (i < 0) { chapterEl.classList.remove('on'); return; }
    chapterTxt.textContent = CH[i].label;
    chapterEl.classList.add('on');
  }

  /* ---------- the loop ---------- */
  var lastY = -1, lastMove = 0, prev = performance.now(), inkDts = [];
  function frame(now) {
    var rawDt = now - prev;
    var dt = Math.min(0.05, rawDt / 1000);
    prev = now;
    if (gl && !glReady) finishGL(); // non-blocking poll while the driver compiles
    var y = window.pageYOffset;
    if (y !== lastY) { lastY = y; lastMove = now; }
    var idle = now - lastMove > 240;
    var i, x;

    for (i = 0; i < T.length; i++) {
      x = T[i];
      var win = x.kind === 'window';
      var t = win ? winTarget(y) : clamp01((vh - (x.top - y)) / (vh * SPAN));
      x.t = t;
      if (!x.stillLoaded && x.top - y < vh * 2.5) loadStill(x);
      if (!x.loaded && x.top - y < vh * 1.3) load(x);
      if (!win && !gl && !glTried && x.top - y < vh * 1.6) boot();
      if (reduced) { x.v = win ? (t >= WIN_K * 0.5 ? 1 : 0) : (t >= 0.5 ? 1 : 0); continue; }
      if (FREEZE) { x.v = t; continue; } // QA only (?freeze): everything sits exactly where the scroll is
      var goal = t;
      if (x.mode === 'settled') {
        // stay on the clean state until the reader clearly scrolls the other way
        var back = win ? 0.06 : 0.1;
        if ((win ? isRest(t) : (t === 0 || t === 1)) || (x.settleTo > x.anchor && t < x.anchor - back) || (x.settleTo < x.anchor && t > x.anchor + back) ||
            (x.settleTo > x.anchor && t > x.settleTo) || (x.settleTo < x.anchor && t < x.settleTo)) x.mode = 'follow'; // scrolled past the rest: follow again
        else goal = x.settleTo;
      }
      if (x.mode === 'follow' && idle && !(win ? isRest(t) : (t === 0 || t === 1))) {
        // ink: a bleed that has barely begun pulls back; past 30% it completes (text stays above it either way)
        // window: the same rule per stage — to the black screen with the small window, or to full bleed
        x.mode = 'settled'; x.settleTo = win ? winRestFor(t) : (t >= 0.3 ? 1 : 0); x.anchor = t; goal = x.settleTo;
      }
      var kf = win ? 5.0 : 7.0; // following trails the finger a touch (the window a little more: a camera, not a cursor)
      var k = x.mode === 'settled' ? (win ? 4.2 : 3.0) : kf; // the window lands a little sooner: its copy waits on it
      x.v += (goal - x.v) * (1 - Math.exp(-dt * k));
      if (Math.abs(goal - x.v) < 0.0006) x.v = goal;
    }

    // one ink bleed at a time. After a fast flick two can overlap: the one the scroll is inside keeps playing,
    // the other jumps to where it was going (it is off-screen or about to be covered anyway). The window is not ink.
    var cur = -1, prg = [], active = -1;
    for (i = 0; i < T.length; i++) {
      if (T[i].kind !== 'ink') continue;
      if (T[i].t > 0 && T[i].t < 1) cur = i;
      if (T[i].v > 0.0005 && T[i].v < 0.9995) prg.push(i);
    }
    if (prg.length > 1) {
      var keep = prg.indexOf(cur) >= 0 ? cur : (T[prg[prg.length - 1]].t >= 1 ? prg[prg.length - 1] : prg[0]);
      prg.forEach(function (j) { if (j !== keep) { T[j].v = T[j].t >= 0.3 ? 1 : 0; T[j].mode = 'follow'; } });
      prg = [keep];
    }
    if (prg.length) active = prg[0];
    var base = -1;
    for (i = 0; i < T.length; i++) if (T[i].v >= 0.9995) base = i;

    // layers + films
    var drawn = false;
    if (active >= 0 && !reduced) drawn = draw(T[active], now);
    // safety net: if the ink can't hold a steady frame rate on this machine (median frame over ~30 fps), the bleeds become
    // plain cross-fades for the rest of the visit — a calm page beats a stuttering effect
    if (drawn && document.visibilityState === 'visible') {
      inkDts.push(rawDt);
      if (inkDts.length > 24) inkDts.shift();
      if (inkDts.length === 24 && inkDts.slice().sort(function (a, b) { return a - b; })[12] > 34) {
        glSlow = true; drawn = false; root.classList.add('lowgpu');
      }
    }
    for (i = 0; i < T.length; i++) {
      x = T[i];
      var on = i === base;
      if (x.on !== on) { x.on = on; x.layer.classList.toggle('on', on); }
      if (x.kind === 'window') {
        renderWindow(x, base);
        setPlaying(x, x.loaded && (on || (base < i && x.v > 0.001)));
      } else {
        // no WebGL (or the film has no frame yet): a plain cross-fade carries the transition
        var fallback = i === active && !drawn;
        x.layer.style.opacity = fallback ? String(easeInOut(x.v)) : '';
        // the last film stays the stage's base while the solid sections scroll over it: pause it once its section is gone
        var past = y > x.top + x.h + vh * 0.1;
        setPlaying(x, x.loaded && !past && (i === base || i === active || (x.t > 0 && x.t < 1)));
      }
      if (on && !lowGPU) {
        // a slow push-in while the section is read (starts at 1, exactly where the transition left the film);
        // light mode keeps the film still: no re-render of a scaled film per frame
        var from = x.kind === 'window' ? x.top + vh * WIN_TRAVEL : x.top - vh * (1 - SPAN);
        var len = x.kind === 'window' ? Math.max(1, x.h - vh * WIN_TRAVEL) : Math.max(1, x.h);
        var kb = 1 + 0.045 * clamp01((y - from) / len);
        if (Math.abs(kb - x.kb) > 0.0004) {
          x.kb = kb;
          if (x.kind === 'window') fitWin(x, { l: 0, t: 0, w: vw, h: vh }, kb);
          else x.media.style.transform = 'scale(' + kb.toFixed(4) + ')';
        }
      }
    }
    showCanvas(drawn);

    // chapter: the last section whose top has passed the middle of the screen (none on the hero)
    var ch = -1;
    for (i = 0; i < CH.length; i++) if (CH[i].top - y <= vh * 0.5) ch = i;
    setChapter(ch);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- text: lines rise in once, on a clock ---------- */
  if (!reduced && window.gsap && window.ScrollTrigger && window.SplitText) {
    gsap.registerPlugin(ScrollTrigger, SplitText);
    ScrollTrigger.config({ ignoreMobileResize: true });
    if (window.__lenis) window.__lenis.on('scroll', ScrollTrigger.update);

    // FINAL: the opening (story → artists) is set up at once, as in A+D. The rest of the site (styles → contact) is
    // set up a moment after load, in idle time — it is several screens down, and building ~150 triggers and line
    // splits up front was most of the page's main-thread time.
    var REST_SEL = '#styles, .solid-sec, #academy';
    function inRest(el) { return !!el.closest(REST_SEL); }
    function onScreen(el) { var r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }
    function pick(sel, rest) { return Array.prototype.filter.call(document.querySelectorAll(sel), function (el) { return inRest(el) === rest; }); }

    function splitIn(el, live) {
      var delay = parseFloat(el.getAttribute('data-delay')) || 0;
      if (live && onScreen(el)) return; // already being read when the rest was set up: leave it as it is
      SplitText.create(el, {
        type: 'lines', mask: 'lines', linesClass: 'ink-ln', autoSplit: true, aria: 'none',
        onSplit: function (self) {
          return gsap.from(self.lines, {
            yPercent: 112, duration: 1.05, ease: 'expo.out', stagger: 0.085, delay: delay,
            scrollTrigger: { trigger: el, start: 'top 93%', once: true }
          });
        }
      });
    }
    function fadeIn(el, live) {
      // a hidden twin (the hours-aware pairs) has no box: trigger on its parent so it is ready when the hours flip
      var trig = el.offsetParent === null && el.parentElement ? el.parentElement : el;
      if (live && onScreen(trig)) return;
      var delay = parseFloat(el.getAttribute('data-delay')) || 0;
      gsap.from(el, { y: 16, opacity: 0, duration: 1, ease: 'power3.out', delay: delay, scrollTrigger: { trigger: trig, start: 'top 95%', once: true } }); // opacity, not visibility: headings stay in the accessibility tree
    }
    // a list that rises word by word (the styles): each item from a little below, one after another, once
    // (explicit end values + clearProps: the styles words have a CSS opacity transition for the hover dim, which a
    //  from() would read mid-way; clearing afterwards hands opacity back to the stylesheet so the hover dim still works)
    function riseGroup(list, live) {
      if (live && onScreen(list)) return;
      var kids = Array.prototype.slice.call(list.children);
      kids.forEach(function (li) { li.style.transitionProperty = 'background-position'; }); // no opacity transition while they rise
      gsap.fromTo(kids, { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 1.05, ease: 'expo.out', stagger: 0.075,
        clearProps: 'opacity,transform', scrollTrigger: { trigger: list, start: 'top 90%', once: true },
        onComplete: function () { kids.forEach(function (li) { li.style.transitionProperty = ''; }); } }); // the hover dim comes back
    }
    // photos settle: the frame fades in while the picture inside eases from 1.06 to its resting size (--settle)
    function settleBatch(selector, opts) {
      var els = Array.prototype.filter.call(document.querySelectorAll(selector), function (el) { return !(el.offsetParent !== null && onScreen(el)); });
      if (!els.length) return;
      gsap.set(els, { opacity: 0, '--settle': 1.06 });
      ScrollTrigger.batch(els, {
        start: opts.start || 'top 94%', once: true,
        onEnter: function (batch) {
          batch.forEach(function (b) { b.classList.add('settling'); });
          gsap.to(batch, { opacity: 1, '--settle': 1, duration: opts.dur || 1.15, ease: 'expo.out', stagger: opts.stagger || 0.07, overwrite: true,
            onComplete: function () { batch.forEach(function (b) { b.classList.remove('settling'); }); } });
        }
      });
    }

    /* the opening, now */
    pick('[data-split]', false).forEach(function (el) { splitIn(el, false); });
    // the craft copy: driven by the window (fully open → in; closing again → out), never by a scroll position
    document.querySelectorAll('[data-win-split]').forEach(function (el) {
      var delay = parseFloat(el.getAttribute('data-delay')) || 0, lines = [];
      function apply(show, instant) {
        gsap.killTweensOf(lines);
        if (instant) { gsap.set(lines, { yPercent: show ? 0 : 112 }); return; }
        if (show) gsap.to(lines, { yPercent: 0, duration: 1.0, ease: 'expo.out', stagger: 0.08, delay: 0.05 + delay * 0.6 });
        else gsap.to(lines, { yPercent: 112, duration: 0.35, ease: 'power2.in', stagger: 0.03 });
      }
      SplitText.create(el, {
        type: 'lines', mask: 'lines', linesClass: 'ink-ln', autoSplit: true, aria: 'none',
        onSplit: function (self) { lines = self.lines; apply(copyShown, true); }
      });
      copyTweens.push(function (show) { apply(show, false); });
    });
    pick('[data-fade]', false).forEach(function (el) { fadeIn(el, false); });
    document.querySelectorAll('.ink-step').forEach(function (li) {
      gsap.timeline({ scrollTrigger: { trigger: li, start: 'top 95%', once: true } })
        .from(li.querySelector('.step-rule'), { scaleX: 0, duration: 1.15, ease: 'expo.out' })
        .from(li.querySelectorAll('.step-n, strong, :scope > span:last-child'), { y: 14, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07 }, 0.12);
    });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var end = parseInt(el.getAttribute('data-count'), 10), pad = el.getAttribute('data-count').length, o = { v: 0 };
      function show() { var s = String(Math.round(o.v)); while (s.length < pad) s = '0' + s; el.textContent = s; }
      show();
      gsap.to(o, { v: end, duration: 1.8, ease: 'power2.out', onUpdate: show, scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    });

    /* the rest of the site, a moment after load (or at once if the reader is already heading there) */
    var restDone = false;
    function setupRest() {
      if (restDone) return;
      restDone = true;
      pick('[data-split]', true).forEach(function (el) { splitIn(el, true); });
      pick('[data-fade]', true).forEach(function (el) { fadeIn(el, true); });
      document.querySelectorAll('[data-rise-group]').forEach(function (list) { riseGroup(list, true); });
      settleBatch('.gitem', { stagger: 0.06 });
      settleBatch('.sframe', { stagger: 0.09, start: 'top 98%' });
      ScrollTrigger.refresh(); measure();
    }
    var stylesEl = document.getElementById('styles');
    function nearRest() { return !!stylesEl && stylesEl.getBoundingClientRect().top < window.innerHeight * 3; }
    window.addEventListener('scroll', function onNear() {
      if (restDone) { window.removeEventListener('scroll', onNear); return; }
      if (nearRest()) { window.removeEventListener('scroll', onNear); setupRest(); }
    }, { passive: true });
    function idle(fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 700); }
    if (document.readyState === 'complete') idle(setupRest);
    else window.addEventListener('load', function () { idle(setupRest); }, { once: true });
    if (nearRest()) setupRest(); // opened deep in the page (a #link): set up right away

    // the gallery changes height when it is filtered or opened ("לכל 40 העבודות"): anything already on screen
    // just appears (no animation on a re-filter), and every trigger and chapter is measured again
    function galleryChanged() {
      setTimeout(function () {
        setupRest();
        document.querySelectorAll('.gitem').forEach(function (it) {
          if (it.classList.contains('hide')) return;
          var r = it.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) { gsap.killTweensOf(it); gsap.set(it, { opacity: 1, '--settle': 1 }); it.classList.remove('settling'); }
        });
        ScrollTrigger.refresh(); measure();
      }, 0);
    }
    document.querySelectorAll('.gf, .gallery-more').forEach(function (b) { b.addEventListener('click', galleryChanged); });

    // re-measure every trigger whenever the layout moves under them. The web fonts land after the load event
    // (document.fonts.ready has usually resolved before they even start, so it is not enough on its own) and set
    // the Hebrew text tighter: sections shrink, and a trigger measured before that waits on screen for a point the
    // page never reaches. Every section's height is watched against the height it had when last measured.
    var remT = 0;
    function remeasure() { clearTimeout(remT); remT = setTimeout(function () { ScrollTrigger.refresh(); measure(); }, 120); }
    window.addEventListener('load', remeasure);
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(remeasure);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remeasure);
    }
    if (window.ResizeObserver) {
      var heights = new Map();
      var ro = new ResizeObserver(function (entries) {
        var moved = false;
        entries.forEach(function (e) {
          var h = Math.round(e.contentRect.height);
          if (heights.get(e.target) !== h) { heights.set(e.target, h); moved = true; }
        });
        if (moved) remeasure();
      });
      document.querySelectorAll('main > section, footer').forEach(function (sec) {
        heights.set(sec, Math.round(sec.getBoundingClientRect().height)); // the height the triggers are being built on
        ro.observe(sec);
      });
    }
  }

  window.__ink = { T: T, CH: CH, measure: measure, gl: function () { return !!gl; }, win: WIN, WIN_K: WIN_K, WIN_TRAVEL: WIN_TRAVEL, WIN_ENTRY_FROM: WIN_ENTRY_FROM, WIN_ENTRY_TO: WIN_ENTRY_TO, copyShown: function () { return copyShown; } };
})();
