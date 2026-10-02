/* ============ LAB · CHROME BAT — the emblem as a chrome object ============
   Bundled to ../js/bat3d.min.js (see tools/README.md). Loaded by page.js after the first paint. No library: one mesh, one
   shader — about 8 KB on the wire where a general 3D engine costs ~140 KB and a second of start-up work on a phone.

   One fixed canvas behind the text. The emblem is built here from the traced logo (src/emblem.json; the letters are
   real holes) and rests in a different pose per chapter: each chapter has a "slot" box in the page, the canvas reads
   those boxes once (and on a real resize) and the emblem travels between them as the page scrolls. Text never moves
   with it. A frame is drawn only while something changes; at rest in the last chapter the loop stops. */
import earcut from 'earcut';
import EMBLEM from './emblem.json';

(function () {
  var root = document.documentElement;
  var canvas = document.getElementById('stage');
  var chapters = Array.prototype.slice.call(document.querySelectorAll('.chapter'));
  if (!canvas || !chapters.length) return;

  var FOV = 24;            // degrees; narrow, so the emblem square-on matches the flat logo it replaces
  var DEPTH = 34;          // thickness, in logo px
  var INSET = 2.0, DROP = 2.6; // the chamfer between face and wall
  var CREASE = Math.cos(40 * Math.PI / 180);
  var bb = EMBLEM.bat.bbox, BX = bb[0] + bb[2] / 2, BY = bb[1] + bb[3] / 2, BW = bb[2];

  var gl = null, opts = { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'high-performance' };
  var tc = performance.now();
  try { gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts); } catch (e) { gl = null; }
  if (!gl) return; // no WebGL: the flat emblem stays

  /* ---------- the emblem's mesh: two faces, a chamfer, the walls ---------- */
  function signedArea(r) { var a = 0; for (var i = 0, n = r.length; i < n; i++) { var p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  // emblem space: x right, y up, origin at the bat's centre. Outline anticlockwise, holes clockwise, so the metal is
  // always on the left of the direction of travel and "outward" is always (dy, -dx).
  function ring(pts, ccw) {
    var r = pts.map(function (p) { return [p[0] - BX, -(p[1] - BY)]; });
    if ((signedArea(r) > 0) !== ccw) r.reverse();
    return r;
  }
  function build() {
    var rings = [ring(EMBLEM.bat.outer, true)].concat(EMBLEM.bat.holes.map(function (h) { return ring(h, false); }));
    var P = [], N = [], U = [], I = [];
    function vert(x, y, z, nx, ny, nz, u, v) { P.push(x, y, z); N.push(nx, ny, nz); U.push(u, v); return P.length / 3 - 1; }
    function quad(a, b, c, d) { I.push(a, b, c, a, c, d); }
    var zf = DEPTH / 2, zw = DEPTH / 2 - DROP, flat = [], holesAt = [];
    rings.forEach(function (r, ri) {
      var n = r.length, seg = [], vn = [], inner = [], smooth = [], i;
      for (i = 0; i < n; i++) { // outward normal of the segment i -> i+1
        var p = r[i], q = r[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.sqrt(dx * dx + dy * dy) || 1;
        seg.push([dy / l, -dx / l]);
      }
      for (i = 0; i < n; i++) { // per corner: the mitre direction, whether it is a soft or a hard corner, the inset point
        var a = seg[(i + n - 1) % n], b = seg[i], mx = a[0] + b[0], my = a[1] + b[1], ml = Math.sqrt(mx * mx + my * my);
        if (ml < 1e-4) { mx = a[0]; my = a[1]; ml = 1; }
        mx /= ml; my /= ml;
        var cosHalf = Math.max(0.36, mx * a[0] + my * a[1]);
        vn.push([mx, my]); smooth.push(a[0] * b[0] + a[1] * b[1] > CREASE);
        inner.push([r[i][0] - mx * INSET / cosHalf, r[i][1] - my * INSET / cosHalf]);
      }
      if (ri) holesAt.push(flat.length / 2);
      inner.forEach(function (p) { flat.push(p[0], p[1]); });
      var cl = Math.sqrt(DROP * DROP + INSET * INSET), cxy = DROP / cl, cz = INSET / cl; // chamfer normal = (out * cxy, cz)
      for (i = 0; i < n; i++) {
        var j = (i + 1) % n, s = seg[i];
        var n0 = smooth[i] ? vn[i] : s, n1 = smooth[j] ? vn[j] : s;
        var p0 = r[i], p1 = r[j], i0 = inner[i], i1 = inner[j];
        // wall
        quad(vert(p0[0], p0[1], zw, n0[0], n0[1], 0, -1, -1), vert(p0[0], p0[1], -zw, n0[0], n0[1], 0, -1, -1),
             vert(p1[0], p1[1], -zw, n1[0], n1[1], 0, -1, -1), vert(p1[0], p1[1], zw, n1[0], n1[1], 0, -1, -1));
        // chamfers, front and back
        [1, -1].forEach(function (f) {
          quad(vert(i0[0], i0[1], zf * f, n0[0] * cxy, n0[1] * cxy, cz * f, -1, -1), vert(p0[0], p0[1], zw * f, n0[0] * cxy, n0[1] * cxy, cz * f, -1, -1),
               vert(p1[0], p1[1], zw * f, n1[0] * cxy, n1[1] * cxy, cz * f, -1, -1), vert(i1[0], i1[1], zf * f, n1[0] * cxy, n1[1] * cxy, cz * f, -1, -1));
        });
      }
    });
    // the two faces; their UVs are the logo's own coordinates, where the relief map was baked
    var tri = earcut(flat, holesAt, 2);
    [1, -1].forEach(function (f) {
      var base = P.length / 3;
      for (var k = 0; k < flat.length; k += 2) vert(flat[k], flat[k + 1], zf * f, 0, 0, f, (flat[k] + BX) / EMBLEM.w, (BY - flat[k + 1]) / EMBLEM.h);
      for (var t = 0; t < tri.length; t += 3) I.push(base + tri[t], base + tri[t + (f > 0 ? 1 : 2)], base + tri[t + (f > 0 ? 2 : 1)]);
    });
    return { pos: new Float32Array(P), nrm: new Float32Array(N), uv: new Float32Array(U), idx: new Uint16Array(I) };
  }
  var T = { t0: performance.now(), ctx: performance.now() - tc };
  var mesh = build();
  T.build = performance.now() - T.t0;

  /* ---------- the shader: chrome under a few soft bone lights in a black room ---------- */
  var VS = [
    'attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv;',
    'uniform mat4 uProj; uniform mat3 uRot; uniform vec3 uScale; uniform vec3 uPos;',
    'varying vec3 vW; varying vec3 vN; varying vec2 vUv;',
    'void main(){',
    '  vec3 w = uRot * (aPos * uScale) + uPos;',
    '  vW = w; vN = aNrm; vUv = aUv;',
    '  gl_Position = uProj * vec4(w, 1.0);',
    '}'].join('\n');
  var FS = [
    'precision highp float;',
    'uniform sampler2D uRelief; uniform float uHasRelief;',
    'uniform mat3 uRot; uniform vec3 uInvScale; uniform vec3 uCam; uniform float uSweep;',
    'varying vec3 vW; varying vec3 vN; varying vec2 vUv;',
    'vec3 room(vec3 r){',
    '  vec3 bone = vec3(1.0, 0.965, 0.9);',
    '  float up = r.y;',
    '  vec3 c = vec3(0.010) + vec3(0.034, 0.033, 0.031) * smoothstep(-0.7, 0.9, up);',       // the dark room, a touch lighter above
    '  float k = dot(r, normalize(vec3(-0.14, 0.2, 1.0)));',                                  // a softbox in front, slightly up-left:
    '  c += bone * (smoothstep(0.66, 0.99, k) * 0.46 + smoothstep(0.9, 0.998, k) * 1.5);',  //   wide glow + a hot core
    '  float az = atan(r.x, r.z);',
    '  float tall = smoothstep(1.0, 0.2, abs(up));',
    '  c += bone * 3.6 * smoothstep(0.17, 0.0, abs(az + 1.32)) * tall;',                     // tall strips left and right:
    '  c += bone * 2.4 * smoothstep(0.11, 0.0, abs(az - 1.48)) * tall;',                     //   the lines that run along edges
    '  c += bone * 2.8 * smoothstep(0.78, 0.97, up);',                                        // a bar overhead
    '  c += bone * 0.16 * smoothstep(-0.3, -0.95, up);',                                      // the floor, barely
    '  c += bone * 1.1 * smoothstep(0.12, 0.0, abs(abs(az) - 2.7)) * smoothstep(0.7, 0.0, abs(up + 0.15));', // two rims behind
    '  return c;',
    '}',
    'void main(){',
    '  vec3 n = vN;',
    '  if (vUv.x >= 0.0) {',                                                                  // a face: take the relief
    '    vec3 t = mix(vec3(0.0, 0.0, 1.0), texture2D(uRelief, vUv).xyz * 2.0 - 1.0, uHasRelief);',
    '    n = vec3(t.xy, t.z * sign(vN.z));',
    '  }',
    '  vec3 N = normalize(uRot * (n * uInvScale));',
    '  vec3 V = normalize(uCam - vW);',
    '  float nv = dot(N, V);',
    '  if (nv < 0.0) { N = normalize(N - 1.02 * nv * V); nv = dot(N, V); }',                 // never reflect "through" the metal
    '  vec3 R = reflect(-V, N);',
    '  float c = cos(uSweep), s = sin(uSweep);',
    '  R = vec3(c * R.x + s * R.z, R.y, c * R.z - s * R.x);',
    '  vec3 col = room(R);',
    '  float f = pow(1.0 - clamp(nv, 0.0, 1.0), 5.0);',
    '  col *= mix(vec3(0.82, 0.80, 0.76), vec3(1.0), f);',                                    // polished steel, a hint of bone
    '  col = col / (col + vec3(0.62)) * 1.32;',                                               // soft shoulder
    '  gl_FragColor = vec4(pow(col, vec3(0.4545)), 1.0);',
    '}'].join('\n');

  var prog = null, loc = {}, relief = null, reliefTex = null, reliefReady = false;
  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }
  function uploadRelief() {
    if (!relief || !relief.complete || !relief.naturalWidth) return;
    reliefTex = reliefTex || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, reliefTex);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, relief);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var ani = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ani) gl.texParameterf(gl.TEXTURE_2D, ani.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    reliefReady = true;
  }
  function setup() { // also runs again after the GPU context is restored
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(prog);
    ['uProj', 'uRot', 'uScale', 'uPos', 'uRelief', 'uHasRelief', 'uInvScale', 'uCam', 'uSweep'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
    [['aPos', mesh.pos, 3], ['aNrm', mesh.nrm, 3], ['aUv', mesh.uv, 2]].forEach(function (a) {
      var l = gl.getAttribLocation(prog, a[0]);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, a[1], gl.STATIC_DRAW);
      gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, a[2], gl.FLOAT, false, 0, 0);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
    gl.uniform1i(loc.uRelief, 0);
    reliefTex = null; reliefReady = false; uploadRelief();
  }
  try { var ts = performance.now(); setup(); T.setup = performance.now() - ts; } catch (e) { return; } // a GPU that cannot run it: the flat emblem stays

  /* ---------- where the emblem rests in each chapter ---------- */
  var W = 0, H = 0, CH = 1, camZ = 1, poses = [], proj = new Float32Array(16), rot = new Float32Array(9);
  function measure() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = root.clientWidth; H = canvas.clientHeight || window.innerHeight;
    CH = chapters[0].offsetHeight || window.innerHeight;
    var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    gl.viewport(0, 0, pw, ph);
    var f = 1 / Math.tan(FOV * Math.PI / 360), near, far;
    camZ = (H / 2) * f; near = camZ * 0.2; far = camZ * 2.6; // 1 unit = 1 CSS px on the page plane
    proj.set([f * H / W, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 0, 0]);
    proj[14] = -camZ * proj[10] + (2 * far * near) / (near - far); proj[15] = camZ; // projection x "camera back by camZ"
    poses = chapters.map(function (ch, i) {
      var slot = ch.querySelector(i ? '.bat-slot' : '#emblem') || ch;
      var c = ch.getBoundingClientRect(), r = slot.getBoundingClientRect();
      var line = r.height < 4; // a 1px slot = "sit centred on this line"
      var s = line ? r.width / BW : r.width / EMBLEM.w;
      return {
        s: s,
        cx: line ? r.left + r.width / 2 : r.left + BX * s,
        cy: (line ? r.top : r.top + BY * s) - c.top,
        yaw: +ch.dataset.yaw || 0, pitch: +ch.dataset.pitch || 0, roll: +ch.dataset.roll || 0,
        sway: +ch.dataset.sway || 0,
        thin: ch.dataset.thin ? +ch.dataset.thin : 1, // depth scale: the craft chapter flattens the emblem into a line
      };
    });
  }

  /* ---------- state ---------- */
  var sy = window.pageYOffset || 0, lastSy = sy;
  var cur = null, tgt = {};
  var clock = 0, last = 0, running = false, frame = 0, shown = false, lost = false;
  var dragYaw = 0, dragging = false, dragX = 0, tiltYaw = 0, tiltPitch = 0, kick = 0, intro = 1;
  var KEYS = ['s', 'cx', 'cy', 'yaw', 'pitch', 'roll', 'sway', 'thin'];

  function ease(x) { return x * x * (3 - 2 * x); }
  function target() {
    var n = poses.length, t = sy / CH;
    var i = Math.max(0, Math.min(n - 1, Math.floor(t))), j = Math.min(n - 1, i + 1);
    var f = t < 0 ? 0 : t >= n - 1 ? 0 : ease(t - i);
    var a = poses[i], b = poses[j];
    for (var k = 0; k < KEYS.length; k++) tgt[KEYS[k]] = a[KEYS[k]] + (b[KEYS[k]] - a[KEYS[k]]) * f;
    // before the first and after the last chapter the emblem simply leaves with its page
    var over = t < 0 ? t : t > n - 1 ? t - (n - 1) : 0;
    tgt.cy -= over * CH;
    tgt.gone = t > n - 1 + 0.9;
    return tgt;
  }

  function draw(p) {
    // the takeover: the chrome emblem starts square-on, exactly where the flat one is; then one sweep of light
    // crosses it and the slow sway fades in (intro runs 1 -> 0 once)
    var live = window.__batFreeze ? 0 : p.sway * (1 - intro) * (1 - intro);
    var yaw = p.yaw + Math.sin(clock * 0.55) * 0.2 * live + (dragYaw + tiltYaw) * Math.max(p.sway, 0.25);
    var pitch = p.pitch + kick + tiltPitch * live + Math.sin(clock * 0.41) * 0.035 * live;
    var cy = Math.cos(yaw), syw = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cz = Math.cos(p.roll), sz = Math.sin(p.roll);
    // R = Ry * Rx * Rz, column-major
    rot[0] = cy * cz + syw * sx * sz; rot[1] = cx * sz; rot[2] = -syw * cz + cy * sx * sz;
    rot[3] = -cy * sz + syw * sx * cz; rot[4] = cx * cz; rot[5] = syw * sz + cy * sx * cz;
    rot[6] = syw * cx; rot[7] = -sx; rot[8] = cy * cx;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(loc.uProj, false, proj);
    gl.uniformMatrix3fv(loc.uRot, false, rot);
    gl.uniform3f(loc.uScale, p.s, p.s, p.s * p.thin);
    gl.uniform3f(loc.uInvScale, 1, 1, 1 / p.thin);
    gl.uniform3f(loc.uPos, p.cx - W / 2, H / 2 - p.cy, 0);
    gl.uniform3f(loc.uCam, 0, 0, camZ);
    gl.uniform1f(loc.uHasRelief, reliefReady ? 1 : 0);
    // the lights drift slowly across the metal
    gl.uniform1f(loc.uSweep, window.__batFreeze ? 0 : Math.sin(clock * 0.3) * 0.42 * Math.max(live, 0.1) + intro * intro * 1.5);
    if (reliefReady) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, reliefTex); }
    gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_SHORT, 0);
  }

  function settled(a, b) {
    return Math.abs(a.cx - b.cx) < 0.3 && Math.abs(a.cy - b.cy) < 0.3 && Math.abs(a.pitch - b.pitch) < 0.002 && Math.abs(a.yaw - b.yaw) < 0.002 && Math.abs(a.s - b.s) < 0.0006;
  }

  function tick(now) {
    if (!running) return;
    var dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    var t = target();
    if (!cur) { cur = {}; for (var k = 0; k < KEYS.length; k++) cur[KEYS[k]] = t[KEYS[k]]; }
    var a = 1 - Math.exp(-dt * 14);
    for (var q = 0; q < KEYS.length; q++) cur[KEYS[q]] += (t[KEYS[q]] - cur[KEYS[q]]) * a;
    // a flick tips the emblem a little; it comes back on its own
    var v = (sy - lastSy) / Math.max(dt, 0.008); lastSy = sy;
    kick += (Math.max(-0.22, Math.min(0.22, v * 0.00009)) - kick) * (1 - Math.exp(-dt * 9));
    if (!dragging) dragYaw += (0 - dragYaw) * (1 - Math.exp(-dt * 4));
    if (shown && intro > 0) intro = Math.max(0, intro - dt / 1.9);
    var moving = !settled(cur, t) || Math.abs(kick) > 0.004 || dragging || Math.abs(dragYaw) > 0.004 || intro > 0;
    var alive = cur.sway > 0.02; // a pose that sways keeps a slow clock
    frame++;
    if (moving || (alive && frame % 2 === 0)) { // at rest the sway is drawn at half rate
      clock += moving ? dt : dt * 2;
      var td = shown ? 0 : performance.now();
      draw(cur);
      if (!shown) { gl.finish(); T.firstDraw = performance.now() - td; shown = true; root.classList.add('bat-3d'); }
    }
    if (t.gone || (!moving && !alive)) { running = false; return; } // nothing changes: stop until the next scroll/touch
    requestAnimationFrame(tick);
  }
  function wake() {
    if (running || lost || document.hidden || !poses.length) return;
    running = true; last = 0;
    requestAnimationFrame(tick);
  }

  /* ---------- inputs ---------- */
  window.addEventListener('scroll', function () { sy = window.pageYOffset; wake(); }, { passive: true });
  document.addEventListener('visibilitychange', function () { if (document.hidden) running = false; else wake(); });
  var rz = 0, lastW = root.clientWidth;
  window.addEventListener('resize', function () {
    clearTimeout(rz);
    rz = setTimeout(function () {
      // phones resize on every toolbar slide: the canvas is a fixed 100lvh, so only a real width change matters
      if (root.clientWidth === lastW && window.matchMedia('(max-width:820px)').matches) return;
      lastW = root.clientWidth; measure(); cur = null; wake();
    }, 160);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (poses.length) { measure(); wake(); } }); // the lockup settles when the faces arrive

  // drag across the emblem to turn it (vertical drags still scroll the page)
  var emblem = document.getElementById('emblem');
  if (emblem) {
    emblem.addEventListener('pointerdown', function (e) { dragging = true; dragX = e.clientX; wake(); });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dragYaw = Math.max(-1.3, Math.min(1.3, dragYaw + (e.clientX - dragX) * 0.011)); dragX = e.clientX; wake();
    }, { passive: true });
    ['pointerup', 'pointercancel'].forEach(function (n) { window.addEventListener(n, function () { dragging = false; }); });
  }
  // gentle tilt where the browser gives it without asking (not iOS, which needs a permission prompt)
  if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
    var tiltAt = 0;
    window.addEventListener('deviceorientation', function (e) {
      if (e.gamma == null) return;
      var now = performance.now(); if (now - tiltAt < 50) return; tiltAt = now;
      tiltYaw = Math.max(-1, Math.min(1, e.gamma / 40)) * 0.3;
      tiltPitch = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 40)) * 0.16;
      wake();
    }, { passive: true });
  }

  /* ---------- losing the GPU: back to the flat emblem, and back again when it returns ---------- */
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault(); lost = true; running = false; shown = false; root.classList.remove('bat-3d');
  });
  canvas.addEventListener('webglcontextrestored', function () {
    try { setup(); measure(); lost = false; wake(); } catch (e) { /* stays flat */ }
  });

  /* ---------- the relief map arrives on its own; the emblem is shown once it is in (or it failed) ---------- */
  function start() { measure(); wake(); }
  relief = new Image();
  relief.onload = function () { if (!lost) uploadRelief(); start(); };
  relief.onerror = start; // a browser without WebP: the faces stay flat-shaded
  relief.src = 'assets/relief.webp';

  window.__bat = { poses: function () { return poses; }, state: function () { return { running: running, cur: cur, sy: sy, CH: CH, W: W, H: H, shown: shown, tris: mesh.idx.length / 3, timing: T }; } };
})();
