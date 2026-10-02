/* ============ LIZ VAMPIRE TATTOO — cinematic scroll ============ */
(function () {
  'use strict';

  /* ---------- analytics + Google Ads conversion IDs ---------- */
  var GA_ID = 'G-M32DX04HDN'; // GA4 Measurement ID
  var AW_ID = 'AW-18472197461'; // Google Ads conversion ID (new account 257-714-8713)
  // maps a site event -> the Google Ads conversion Label to fire.
  // call_click is the primary conversion; add more as you create conversion actions.
  var AW_CONVERSIONS = {
    call_click: 'JLzeCKmD4IMdENW6nehE', // "Website call click" conversion
    whatsapp_click: 'DzqeCJjpyYsdENW6nehE', // "WhatsApp click" conversion (primary)
    book_cta:  ''                      // optional second action, leave '' to skip
  };
  var isSmall = window.matchMedia('(max-width:820px)').matches;        // layout choices only
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || // disables all scroll 3D
    document.documentElement.classList.contains('a11y-still'); // accessibility menu "stop animations" (js/common.js)

  /* ---------- conversion tracking ---------- */
  window.__events = [];
  function track(name, params) {
    window.__events.push({ name: name, params: params || {} });
    if (window.gtag) {
      window.gtag('event', name, params || {}); // GA4 event
      var label = AW_CONVERSIONS[name];
      if (AW_ID && label) window.gtag('event', 'conversion', { send_to: AW_ID + '/' + label }); // Google Ads conversion
    }
  }
  if (GA_ID || AW_ID) {
    var gs = document.createElement('script');
    gs.async = true;
    gs.src = 'https://www.googletagmanager.com/gtag/js?id=' + (GA_ID || AW_ID);
    document.head.appendChild(gs);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    if (GA_ID) window.gtag('config', GA_ID); // Google Analytics 4
    if (AW_ID) window.gtag('config', AW_ID); // Google Ads
  }

  /* ---------- Lenis smooth scroll (desktop only; touch scroll is native) ---------- */
  var lenis = null;
  if (!isSmall && !reducedMotion && window.Lenis) {
    lenis = new Lenis({ duration: 1.25, smoothWheel: true });
    window.__lenis = lenis;
  }

  var state = {};
  window.__scrubState = state;

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  // Scroll progress of a pinned section. Every tracked section is measured once at the start of a frame, before any
  // updater writes styles, so the frame never interleaves layout reads with writes.
  var tracked = [], progressNow = [];
  function measureProgress(section) {
    var rect = section.getBoundingClientRect();
    var total = section.offsetHeight - window.innerHeight;
    return total > 0 ? clamp01(-rect.top / total) : 0;
  }
  function sectionProgress(section) {
    var i = tracked.indexOf(section);
    if (i < 0) { tracked.push(section); return measureProgress(section); }
    return progressNow[i] === undefined ? measureProgress(section) : progressNow[i];
  }

  /* staged copy: fade in/out inside [data-from, data-to] of section progress */
  function updateStages(section, p) {
    var stages = section.querySelectorAll('.stage');
    for (var i = 0; i < stages.length; i++) {
      var el = stages[i];
      var from = parseFloat(el.getAttribute('data-from'));
      var to = parseFloat(el.getAttribute('data-to'));
      var span = to - from;
      var fadeZone = Math.min(0.12, span / 3);
      var o = 0;
      if (p >= from && p <= to) {
        var inP = from === 0 ? 1 : (p - from) / fadeZone;
        var outP = to >= 1 ? 1 : (to - p) / fadeZone; // to=1 → persists to section end
        o = Math.max(0, Math.min(1, Math.min(inP, outP)));
      }
      el.style.opacity = o;
      if (el.classList.contains('stage-line')) {
        el.style.transform = 'translate(50%,' + (-40 + 10 * o) + '%)';
      } else if (el.classList.contains('hero-sub')) {
        el.style.transform = (isSmall ? '' : 'translateX(50%) ') + 'translateY(' + (12 * (1 - o)) + 'px)'; // phones: in normal flow under the title
      } else {
        el.style.transform = 'translateY(' + (24 * (1 - o)) + 'px)';
      }
      el.style.visibility = o === 0 ? 'hidden' : 'visible';
    }
  }

  var updaters = [];


  /* ---------- CRAFT — bitmap-backed scrub ---------- */
  var manifest = window.FRAMES || {};

  function buildScrub(section) {
    var key = section.getAttribute('data-scrub');
    // small screens get the lighter frame set when one exists
    var cfg = (isSmall && manifest[key + '_m']) || manifest[key];
    var canvas = section.querySelector('.scrub-canvas');
    if (!cfg || !canvas || reducedMotion) return;
    var ctx = canvas.getContext('2d');
    var frames = new Array(cfg.count); // ImageBitmap | HTMLImageElement
    var current = -1;

    function src(i) {
      var n = String(i + 1);
      while (n.length < cfg.pad) n = '0' + n;
      return cfg.path + n + '.' + cfg.ext;
    }

    // frames are fetched + decoded OFF the scroll path (createImageBitmap),
    // and only once the section approaches the viewport
    var started = false;
    function preload() {
      if (started) return;
      started = true;
      var next = 0, inflight = 0, CONC = 8;
      function pump() {
        while (inflight < CONC && next < cfg.count) {
          (function (i) {
            inflight++; next++;
            var done = function (bmp) {
              frames[i] = bmp || undefined;
              inflight--;
              if (i === current || (i === 0 && current === -1)) { current = -1; wake(); }
              pump();
            };
            if (window.createImageBitmap) {
              fetch(src(i)).then(function (r) { return r.blob(); })
                .then(function (b) { return createImageBitmap(b); })
                .then(done).catch(function () { done(null); });
            } else {
              var im = new Image();
              im.onload = function () { done(im); };
              im.onerror = function () { done(null); };
              im.src = src(i);
            }
          })(next);
        }
      }
      pump();
    }
    new IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) { preload(); obs.disconnect(); }
    }, { rootMargin: '150% 0%' }).observe(section);

    function nearestLoaded(i) {
      for (var k = i; k >= 0; k--) if (frames[k]) return frames[k];
      for (var k2 = i; k2 < cfg.count; k2++) if (frames[k2]) return frames[k2];
      return null;
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      current = -1;
    }
    window.addEventListener('resize', resize);
    resize();

    function draw(img) {
      var iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
      var cw = canvas.width, ch = canvas.height;
      var s = Math.max(cw / iw, ch / ih);
      var w = iw * s, h = ih * s;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    }

    updaters.push(function () {
      var p = sectionProgress(section);
      var frame = Math.round(p * (cfg.count - 1));
      if (frame !== current) {
        var img = nearestLoaded(frame);
        if (img) { draw(img); current = frame; state[key] = { frame: frame, progress: p }; }
      }
      updateStages(section, p);
    });
  }

  document.querySelectorAll('.scrub-section').forEach(buildScrub);

  /* ---------- HERO — canvas ink mask zoom ----------
     Stencil is redrawn from vectors every frame (black rect, letters punched
     out with destination-out) so it is pixel-identical scrolling down and
     back up. Never swap this for a CSS-scaled SVG mask: Chromium composites
     those from a cached raster and corrupts them on reverse scroll. */
  (function buildHeroMask() {
    var section = document.getElementById('hero');
    if (reducedMotion) return; // static fallback (solid title) handled in CSS
    var canvas = section.querySelector('.mask-canvas');
    var ctx = canvas.getContext('2d');
    var MAX_SCALE = 34;
    var fontsReady = false;
    var lastScale = -1, lastFade = -1;

    // the font stylesheet loads without blocking paint: draw once Metamorphous is in, redraw once
    // if a fallback face had to be used first, and never leave the hero blank past 3s
    var haveFace = false;
    function checkTitleFont() {
      if (haveFace) return;
      document.fonts.load('10px "Metamorphous"').then(function (f) {
        if (f && f.length && !haveFace) { haveFace = true; fontsReady = true; domLayout = null; lastScale = -1; wake(); }
      }).catch(function () {});
    }
    checkTitleFont();
    var fontCss = document.getElementById('fontcss'); // async stylesheet: the face may not be declared yet
    if (fontCss) fontCss.addEventListener('load', checkTitleFont);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', checkTitleFont);
    setTimeout(function () { if (!fontsReady) { fontsReady = true; lastScale = -1; wake(); } }, 3000);
    var blanked = false;
    var domLayout = null;
    var moving = false; // phones: true while the title is zooming (lower-resolution mask)

    function resize() {
      // Supersample the mask: the letters are punched into a raster canvas, so on
      // a DPR=1 display (most desktop monitors at 100%) a 1:1 buffer makes the big
      // letterforms alias badly. Render at min 2x, up to 3x on hi-DPI, for crisp edges.
      var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
      if (isSmall && moving) dpr = Math.min(dpr, 2); // in motion nobody sees the third pixel; the frame gets much cheaper
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      domLayout = null; // phone title layout is re-read from the DOM
      lastScale = -1; // force redraw
    }
    window.addEventListener('resize', resize);
    resize();

    // Metamorphous runs wider than a slab face, so size the title by measuring
    // the actual text to fill a target width fraction (with side margins) rather
    // than a fixed coefficient — keeps "LIZ VAMPIRE" from clipping at any width.
    function fitSize(text, tracking, targetW, cap) {
      var base = 200;
      ctx.font = base + 'px "Metamorphous"';
      try { ctx.letterSpacing = (base * tracking) + 'px'; } catch (e) {}
      var measured = ctx.measureText(text).width;
      try { ctx.letterSpacing = '0px'; } catch (e) {}
      return Math.min(base * targetW / measured, cap);
    }
    // stencil layout per orientation: [text, fontSize, baselineY, tracking]
    // Phones lay the title out in the DOM (css/main.css .hero-group): three invisible lines that reserve the space,
    // with the H1 in normal flow under them. Read their boxes once (not per frame) and punch the letters exactly there,
    // so the Hebrew line can never overlap the title at any screen size.
    var domLines = isSmall ? section.querySelectorAll('.hero-title-m span') : [];
    function readDomLayout(w, h) {
      if (domLines.length !== 3 || !domLines[0].offsetHeight) return null;
      var cr = canvas.getBoundingClientRect();
      if (!cr.width) return null;
      var k = w / cr.width, lines = [], origin = null;
      for (var i = 0; i < 3; i++) {
        var r = domLines[i].getBoundingClientRect();
        var size = parseFloat(getComputedStyle(domLines[i]).fontSize);
        ctx.font = size + 'px "Metamorphous"';
        var m = ctx.measureText('H');
        var asc = m.fontBoundingBoxAscent > 0 ? m.fontBoundingBoxAscent : size * 0.965;
        var desc = m.fontBoundingBoxDescent > 0 ? m.fontBoundingBoxDescent : size * 0.285;
        var baseline = (r.top - cr.top) + (r.height - (asc + desc)) / 2 + asc; // CSS line box: half-leading + ascent
        lines.push([domLines[i].textContent, size * k, baseline * k / h, i === 2 ? 0.25 : 0]);
        if (i === 1) origin = { x: 0.505, y: (baseline - size * 0.36) * k / h }; // inside VAMPIRE's letter counters
      }
      return { lines: lines, origin: origin };
    }
    function stencilLines(w, h) {
      if (h > w) { // portrait: three stacked lines
        if (!domLayout) domLayout = readDomLayout(w, h) || { lines: null, origin: null };
        if (domLayout.lines) return domLayout.lines;
        var big = fitSize('VAMPIRE', 0, w * 0.9, h * 0.17);
        return [
          ['LIZ', big, 0.35, 0],
          ['VAMPIRE', big, 0.48, 0],
          ['TATTOO', fitSize('TATTOO', 0.25, w * 0.72, big * 0.58), 0.585, 0.25]
        ];
      }
      // landscape: two lines. The title is measured to fill a fraction of the
      // width — but on wide/short laptops (aspect ≫ 16:9) filling 88% makes the
      // letters grow too tall and crowd the navbar. Ease the width fraction down
      // as the viewport gets wider-and-shorter so the title keeps clear margins
      // top and bottom on every aspect ratio. Tall desktops stay at ~0.88.
      var aspect = w / h;
      var wfrac = 0.88 - clamp01((aspect - 1.75) / 0.9) * 0.20; // 16:9→~.88, 2.1:1→~.80
      var bigL = fitSize('LIZ VAMPIRE', 0, w * wfrac, h * 0.42);
      return [
        ['LIZ VAMPIRE', bigL, 0.45, 0],
        ['TATTOO', fitSize('TATTOO', 0.3, w * wfrac * 0.68, bigL * 0.6), 0.665, 0.3]
      ];
    }
    function zoomOrigin(w, h) {
      // inside the letter counters of VAMPIRE on each layout
      if (h > w && domLayout && domLayout.origin) return domLayout.origin;
      return h > w ? { x: 0.505, y: 0.45 } : { x: 0.52, y: 0.41 };
    }

    function drawStencil(scale) {
      var w = canvas.width, h = canvas.height;
      var lines = stencilLines(w, h);
      var o = zoomOrigin(w, h);
      var cx = w * o.x, cy = h * o.y;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#060606';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      // punch the letters out of the black overlay
      ctx.globalCompositeOperation = 'destination-out';
      lines.forEach(function (l) {
        ctx.font = l[1] + 'px "Metamorphous"';
        try { ctx.letterSpacing = (l[1] * l[3]) + 'px'; } catch (e) {}
        ctx.fillText(l[0], w / 2, h * l[2]);
      });
      // hairline bone rim so the title stays crisp over dark video moments
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(236,231,221,0.35)';
      ctx.lineWidth = Math.max(1, 1.2 / scale);
      lines.forEach(function (l) {
        ctx.font = l[1] + 'px "Metamorphous"';
        try { ctx.letterSpacing = (l[1] * l[3]) + 'px'; } catch (e) {}
        ctx.strokeText(l[0], w / 2, h * l[2]);
      });
      try { ctx.letterSpacing = '0px'; } catch (e) {}
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }

    updaters.push(function () {
      var p = sectionProgress(section);
      // gentler start, committed finish
      var pz = clamp01(p / 0.82);
      var scale = 1 + Math.pow(pz, isSmall ? 2 : 2.4) * (MAX_SCALE - 1); // phones: short travel, so the zoom answers the first swipe
      // stencil fully dissolved before the pin releases
      var fade = p < 0.70 ? 1 : clamp01(1 - (p - 0.70) / 0.18);
      if (isSmall && (scale > 1) !== moving) { moving = scale > 1; resize(); }
      if (!fontsReady && !blanked) { // until the title face is in: solid black, not the bare film
        blanked = true;
        ctx.fillStyle = '#060606';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (fontsReady && (scale !== lastScale || fade !== lastFade)) {
        if (fade === 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else if (scale !== lastScale || lastFade === 0) {
          drawStencil(scale);
        }
        canvas.style.opacity = fade.toFixed(3);
        lastScale = scale; lastFade = fade;
        hideLoader();
      }
      state.hero = { progress: p, scale: scale, maskOpacity: fade };
      updateStages(section, p);
    });
  })();

  /* ---------- STUDIO — film-strip horizontal pan ---------- */
  (function buildStudioStrip() {
    var section = document.getElementById('studio');
    if (!section || isSmall || reducedMotion) return; // touch gets a swipe carousel instead
    var track = section.querySelector('.strip-track');
    var maxShift = 0;
    function measure() {
      maxShift = Math.max(0, track.scrollWidth - track.parentElement.clientWidth);
    }
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    measure();
    updaters.push(function () {
      var p = sectionProgress(section);
      var x = p * maxShift; // RTL: +x reveals the overflow on the left
      track.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
      state.studio = { progress: p, x: x, max: maxShift };
    });
  })();

  /* ---------- raf loop ---------- */
  // Updaters run when the page actually moved (or was resized), for a short while after something asked for a
  // redraw (wake()), and a few times a second as a safety net — not 60 times a second while nothing changes.
  var lastY = -1, lastW = 0, lastH = 0, awake = 30, tick = 0;
  function wake() { awake = 30; }
  window.addEventListener('resize', wake);
  window.addEventListener('load', wake);
  function raf(time) {
    if (lenis) lenis.raf(time);
    var y = window.pageYOffset, w = window.innerWidth, h = window.innerHeight;
    if (y !== lastY || w !== lastW || h !== lastH || awake > 0 || (tick++ % 12) === 0) {
      lastY = y; lastW = w; lastH = h;
      if (awake > 0) awake--;
      for (var j = 0; j < tracked.length; j++) progressNow[j] = measureProgress(tracked[j]);
      for (var i = 0; i < updaters.length; i++) updaters[i]();
    }
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  /* ---------- loader — lifts on the first stencil frame (not the film), hard cap 1s ---------- */
  var loaderHidden = false;
  function hideLoader() {
    if (loaderHidden) return;
    loaderHidden = true;
    document.getElementById('loader').classList.add('done');
    window.__heroReady = true;
  }
  if (reducedMotion) hideLoader(); // static layout: nothing to wait for
  setTimeout(hideLoader, 1000);    // hard cap

  /* ---------- below-the-fold films: no download until scrolled near ---------- */
  var lazyVids = document.querySelectorAll('video[data-src]');
  if (lazyVids.length) {
    var vio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (!e.isIntersecting) return; // display:none (e.g. craft fallback behind the frame scrub) never intersects
        vio.unobserve(v);
        v.src = v.getAttribute('data-src');
        v.removeAttribute('data-src');
        if (reducedMotion) { v.preload = 'metadata'; return; } // still mode: first frame only (js/common.js keeps it paused)
        v.preload = 'auto';
        var pr = v.play();
        if (pr && pr.catch) pr.catch(function () {});
      });
    }, { rootMargin: '60% 0px' }); // start ~half a screen ahead; the shorter phone hero must not pull the story film into page load
    lazyVids.forEach(function (v) { vio.observe(v); });
  }

  /* ---------- reveal on scroll ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  // phones: start a fifth of a screen early, so a flick never outruns the fade
  }, isSmall ? { rootMargin: '0px 0px 20% 0px', threshold: 0 } : { threshold: 0.18 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ---------- anchor links through Lenis ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(t, { offset: 0 }); else t.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
      // move keyboard/screen-reader focus with the scroll (skip link, nav links)
      if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
      t.focus({ preventScroll: true });
    });
  });

  /* keep Tab inside an open dialog (mobile menu, lightbox) */
  function trapTab(e, box) {
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(box.querySelectorAll('a[href],button'), function (el) {
      return !el.hidden && el.offsetParent !== null;
    });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- mobile menu ---------- */
  var menuBtn = document.getElementById('menuBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  menuBtn.addEventListener('click', function () {
    mobileMenu.hidden = false;
    requestAnimationFrame(function () { mobileMenu.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    menuBtn.setAttribute('aria-expanded', 'true');
    document.getElementById('menuClose').focus();
    track('menu_open');
  });
  function closeMenu(returnFocus) {
    mobileMenu.classList.remove('open');
    document.body.style.overflow = '';
    menuBtn.setAttribute('aria-expanded', 'false');
    setTimeout(function () { mobileMenu.hidden = true; }, 350);
    if (returnFocus === true) menuBtn.focus();
  }
  document.getElementById('menuClose').addEventListener('click', function () { closeMenu(true); });
  mobileMenu.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu(true);
    else trapTab(e, mobileMenu);
  });
  // capture phase: restore page scrolling BEFORE the shared anchor handler scrolls
  mobileMenu.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') closeMenu();
  }, true);

  /* ---------- gallery filter ---------- */
  var filterBtns = document.querySelectorAll('.gf');
  var items = document.querySelectorAll('.gitem');

  /* phones: show the first 12 works, the rest behind one button (keeps the page short) */
  var galleryGrid = document.querySelector('.gallery-grid');
  var moreBtn = document.querySelector('.gallery-more');
  function expandGallery() {
    galleryGrid.classList.remove('collapsed');
    if (moreBtn) moreBtn.hidden = true;
  }
  if (isSmall && moreBtn && items.length > 12) {
    galleryGrid.classList.add('collapsed');
    moreBtn.hidden = false;
    moreBtn.addEventListener('click', function () {
      expandGallery();
      var next = items[12].querySelector('.gitem-open');
      if (next) next.focus({ preventScroll: true });
      track('gallery_more');
    });
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      expandGallery();
      filterBtns.forEach(function (b) { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      var f = btn.getAttribute('data-filter');
      items.forEach(function (it) {
        it.classList.toggle('hide', f !== 'all' && it.getAttribute('data-style') !== f);
      });
    });
  });

  /* ---------- styles list: display-only showcase (hover = CSS ink sweep) ---------- */

  /* ---------- lightbox with navigation ---------- */
  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lbImg');
  var lbCap = document.getElementById('lbCap');
  var lbPrev = document.getElementById('lbPrev');
  var lbNext = document.getElementById('lbNext');
  var lbList = [];   // the visible (filtered) items at open time
  var lbIndex = 0;

  function lbShow(i) {
    lbIndex = (i + lbList.length) % lbList.length;
    var it = lbList[lbIndex];
    var img = it.querySelector('img');
    lbImg.src = img.src;
    lbImg.alt = img.alt;
    lbCap.textContent = it.querySelector('figcaption').textContent;
  }
  var lbOpener = null;
  items.forEach(function (it) {
    // keyboard + screen readers: a real (invisible) button over each photo opens the lightbox
    var openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'gitem-open';
    openBtn.setAttribute('aria-label', 'הגדלת התמונה: ' + it.querySelector('figcaption').textContent);
    it.appendChild(openBtn);
    it.addEventListener('click', function () {
      lbList = Array.prototype.filter.call(items, function (g) { return !g.classList.contains('hide'); });
      lbShow(lbList.indexOf(it));
      var solo = lbList.length < 2;
      lbPrev.hidden = solo;
      lbNext.hidden = solo;
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
      if (lenis) lenis.stop();
      lbOpener = openBtn;
      document.getElementById('lbClose').focus();
    });
  });
  function closeLb() {
    lb.hidden = true;
    document.body.style.overflow = '';
    if (lenis) lenis.start();
    if (lbOpener) lbOpener.focus();
  }
  document.getElementById('lbClose').addEventListener('click', closeLb);
  lbPrev.addEventListener('click', function () { lbShow(lbIndex - 1); });
  lbNext.addEventListener('click', function () { lbShow(lbIndex + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    trapTab(e, lb);
    if (e.key === 'Escape') closeLb();
    else if (e.key === 'ArrowLeft') lbShow(lbIndex + 1);  // RTL: left = forward
    else if (e.key === 'ArrowRight') lbShow(lbIndex - 1);
  });
  var lbWheelAt = 0;
  lb.addEventListener('wheel', function (e) {
    e.preventDefault();
    var now = Date.now();
    if (now - lbWheelAt < 350) return;
    lbWheelAt = now;
    lbShow(lbIndex + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });
  var lbTouchX = null;
  lb.addEventListener('touchstart', function (e) { lbTouchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    if (lbTouchX === null) return;
    var dx = e.changedTouches[0].clientX - lbTouchX;
    lbTouchX = null;
    if (Math.abs(dx) > 50) lbShow(lbIndex + (dx > 0 ? 1 : -1)); // swipe follows finger, RTL-friendly
  }, { passive: true });

  /* ---------- conversion event hooks (WhatsApp primary, calls secondary) ---------- */
  document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
    a.addEventListener('click', function () { track('call_click'); });
  });
  document.querySelectorAll('a[href*="wa.me/972542264377"]').forEach(function (a) {
    a.addEventListener('click', function () { track('whatsapp_click'); });
  });
  document.querySelectorAll('#academy a, .proof-link').forEach(function (a) {
    a.addEventListener('click', function () { track(a.classList.contains('proof-link') ? 'reviews_click' : 'academy_click'); });
  });
  document.querySelectorAll('a[href="#booking"]').forEach(function (a) {
    a.addEventListener('click', function () { track('book_cta'); });
  });
})();
