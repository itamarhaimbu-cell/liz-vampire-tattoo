/* LAB · "ONE LINE" — one unbroken ink line through the opening of the page.
   Built once from the layout (and again only if the layout changes), drawn by time, never by scroll position:
   each stretch starts when its section comes into view and finishes at its own pace. No per-frame layout reads. */
(function () {
  'use strict';
  var root = document.documentElement;
  var stage = document.getElementById('lineStage');
  if (!stage || !window.requestAnimationFrame || !document.createElementNS) return;
  var NS = 'http://www.w3.org/2000/svg';
  var svg = stage.querySelector('.ln-svg');
  var gHalo = svg.querySelector('.ln-halo'), gInk = svg.querySelector('.ln-ink'), wet = svg.querySelector('.ln-wet'), gDots = svg.querySelector('.ln-dots');
  var needle = stage.querySelector('.ln-needle'), glow = stage.querySelector('.ln-glow');
  var still = !root.classList.contains('ln-live');
  var SLOW = Math.max(0.2, parseFloat((/[?&]slow=([\d.]+)/.exec(location.search) || [])[1]) || 1);   // ?slow=3 stretches the clock, to watch the hand

  /* the studio's own emblem, traced from the logo: one closed outline, starting and ending at the tail tip */
  var BAT = [379.3,502.3,378.1,501,369.1,474.7,362.3,459,349.8,436,340.2,421.7,328.7,407.3,311,389.3,292.7,374.3,275.3,363.2,264.3,357.3,245,349.3,233,345.9,220.3,344,210.7,344,198.3,346,179.4,353.3,178.3,352,174.1,339,169.4,329.7,161.7,319.3,153,310.6,144.7,304.6,133.3,299.3,120,296.2,111.3,295.7,101,297,89.7,300.5,79.3,305.9,67.7,314.7,56.5,326.7,47.6,339,40.4,352.3,32.6,372.7,31.6,373.5,30,364.7,28.7,345.3,28.7,321.3,30,301.3,34.1,274.3,40,250.3,46.9,229.7,57.4,205.7,67.9,186.3,83.3,162.3,96.5,145,118.3,120,136,103,153.7,88.1,175.3,72.3,196,59.9,216,49.7,235.7,41.5,257.3,34,278,29.1,279.5,29.2,279.4,30.5,268.3,42,258.9,53.3,243.2,76.7,234.6,94.7,232,103.3,230,115.3,229.7,128,230.9,138.7,235.9,156,245.9,174.7,260,192.7,276.3,207.8,297,222.1,321,234.1,333,238.7,341,240.6,341.8,239,338,229.3,335.1,216,334,206.3,333.7,189.3,334,178.7,336.1,160.3,342.2,134.1,343.3,133.7,344.4,135,355.2,163.3,361.7,177.7,365.1,182.9,367.3,183.6,376.7,180.9,383.3,180.7,396.3,183.7,398.9,181.7,410.1,156.7,418.5,132.7,419.7,131.6,421.3,135.3,425.6,152.7,429.7,187,429.7,198,427.5,215,425.3,226,420.3,239.9,422,240.4,432,236.4,458,223.2,472,214,484.3,204.5,495.3,194.3,505.6,182.3,512.8,171.7,520.1,157.7,524.7,144,527,130.3,527,118,525.8,109,522.7,96.3,518.3,85.3,513.1,75.3,503.3,60,489.7,43.3,477.4,31,476.8,29.8,477.7,29.2,488.7,31.3,504.3,35.7,530.7,45.5,552.3,55.7,575.3,68.9,603.3,88.9,629.3,111,652.7,135.3,669.2,155.3,686.8,180.3,701.9,206.3,714.1,232.3,723.3,258.3,730.6,289,733.7,312.7,734.7,327.7,734.7,353.3,733.7,367.3,732.3,373.1,719.9,348,708.6,331.3,696.7,318.3,689.3,312.1,680.7,306.2,665.7,299.3,651,296,637.3,296.1,621.3,300.3,607,308.4,600.7,313.7,594.5,320.7,584.7,336.3,578.6,353.3,576.7,353.2,561.7,347,547.7,344.2,537.7,344,523.3,346.1,506,351.3,487.3,359.7,474.3,367.3,455,381.2,445,390,429.5,406,418.4,420,408.6,434.7,402.4,445.7,392.9,466,386.3,482.7,380.3,501.3];
  var OVAL = { cx: 378.8, cy: 564.7, rx: 134.2, ry: 19.3 };

  function f(n) { return Math.round(n * 10) / 10; }
  function P(x, y) { return f(x) + ' ' + f(y) + ' '; }
  function rnd(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  /* smooth curve through points (Catmull-Rom as cubics), continuing from pts[0] */
  function through(pts) {
    var d = '', n = pts.length;
    for (var i = 0; i < n - 1; i++) {
      var a = pts[i ? i - 1 : 0], b = pts[i], c = pts[i + 1], e = pts[i + 2 < n ? i + 2 : n - 1];
      d += 'C' + P(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6) + P(c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6) + P(c[0], c[1]);
    }
    return d;
  }
  /* a hand-held run between two points: nearly straight, never ruler-straight */
  function run(x0, y0, x1, y1, amp, seed) {
    var r = rnd(seed), len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)), n = Math.max(2, Math.round(len / 90));
    var nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1), pts = [[x0, y0]];
    for (var i = 1; i < n; i++) {
      var t = i / n, o = (Math.sin(t * Math.PI * (1.3 + r())) * 0.7 + (r() - 0.5) * 0.6) * amp;
      pts.push([x0 + (x1 - x0) * t + nx * o, y0 + (y1 - y0) * t + ny * o]);
    }
    pts.push([x1, y1]);
    return through(pts);
  }

  var parts = [];       // {g, kind, d, ink, halo, len, dur, pts, n}
  var prog = [];        // progress per part, survives a rebuild
  var lastOf = [], steps = [], dots = {};
  var W = 0, H = 0;
  var cur = -1, running = false, target = -1, t0 = 0, triggered = [], visible = [], raf = 0;

  function el(name, cls) { var e = document.createElementNS(NS, name); if (cls) e.setAttribute('class', cls); return e; }
  function dot(x, y, rad) { var c = el('circle', 'dot'); c.setAttribute('cx', f(x)); c.setAttribute('cy', f(y)); c.setAttribute('r', rad); gDots.appendChild(c); return c; }

  function build() {
    var sr = stage.getBoundingClientRect();
    W = sr.width; H = sr.height;
    svg.setAttribute('viewBox', '0 0 ' + f(W) + ' ' + f(H));
    function R(node) { var r = node.getBoundingClientRect(); return { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height, r: r.right - sr.left, b: r.bottom - sr.top }; }
    function Q(sel) { return R(stage.querySelector(sel)); }
    var F = Q('[data-ln="flourish"]'), Y = Q('[data-ln="year"]'), B = Q('[data-ln="bat"]'), L = Q('[data-ln="link"]');
    var hero = Q('.hero'), innerEl = stage.querySelector('.story .inner'), inner = R(innerEl), cs = getComputedStyle(innerEl);
    var padL = parseFloat(cs.paddingLeft) || 24, padR = parseFloat(cs.paddingRight) || 46;
    var gl = inner.x + padL * 0.5;                  // left margin: the line comes down here out of the hero
    var gr = inner.r - padR * 0.42;                 // right gutter: beside the start of every Hebrew line, the spine of the page
    steps = [].slice.call(stage.querySelectorAll('.step'));
    var S = steps.map(R), defs = [];

    /* 0 · hero: one swash under the H1, right to left, closed with a loop */
    var fx = F.x, fy = F.y, fw = F.w, fh = F.h;
    var s0 = [fx + fw, fy + fh * 0.30], e0 = [fx + fw * 0.03, fy + fh * 0.96];
    defs.push({ g: 0, kind: 'write', max: 1500, d: 'M' + P(s0[0], s0[1]) +
      'C' + P(fx + fw * 0.72, fy - fh * 0.04) + P(fx + fw * 0.36, fy + fh * 0.72) + P(fx + fw * 0.07, fy + fh * 0.36) +
      'C' + P(fx - fw * 0.035, fy + fh * 0.22) + P(fx - fw * 0.045, fy - fh * 0.24) + P(fx + fw * 0.035, fy - fh * 0.16) +
      'C' + P(fx + fw * 0.115, fy - fh * 0.08) + P(fx + fw * 0.105, fy + fh * 0.52) + P(e0[0], e0[1]) });

    /* 1 · out of the hero, down the left margin, onto the baseline of the year */
    var k = Y.w / 410, base = Y.y + 128 * k;
    function X(u) { return Y.x + u * k; }
    function V(v) { return Y.y + v * k; }
    var b0 = [Math.min(gl + 34, X(40)), base];
    defs.push({ g: 1, kind: 'run', d: 'M' + P(e0[0], e0[1]) +
      'C' + P(e0[0] - fw * 0.05, e0[1] + fh * 0.5) + P(gl + 4, e0[1] + (hero.b - e0[1]) * 0.35) + P(gl, hero.b - 6) +
      run(gl, hero.b - 6, gl, base - 36, 4, 11) +
      'C' + P(gl, base - 12) + P(gl + 10, base) + P(b0[0], b0[1]) });

    /* 2 · 1996: the numerals stand on the line. The pen never lifts — it goes back over its own ink where it must. */
    var rx = 34 * k, ry9 = 35 * k, a0 = ' 0 0 0 ', a1 = ' 0 0 1 ';
    function nine(x) {
      return 'L' + P(X(x), base) + 'L' + P(X(x), V(58)) +
        'A' + f(rx) + ' ' + f(ry9) + a0 + P(X(x - 68), V(58)) + 'A' + f(rx) + ' ' + f(ry9) + a0 + P(X(x), V(58)) + 'L' + P(X(x), base);
    }
    var yd = 'M' + P(b0[0], b0[1]) +
      'L' + P(X(58), base) + 'C' + P(X(58.6), V(92)) + P(X(57.4), V(56)) + P(X(58), V(20)) +
      'L' + P(X(33), V(48)) + 'L' + P(X(58), V(20)) + 'C' + P(X(57.4), V(56)) + P(X(58.6), V(92)) + P(X(58), base) +
      nine(152) + nine(246) +
      'L' + P(X(306), base) +
      'A' + f(rx) + ' ' + f(rx) + a0 + P(X(306), V(60)) + 'A' + f(rx) + ' ' + f(rx) + a0 + P(X(306), base) +
      'A' + f(rx) + ' ' + f(rx) + a1 + P(X(272), V(94)) +
      'C' + P(X(272), V(60)) + P(X(286), V(27)) + P(X(322), V(20));
    defs.push({ g: 1, kind: 'write', max: 3000, speed: 0.62, d: yd });

    /* 3 · off the top of the 6, along to the right gutter, and down */
    var y3 = V(150) + 24, rr = 18;
    defs.push({ g: 1, kind: 'run', slow: 1.5, d: 'M' + P(X(322), V(20)) +
      'C' + P(X(336), V(17.5)) + P(X(350), V(18)) + P(Math.min(X(364), gr - rr - 4), V(19)) + 'L' + P(gr - rr, V(19)) +
      'C' + P(gr - rr * 0.45, V(19)) + P(gr, V(19) + rr * 0.55) + P(gr, V(19) + rr) + run(gr, V(19) + rr, gr, y3, 3, 17) });

    /* 4 · down the gutter beside the story, into the emblem's shadow */
    var s = Math.min(B.w / 763, B.h / 612), ox = B.x + (B.w - 763 * s) / 2, oy = B.y + (B.h - 612 * s) / 2;
    function m(x, y) { return [ox + x * s, oy + y * s]; }
    var OL = m(OVAL.cx - OVAL.rx, OVAL.cy), OR = m(OVAL.cx + OVAL.rx, OVAL.cy), OT = m(OVAL.cx, OVAL.cy - OVAL.ry), TIP = m(BAT[0], BAT[1]);
    var arc = 'A' + f(OVAL.rx * s) + ' ' + f(OVAL.ry * s) + a1;
    defs.push({ g: 2, kind: 'run', d: 'M' + P(gr, y3) + run(gr, y3, gr, OR[1] - 86, 6, 23) +
      'C' + P(gr, OR[1] - 24) + P(OR[0], OR[1] - 58) + P(OR[0], OR[1]) });

    /* 5 · the emblem: its shadow, up the tail, once around the bat, back down, close the shadow */
    var bd = 'M' + P(OR[0], OR[1]) + arc + P(OL[0], OL[1]) + arc + P(OT[0], OT[1]) + 'L' + P(TIP[0], TIP[1]);
    for (var i = 2; i < BAT.length; i += 2) { var q = m(BAT[i], BAT[i + 1]); bd += 'L' + P(q[0], q[1]); }
    bd += 'L' + P(TIP[0], TIP[1]) + 'L' + P(OT[0], OT[1]) + arc + P(OR[0], OR[1]);
    defs.push({ g: 2, kind: 'write', max: 3800, d: bd });

    /* 6 · out of the shadow, back to the gutter */
    var y6 = OR[1] + 88;
    defs.push({ g: 2, kind: 'run', d: 'M' + P(OR[0], OR[1]) + 'C' + P(OR[0], OR[1] + 36) + P(gr, OR[1] + 24) + P(gr, y6) });

    /* 7–12 · the price steps: the line rules the list — over step one, back under it, under two, under three — and ends under the gallery link */
    var r = 18, yy = [S[0].y, S[0].b, S[1].b, S[2].b], yl = L.b - 3;
    function turnR(y) { return 'C' + P(gr - r * 0.45, y) + P(gr, y + r * 0.55) + P(gr, y + r); }      // leave a rule on the right, heading down
    function turnL(y) { return 'C' + P(gl + r * 0.45, y) + P(gl, y + r * 0.55) + P(gl, y + r); }
    function intoR(y) { return 'C' + P(gr, y - r * 0.45) + P(gr - r * 0.55, y) + P(gr - r, y); }      // come down the right, onto a rule heading left
    function intoL(y) { return 'C' + P(gl, y - r * 0.45) + P(gl + r * 0.55, y) + P(gl + r, y); }
    defs.push({ g: 3, kind: 'run', d: 'M' + P(gr, y6) + run(gr, y6, gr, yy[0] - r, 6, 37) });
    defs.push({ g: 3, kind: 'write', speed: 0.8, d: 'M' + P(gr, yy[0] - r) + intoR(yy[0]) + run(gr - r, yy[0], gl + r, yy[0], 1.5, 41) });
    defs.push({ g: 3, kind: 'write', speed: 0.8, step: 0, d: 'M' + P(gl + r, yy[0]) + turnL(yy[0]) + run(gl, yy[0] + r, gl, yy[1] - r, 1.3, 43) + intoL(yy[1]) + run(gl + r, yy[1], gr - r, yy[1], 1.5, 47) });
    defs.push({ g: 3, kind: 'write', speed: 0.8, step: 1, d: 'M' + P(gr - r, yy[1]) + turnR(yy[1]) + run(gr, yy[1] + r, gr, yy[2] - r, 1.3, 53) + intoR(yy[2]) + run(gr - r, yy[2], gl + r, yy[2], 1.5, 59) });
    defs.push({ g: 3, kind: 'write', speed: 0.8, step: 2, d: 'M' + P(gl + r, yy[2]) + turnL(yy[2]) + run(gl, yy[2] + r, gl, yy[3] - r, 1.3, 61) + intoL(yy[3]) + run(gl + r, yy[3], gr - r, yy[3], 1.5, 67) });
    var endX = Math.min(Math.max(L.x - 8, gl + r), gr - r - 30);
    defs.push({ g: 3, kind: 'write', speed: 0.8, last: true, d: 'M' + P(gr - r, yy[3]) + turnR(yy[3]) + run(gr, yy[3] + r, gr, yl - r, 1.3, 71) + intoR(yl) + run(gr - r, yl, endX, yl, 1.1, 73) });

    /* (re)create the paths */
    while (gHalo.firstChild) gHalo.removeChild(gHalo.firstChild);
    while (gInk.firstChild) gInk.removeChild(gInk.firstChild);
    while (gDots.firstChild) gDots.removeChild(gDots.firstChild);
    parts = defs.map(function (p, i) {
      p.halo = el('path'); p.ink = el('path');
      p.halo.setAttribute('d', p.d); p.ink.setAttribute('d', p.d);
      gHalo.appendChild(p.halo); gInk.appendChild(p.ink);
      p.len = p.ink.getTotalLength();
      p.dur = SLOW * (p.kind === 'run' ? Math.min(1000, Math.max(240, p.len / 1.7 * (p.slow || 1))) : Math.min(p.max || 1500, Math.max(480, p.len / (p.speed || 0.46))));
      var n = Math.max(2, Math.ceil(p.len / 5)); p.pts = new Float32Array((n + 1) * 2);
      for (var j = 0; j <= n; j++) { var pt = p.ink.getPointAtLength(p.len * j / n); p.pts[j * 2] = pt.x; p.pts[j * 2 + 1] = pt.y; }
      p.n = n; lastOf[p.g] = i; p.dashed = false;
      if (prog[i] == null) prog[i] = still ? 1 : 0;
      return p;
    });
    wetOf = -1;
    dots.start = dot(s0[0], s0[1], 2.4); dots.end = dot(endX, yl, 3.6);
    for (var z = 0; z < parts.length; z++) paint(z, prog[z], false);
    if (prog[0] > 0) dots.start.classList.add('is-on');
    if (prog[parts.length - 1] >= 1) dots.end.classList.add('is-on');
    if (cur >= 0 && running) head(cur, ease(parts[cur], prog[cur]));
  }

  function ease(p, t) { // hand speed: a short touch-down, steady, a short lift
    if (p.kind === 'run') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    var a = 0.12; return t < a ? (t * t) / (2 * a * (1 - a)) : t > 1 - a ? 1 - ((1 - t) * (1 - t)) / (2 * a * (1 - a)) : (t - a / 2) / (1 - a);
  }
  function paint(i, t, live) {
    var p = parts[i], e = t >= 1 ? 1 : t <= 0 ? 0 : ease(p, t);
    if (e >= 1) {
      p.ink.removeAttribute('stroke-dasharray'); p.ink.removeAttribute('stroke-dashoffset'); p.ink.style.visibility = '';
      p.halo.removeAttribute('stroke-dasharray'); p.halo.removeAttribute('stroke-dashoffset'); p.halo.style.visibility = '';
    } else if (e <= 0) {
      p.ink.style.visibility = 'hidden'; p.halo.style.visibility = 'hidden';
    } else {
      var off = f(p.len * (1 - e));
      if (!p.dashed) {
        var da = f(p.len) + ' ' + f(p.len + 2); p.dashed = true;
        p.ink.style.visibility = ''; p.halo.style.visibility = '';
        p.ink.setAttribute('stroke-dasharray', da); p.halo.setAttribute('stroke-dasharray', da);
      }
      p.ink.setAttribute('stroke-dashoffset', off); p.halo.setAttribute('stroke-dashoffset', off);
    }
    if (live) head(i, e);
  }
  var lastX = 0, leanS = 11, wetOf = -1;
  function head(i, e) {
    var p = parts[i], u = e * p.n, j = Math.min(p.n - 1, Math.floor(u)), fr = u - j;
    var x = p.pts[j * 2] + (p.pts[j * 2 + 2] - p.pts[j * 2]) * fr, y = p.pts[j * 2 + 1] + (p.pts[j * 2 + 3] - p.pts[j * 2 + 1]) * fr;
    /* held like a machine: upright, leaning toward the middle of the page, swaying a little with the hand */
    var lean = (x > W * 0.5 ? -11 : 11) + Math.max(-9, Math.min(9, (x - lastX) * 2.4)); lastX = x; leanS += (lean - leanS) * 0.14;
    needle.style.transform = 'translate3d(' + f(x - 14) + 'px,' + f(y - 86) + 'px,0) rotate(' + f(leanS) + 'deg)';
    glow.style.transform = 'translate3d(' + f(x - 130) + 'px,' + f(y - 130) + 'px,0)';
    /* the freshest stretch of ink still catches the light */
    var wl = Math.min(34, p.len * e);
    if (wetOf !== i) { wet.setAttribute('d', p.d); wetOf = i; }
    wet.setAttribute('stroke-dasharray', f(wl) + ' ' + f(p.len + 40)); wet.setAttribute('stroke-dashoffset', f(-(p.len * e - wl)));
    wet.style.opacity = e > 0 && e < 1 ? 0.9 : 0;
  }

  /* ---------- the runner: stretches are drawn in order, by the clock ---------- */
  function laterAsked(g) { for (var i = g + 1; i < triggered.length; i++) if (triggered[i]) return true; return false; }
  function finish(i) {
    var p = parts[i]; prog[i] = 1; paint(i, 1, false);
    p.halo.classList.add('is-fresh'); (function (h) { setTimeout(function () { h.classList.remove('is-fresh'); }, 60); })(p.halo);
    if (p.step != null && steps[p.step]) steps[p.step].classList.add('is-inked');
    if (p.last) dots.end.classList.add('is-on');
  }
  function next() {
    running = false;
    var i = 0; while (i < parts.length && prog[i] >= 1) i++;
    if (i >= parts.length) { needle.classList.remove('is-on', 'is-rest'); glow.classList.remove('is-on'); wet.style.opacity = 0; cur = -1; return; }
    if (i > target) { needle.classList.add('is-rest'); wet.style.opacity = 0; cur = -1; return; }
    var p = parts[i];
    if (laterAsked(p.g) && !visible[p.g]) { finish(i); return next(); }     // flicked past: nobody waits for it
    cur = i; running = true; t0 = performance.now() - prog[i] * p.dur;
    if (i === 0) dots.start.classList.add('is-on');
    needle.classList.add('is-on'); needle.classList.remove('is-rest'); glow.classList.add('is-on');
    p.halo.classList.add('is-fresh');
    raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    if (!running) return;
    var p = parts[cur], t = (now - t0) / p.dur;
    if (t >= 1 || (laterAsked(p.g) && !visible[p.g])) { finish(cur); next(); return; }
    prog[cur] = t; paint(cur, t, true);
    raf = requestAnimationFrame(frame);
  }
  function ask(g) { triggered[g] = true; if (lastOf[g] > target) target = lastOf[g]; if (!running) next(); }
  document.addEventListener('visibilitychange', function () {   // a hidden tab draws nothing; pick the stroke up where it stopped
    if (document.hidden) cancelAnimationFrame(raf);
    else if (running && cur >= 0) { t0 = performance.now() - prog[cur] * parts[cur].dur; raf = requestAnimationFrame(frame); }
  });

  function start() {
    build();
    if (still || !('IntersectionObserver' in window)) {
      for (var i = 0; i < parts.length; i++) { prog[i] = 1; paint(i, 1, false); }
      dots.start.classList.add('is-on'); dots.end.classList.add('is-on');
      steps.forEach(function (s) { s.classList.add('is-inked'); });
    } else {
      var anchors = ['[data-ln="flourish"]', '[data-ln="year"]', '[data-ln="bat"]', '.steps'], th = [0.5, 0.45, 0.3, 0.12];
      var small = window.matchMedia && matchMedia('(max-width:820px)').matches;
      anchors.forEach(function (sel, g) {
        var io = new IntersectionObserver(function (en) {
          en.forEach(function (e) { visible[g] = e.isIntersecting; if (e.isIntersecting && e.intersectionRatio >= th[g] && !triggered[g]) ask(g); });
        }, { threshold: [0, th[g]], rootMargin: small ? '0px 0px -112px 0px' : '0px' });
        io.observe(stage.querySelector(sel));
      });
    }
    /* the layout can still settle (web fonts, a rotated phone): rebuild the path from the new boxes, keep what is drawn */
    var tm = 0;
    function relayout() { clearTimeout(tm); tm = setTimeout(function () { var r = stage.getBoundingClientRect(); if (Math.abs(r.width - W) > 0.5 || Math.abs(r.height - H) > 0.5) build(); }, 120); }
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(stage); else window.addEventListener('resize', relayout);
    window.__lnState = function () { return { prog: prog.slice(), cur: cur, target: target, running: running, W: W, H: H, parts: parts.map(function (p) { return { g: p.g, kind: p.kind, len: Math.round(p.len), dur: Math.round(p.dur) }; }) }; };
  }
  /* wait for the faces (they move the boxes) — but never longer than a moment */
  var began = false;
  function go() { if (began) return; began = true; start(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(go, 60); });
  setTimeout(go, 900);
})();
