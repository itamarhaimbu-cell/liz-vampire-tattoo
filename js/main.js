/* ============ LIZ VAMPIRE TATTOO — cinematic scroll ============ */
(function () {
  'use strict';

  var GA_ID = ''; // paste the GA4 Measurement ID ('G-XXXXXXXXXX') to enable Google Analytics
  var isSmall = window.matchMedia('(max-width:820px)').matches;        // layout choices only
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // disables all scroll 3D

  /* ---------- conversion tracking ---------- */
  window.__events = [];
  function track(name, params) {
    window.__events.push({ name: name, params: params || {} });
    if (window.gtag) window.gtag('event', name, params || {});
  }
  if (GA_ID) {
    var gs = document.createElement('script');
    gs.async = true;
    gs.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(gs);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
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

  function sectionProgress(section) {
    var rect = section.getBoundingClientRect();
    var total = section.offsetHeight - window.innerHeight;
    return total > 0 ? clamp01(-rect.top / total) : 0;
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
        el.style.transform = 'translateX(50%) translateY(' + (12 * (1 - o)) + 'px)';
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
              if (i === current || (i === 0 && current === -1)) { current = -1; }
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
    var video = section.querySelector('.hero-video');
    if (isSmall) video.src = 'assets/video/hero_sd.mp4';
    if (reducedMotion) return; // static fallback (solid title) handled in CSS
    var canvas = section.querySelector('.mask-canvas');
    var ctx = canvas.getContext('2d');
    var MAX_SCALE = 34;
    var fontsReady = false;
    var lastScale = -1, lastFade = -1;

    document.fonts.load('10px "Metamorphous"').then(function () {
      return document.fonts.ready;
    }).then(function () { fontsReady = true; lastScale = -1; });

    function resize() {
      // Supersample the mask: the letters are punched into a raster canvas, so on
      // a DPR=1 display (most desktop monitors at 100%) a 1:1 buffer makes the big
      // letterforms alias badly. Render at min 2x, up to 3x on hi-DPI, for crisp edges.
      var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
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
    function stencilLines(w, h) {
      if (h > w) { // portrait: three stacked lines
        var big = fitSize('VAMPIRE', 0, w * 0.9, h * 0.17);
        return [
          ['LIZ', big, 0.35, 0],
          ['VAMPIRE', big, 0.48, 0],
          ['TATTOO', fitSize('TATTOO', 0.25, w * 0.72, big * 0.58), 0.585, 0.25]
        ];
      }
      var bigL = fitSize('LIZ VAMPIRE', 0, w * 0.88, h * 0.46);
      return [
        ['LIZ VAMPIRE', bigL, 0.44, 0],
        ['TATTOO', fitSize('TATTOO', 0.3, w * 0.6, bigL * 0.6), 0.66, 0.3]
      ];
    }
    function zoomOrigin(w, h) {
      // inside the letter counters of VAMPIRE on each layout
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
      var scale = 1 + Math.pow(pz, 2.4) * (MAX_SCALE - 1);
      // stencil fully dissolved before the pin releases
      var fade = p < 0.70 ? 1 : clamp01(1 - (p - 0.70) / 0.18);
      if (fontsReady && (scale !== lastScale || fade !== lastFade)) {
        if (fade === 0) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        } else if (scale !== lastScale || lastFade === 0) {
          drawStencil(scale);
        }
        canvas.style.opacity = fade.toFixed(3);
        lastScale = scale; lastFade = fade;
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
  function raf(time) {
    if (lenis) lenis.raf(time);
    for (var i = 0; i < updaters.length; i++) updaters[i]();
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  /* ---------- loader — waits for hero video ---------- */
  var loaderHidden = false;
  function hideLoader() {
    if (loaderHidden) return;
    loaderHidden = true;
    document.getElementById('loader').classList.add('done');
    window.__heroReady = true;
  }
  var heroVideo = document.querySelector('#hero .hero-video');
  if (heroVideo) {
    if (heroVideo.readyState >= 3) hideLoader();
    else heroVideo.addEventListener('canplay', hideLoader, { once: true });
  }
  setTimeout(hideLoader, 2500); // hard cap

  /* ---------- reveal on scroll ---------- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.18 });
  document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

  /* ---------- anchor links through Lenis ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(t, { offset: 0 }); else t.scrollIntoView({ behavior: 'smooth' });
    });
  });

  /* ---------- mobile menu ---------- */
  var menuBtn = document.getElementById('menuBtn');
  var mobileMenu = document.getElementById('mobileMenu');
  menuBtn.addEventListener('click', function () {
    mobileMenu.hidden = false;
    requestAnimationFrame(function () { mobileMenu.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    track('menu_open');
  });
  function closeMenu() {
    mobileMenu.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () { mobileMenu.hidden = true; }, 350);
  }
  document.getElementById('menuClose').addEventListener('click', closeMenu);
  // capture phase: restore page scrolling BEFORE the shared anchor handler scrolls
  mobileMenu.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') closeMenu();
  }, true);

  /* ---------- gallery filter ---------- */
  var filterBtns = document.querySelectorAll('.gf');
  var items = document.querySelectorAll('.gitem');
  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      filterBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
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
  items.forEach(function (it) {
    it.addEventListener('click', function () {
      lbList = Array.prototype.filter.call(items, function (g) { return !g.classList.contains('hide'); });
      lbShow(lbList.indexOf(it));
      var solo = lbList.length < 2;
      lbPrev.hidden = solo;
      lbNext.hidden = solo;
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
      if (lenis) lenis.stop();
    });
  });
  function closeLb() {
    lb.hidden = true;
    document.body.style.overflow = '';
    if (lenis) lenis.start();
  }
  document.getElementById('lbClose').addEventListener('click', closeLb);
  lbPrev.addEventListener('click', function () { lbShow(lbIndex - 1); });
  lbNext.addEventListener('click', function () { lbShow(lbIndex + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
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

  /* ---------- conversion event hooks (call-only) ---------- */
  document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
    a.addEventListener('click', function () { track('call_click'); });
  });
  document.querySelectorAll('#academy a, .proof-link').forEach(function (a) {
    a.addEventListener('click', function () { track(a.classList.contains('proof-link') ? 'reviews_click' : 'academy_click'); });
  });
  document.querySelectorAll('a[href="#booking"]').forEach(function (a) {
    a.addEventListener('click', function () { track('book_cta'); });
  });
})();
