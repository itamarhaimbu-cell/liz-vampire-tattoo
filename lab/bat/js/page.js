/* ============ LAB · CHROME BAT — page behaviour ============
   Small and synchronous-free: the page is complete without it. It marks the chapter that has arrived (the craft
   chapter draws its line and shows the work once), runs the menu, and only after the first paint asks for the 3D emblem. */
(function () {
  'use strict';
  var root = document.documentElement;
  var chapters = [].slice.call(document.querySelectorAll('.chapter'));
  var still = root.classList.contains('a11y-still') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- chapters: "arrived" is a one-way switch, set as soon as most of the chapter is on screen ---------- */
  function arrive(ch) { ch.classList.add('is-in'); }
  if (still || !('IntersectionObserver' in window)) chapters.forEach(arrive);
  else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { arrive(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.5 });
    chapters.forEach(function (ch) { io.observe(ch); });
  }

  /* ---------- the corner logo appears once the hero (where the emblem is the logo) is left ---------- */
  var atHero = true;
  function onScroll() {
    var now = (window.pageYOffset || 0) < window.innerHeight * 0.5;
    if (now !== atHero) { atHero = now; root.classList.toggle('at-hero', now); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- menu ---------- */
  var btn = document.getElementById('menuBtn'), menu = document.getElementById('mobileMenu'), close = document.getElementById('menuClose');
  function setMenu(open) {
    menu.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    (open ? close : btn).focus();
  }
  if (btn && menu && close) {
    btn.addEventListener('click', function () { setMenu(true); });
    close.addEventListener('click', function () { setMenu(false); });
    menu.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  /* ---------- the 3D emblem: after the first paint and the first quiet moment; never in the static version ----------
     (no WebGL probe here: opening a first GL context is the one costly step, so it is done once, by the emblem script,
     which simply leaves the flat emblem in place if it cannot run) */
  function load3d() {
    if (still || !window.WebGLRenderingContext) return;
    var s = document.createElement('script');
    s.src = 'js/bat3d.min.js'; s.async = true;
    document.head.appendChild(s);
  }
  function afterPaint() { requestAnimationFrame(function () { setTimeout(load3d, 120); }); }
  if (document.readyState === 'complete') afterPaint();
  else window.addEventListener('load', afterPaint);
})();
