/* ============ SHARED: accessibility menu + cookie notice (every page) ============
   loaded in <head> (not deferred) so saved accessibility choices are on <html>
   before first paint — no flash of the default layout. */
(function () {
  'use strict';

  var root = document.documentElement;
  var KEY = 'lv-a11y';
  var COOKIE_KEY = 'lv-cookies-ok';
  var SIZES = ['100%', '115%', '130%'];
  var DEFAULTS = { text: 0, contrast: false, still: false, links: false, font: false };
  var prefs = copy(DEFAULTS);

  function copy(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: choices last this page only */ } }

  try {
    var saved = JSON.parse(load(KEY) || 'null');
    if (saved) for (var k in DEFAULTS) if (k in saved) prefs[k] = saved[k];
  } catch (e) { /* corrupt value: fall back to defaults */ }

  function apply() {
    root.classList.remove('a11y-text-1', 'a11y-text-2');
    if (prefs.text > 0) root.classList.add('a11y-text-' + prefs.text);
    root.classList.toggle('a11y-contrast', !!prefs.contrast);
    root.classList.toggle('a11y-still', !!prefs.still);
    root.classList.toggle('a11y-links', !!prefs.links);
    root.classList.toggle('a11y-font', !!prefs.font);
  }
  apply();
  // first visit: reserve the cookie strip's room before the first paint (no layout shift when it appears)
  if (!load(COOKIE_KEY)) root.classList.add('cookie-open');

  /* "stop animations" (or the OS reduce-motion setting): no looping video — WCAG 2.2.2 */
  var stillVideo = prefs.still || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pauseVideos() {
    document.querySelectorAll('video').forEach(function (v) {
      v.removeAttribute('autoplay');
      v.autoplay = false;
      try { v.pause(); } catch (e) {}
      v.addEventListener('play', function () { v.pause(); });
    });
  }

  /* ---------- icons ---------- */
  var ICON_A11Y = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10.8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="6.3" r="1.75" fill="currentColor"/><path d="M6.4 9.3l5.6 1.2 5.6-1.2M12 10.5v3.7m0 0l-2.7 4.9M12 14.2l2.7 4.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICONS = {
    contrast: '<svg class="a11y-opt-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    still: '<svg class="a11y-opt-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 8.5v7M14 8.5v7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    links: '<svg class="a11y-opt-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    font: '<svg class="a11y-opt-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 19l5-14 5 14M5 14h6M15.5 12.5a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM18.3 11v7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  var OPTIONS = [
    { key: 'contrast', label: 'ניגודיות גבוהה' },
    { key: 'links', label: 'הדגשת קישורים' },
    { key: 'font', label: 'גופן קריא' },
    { key: 'still', label: 'עצירת אנימציות וסרטונים', hint: 'הדף ייטען מחדש במצב סטטי' }
  ];

  /* ---------- accessibility menu ---------- */
  function buildMenu() {
    var wrap = document.createElement('aside');
    wrap.className = 'a11y';
    wrap.setAttribute('aria-label', 'נגישות');

    var opts = OPTIONS.map(function (o) {
      return '<button type="button" class="a11y-opt" data-opt="' + o.key + '" aria-pressed="false">' + ICONS[o.key] +
        '<span class="a11y-opt-text"><span>' + o.label + '</span>' +
        (o.hint ? '<span class="a11y-opt-hint">' + o.hint + '</span>' : '') + '</span>' +
        '<span class="a11y-switch" aria-hidden="true"></span></button>';
    }).join('');

    wrap.innerHTML =
      '<button type="button" class="a11y-tab" id="a11yToggle" aria-expanded="false" aria-controls="a11yPanel" aria-label="פתיחת תפריט נגישות">' +
        ICON_A11Y + '<span class="a11y-tab-label" aria-hidden="true">נגישות</span></button>' +
      '<div class="a11y-panel" id="a11yPanel" role="dialog" aria-labelledby="a11yTitle" hidden>' +
        '<div class="a11y-head"><h2 id="a11yTitle">' + ICON_A11Y + 'תפריט נגישות</h2>' +
          '<button type="button" class="a11y-close" aria-label="סגירת תפריט הנגישות">✕</button></div>' +
        '<div class="a11y-size" role="group" aria-labelledby="a11ySizeLabel">' +
          '<span class="a11y-size-label" id="a11ySizeLabel">גודל טקסט</span>' +
          '<span class="a11y-size-ctl">' +
            '<button type="button" data-size="-1" aria-label="הקטנת טקסט">A−</button>' +
            '<output aria-live="polite" id="a11ySizeOut">100%</output>' +
            '<button type="button" data-size="1" aria-label="הגדלת טקסט">A+</button>' +
          '</span></div>' +
        opts +
        '<div class="a11y-foot">' +
          '<button type="button" class="a11y-reset">איפוס הגדרות</button>' +
          '<a class="a11y-statement" href="/accessibility.html">הצהרת נגישות</a>' +
        '</div>' +
      '</div>';

    var skip = document.querySelector('.skip-link');
    document.body.insertBefore(wrap, skip ? skip.nextSibling : document.body.firstChild);

    var tab = wrap.querySelector('.a11y-tab');
    var panel = wrap.querySelector('.a11y-panel');
    var out = wrap.querySelector('#a11ySizeOut');
    var minus = wrap.querySelector('[data-size="-1"]');
    var plus = wrap.querySelector('[data-size="1"]');

    function sync() {
      out.textContent = SIZES[prefs.text];
      minus.disabled = prefs.text <= 0;
      plus.disabled = prefs.text >= SIZES.length - 1;
      wrap.querySelectorAll('.a11y-opt').forEach(function (b) {
        b.setAttribute('aria-pressed', prefs[b.getAttribute('data-opt')] ? 'true' : 'false');
      });
    }
    function commit() { store(KEY, JSON.stringify(prefs)); apply(); sync(); }

    var closeTimer = null;
    function open() {
      clearTimeout(closeTimer);
      panel.hidden = false;
      requestAnimationFrame(function () { panel.classList.add('open'); });
      tab.setAttribute('aria-expanded', 'true');
      tab.setAttribute('aria-label', 'סגירת תפריט נגישות');
      wrap.querySelector('.a11y-close').focus();
    }
    function close(returnFocus) {
      if (panel.hidden) return;
      panel.classList.remove('open');
      tab.setAttribute('aria-expanded', 'false');
      tab.setAttribute('aria-label', 'פתיחת תפריט נגישות');
      closeTimer = setTimeout(function () { panel.hidden = true; }, prefs.still ? 0 : 300);
      if (returnFocus) tab.focus();
    }

    tab.addEventListener('click', function () { if (panel.hidden || !panel.classList.contains('open')) open(); else close(true); });
    wrap.querySelector('.a11y-close').addEventListener('click', function () { close(true); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); close(true); }
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(false); });
    wrap.addEventListener('focusout', function (e) {
      if (e.relatedTarget && !wrap.contains(e.relatedTarget)) close(false);
    });

    minus.addEventListener('click', function () { if (prefs.text > 0) { prefs.text--; commit(); } });
    plus.addEventListener('click', function () { if (prefs.text < SIZES.length - 1) { prefs.text++; commit(); } });
    wrap.querySelectorAll('.a11y-opt').forEach(function (b) {
      b.addEventListener('click', function () {
        var key = b.getAttribute('data-opt');
        prefs[key] = !prefs[key];
        commit();
        if (key === 'still') location.reload(); // scroll effects are built at load, so switch layouts cleanly
      });
    });
    wrap.querySelector('.a11y-reset').addEventListener('click', function () {
      var wasStill = prefs.still;
      prefs = copy(DEFAULTS);
      commit();
      if (wasStill) location.reload();
    });
    sync();
  }

  /* ---------- cookie notice (informational — the site works the same either way) ---------- */
  function cookieNote() {
    if (load(COOKIE_KEY)) return;
    var n = document.createElement('div');
    n.className = 'cookie-note';
    n.setAttribute('role', 'region');
    n.setAttribute('aria-label', 'הודעה על עוגיות');
    n.innerHTML = '<p>האתר משתמש בעוגיות של Google כדי למדוד ביקורים ולשפר את הפרסום. ' +
      '<a href="/privacy.html">מדיניות פרטיות</a></p><button type="button">הבנתי</button>';
    document.body.appendChild(n);
    root.classList.add('cookie-open'); // the home hero lifts its bottom block clear of the strip
    n.querySelector('button').addEventListener('click', function () {
      store(COOKIE_KEY, '1');
      n.remove();
      root.classList.remove('cookie-open');
    });
  }

  function init() {
    if (stillVideo) pauseVideos();
    buildMenu();
    cookieNote();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
