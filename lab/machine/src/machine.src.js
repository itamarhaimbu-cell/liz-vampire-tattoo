/* LAB · "MACHINE" — a rotary pen tattoo machine, rendered live.
   One fixed canvas behind the page. The machine is anchored to a "slot" in each section (document coordinates,
   so once it has settled it moves with the page 1:1); when another slot comes nearer the middle of the screen it
   eases over to that one. Text never depends on any of this.
   Built with esbuild from this file -> ../machine.js (three.js bundled, no CDN).
   Start-up is cut into short tasks (context · lights · model · shaders) so the page stays responsive while it loads. */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, LatheGeometry, CylinderGeometry, ConeGeometry, BoxGeometry,
  PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, PMREMGenerator, Vector2, Vector3, Quaternion,
  Color, CanvasTexture, DataTexture, RepeatWrapping, SRGBColorSpace, ACESFilmicToneMapping, DoubleSide,
  DirectionalLight, LinearMipmapLinearFilter, LinearFilter, BufferGeometry, BufferAttribute
} from 'three';

const lab = (window.__lab = window.__lab || {});
const T = (lab.t = { start: performance.now() }); // start-up timings (measuring only)
const breathe = () => new Promise((r) => setTimeout(r, 0)); // end this task; let input and paint through

async function init() {
  const root = document.documentElement;
  const canvas = document.getElementById('gl');
  const DEG = Math.PI / 180;
  const FOV = 14; // long lens: little perspective, so the machine looks the same wherever it is on the screen
  const L = 141;  // model length in "mm"; the model is normalised to length 1, needle tip at x = -0.5

  // loop state first: things created below may ask for a frame before the loop exists
  let raf = 0, awake = 0, last = 0, lastSy = -1, lastDim = 1, skip = false, firstFrame = true, lost = false, ready = false;

  /* ---------------------------------------------------------------- renderer */
  let renderer = null;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, stencil: false, powerPreference: 'high-performance' });
  } catch (e) { renderer = null; }
  if (!renderer) throw new Error('no webgl');
  renderer.setClearColor(0x060606, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 50, 9000);
  T.renderer = performance.now();
  await breathe();

  /* ---------------------------------------------------------------- light: a small black studio with strip softboxes */
  function buildEnv() {
    const pm = new PMREMGenerator(renderer);
    const es = new Scene();
    const panel = (w, h, v, pos) => {
      const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(v, v, v), side: DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0);
      es.add(m);
    };
    panel(9, 1.5, 9, [0, 4.2, 1.4]);     // long key strip above, slightly in front: the bright line along the barrel
    panel(9, 0.5, 14, [0, 1.3, -4.5]);   // thin rim strip behind/above: the edge light
    panel(7, 0.9, 3.2, [0, -3.6, 1.6]);  // low strip: a second, softer line
    panel(1.2, 5, 5, [-6, 0.5, 1]);      // end light (needle side)
    panel(1.2, 5, 2.5, [6, 0.5, 0.5]);   // end light (back side)
    panel(14, 9, 0.11, [0, 0, 7]);       // big dim front fill so faces toward the camera are not pure black
    const rt = pm.fromScene(es, 0.028, 0.1, 40, { size: 128 });
    scene.environment = rt.texture;
    pm.dispose();
    es.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
  buildEnv();
  const key = new DirectionalLight(0xffffff, 1.1); key.position.set(-500, 900, 700); scene.add(key);
  T.env = performance.now();
  await breathe();

  /* ---------------------------------------------------------------- textures */
  function knurlNormal() { // diamond knurl as a tiling normal map
    const S = 64, P = 32, d = new Uint8Array(S * S * 4);
    const h = (x, y) => { const u = (((x + y) % P) + P) % P / P, v = (((x - y) % P) + P) % P / P; return 1 - Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = (h(x - 1, y) - h(x + 1, y)) * 2.4, ny = (h(x, y - 1) - h(x, y + 1)) * 2.4, l = Math.hypot(nx, ny, 1), i = (y * S + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    const t = new DataTexture(d, S, S); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(30, 9);
    t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  }
  function engraving(text, sizePx, tracking) { // lettering that runs along the barrel
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.rotate(-Math.PI / 2);
    g.font = sizePx + 'px "Metamorphous", "Suez One", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f2eee6';
    try { g.letterSpacing = tracking + 'px'; } catch (e) { /* older engines: default tracking */ }
    g.fillText(text, 0, 6);
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter;
    return t;
  }
  function softTex(stops, radial) { // small greyscale gradient used as an alpha map
    const c = document.createElement('canvas'); c.width = radial ? 64 : 128; c.height = radial ? 64 : 4;
    const g = c.getContext('2d');
    const gr = radial ? g.createRadialGradient(32, 32, 0, 32, 32, 32) : g.createLinearGradient(0, 0, c.width, 0);
    stops.forEach((st) => { const v = Math.round(st[1] * 255); gr.addColorStop(st[0], 'rgb(' + v + ',' + v + ',' + v + ')'); });
    g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    const t = new CanvasTexture(c); t.minFilter = LinearFilter; t.generateMipmaps = false; return t;
  }

  /* ---------------------------------------------------------------- the machine */
  const machine = new Group();   // position / tilt / scale (set every frame)
  const rollG = new Group();     // roll around the long axis
  const model = new Group();     // lathes are built along Y; turn Y into the long (X) axis, needle to the left
  model.rotation.z = -Math.PI / 2;
  rollG.add(model); machine.add(rollG); scene.add(machine);

  const M = {
    steel: new MeshStandardMaterial({ color: 0xd2d2d6, metalness: 1, roughness: 0.16 }),
    knurl: new MeshStandardMaterial({ color: 0xb4b4b8, metalness: 1, roughness: 0.34, normalMap: knurlNormal(), normalScale: new Vector2(0.9, 0.9) }),
    body: new MeshStandardMaterial({ color: 0x17171a, metalness: 0.9, roughness: 0.3 }),
    plastic: new MeshStandardMaterial({ color: 0x0f0f11, metalness: 0.0, roughness: 0.12, transparent: true, opacity: 0.9 }),
    needle: new MeshStandardMaterial({ color: 0xf0f0f0, metalness: 1, roughness: 0.2 }),
    rib: new MeshStandardMaterial({ color: 0x0b0b0c, metalness: 0.6, roughness: 0.5 }),
  };
  const lathe = (pts, mat, seg) => {
    const m = new Mesh(new LatheGeometry(pts.map((p) => new Vector2(p[0] / L, p[1] / L - 0.5)), seg || 56), mat);
    model.add(m); return m;
  };
  // needle (tip at 0mm)
  {
    const cone = new Mesh(new ConeGeometry(0.42 / L, 3 / L, 12), M.needle); cone.rotation.x = Math.PI; cone.position.y = 1.5 / L - 0.5; model.add(cone);
    const shaft = new Mesh(new CylinderGeometry(0.42 / L, 0.42 / L, 7 / L, 12), M.needle); shaft.position.y = 6.5 / L - 0.5; model.add(shaft);
  }
  // cartridge: smoked plastic nozzle + housing + flange
  lathe([[0.01, 4.6], [1.5, 4.8], [1.9, 9], [2.7, 12.5], [3.7, 15.5], [4.5, 18.5], [4.7, 30], [4.7, 33], [5.7, 33.2], [5.7, 35.2], [5.0, 35.4], [5.0, 36.5]], M.plastic, 40);
  // grip: knurled aluminium, slight hourglass
  lathe([[5.4, 36], [9.4, 36.4], [11.8, 38.2], [12.4, 41], [12.4, 45], [11.8, 52], [11.4, 57], [11.8, 63], [12.4, 69], [12.4, 72], [12.0, 74.6], [11.4, 75.6]], M.knurl, 72);
  // polished collars either side of the body
  lathe([[11.2, 75.4], [12.2, 76.1], [12.2, 78.4], [11.2, 79.1]], M.steel);
  lathe([[11.2, 117.9], [12.2, 118.6], [12.2, 120.6], [11.2, 121.3]], M.steel);
  // body: black satin sleeve (carries the engraving)
  lathe([[10.7, 78.8], [11.05, 79.6], [11.05, 117.4], [10.7, 118.2]], M.body);
  // back cap: steel dome + connector
  lathe([[11.05, 121], [11.05, 129.5], [10.3, 132.6], [8.5, 135.2], [5.6, 136.7], [3.5, 137], [3.5, 140.2], [2.7, 141], [0.01, 141]], M.steel);
  // cooling ribs round the cap: something for the light to catch when it turns
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, rib = new Mesh(new BoxGeometry(1.5 / L, 6.4 / L, 0.9 / L), M.rib);
    rib.position.set(Math.sin(a) * 11.25 / L, 125.6 / L - 0.5, Math.cos(a) * 11.25 / L); rib.rotation.y = a; model.add(rib);
  }
  // engraved lettering on the sleeve: the name on one side, the year on the other
  const ROLL_NAME = 0, ROLL_YEAR = 150 * DEG;
  function decal(tex, arcDeg, at) {
    const arc = arcDeg * DEG;
    const m = new Mesh(new CylinderGeometry(11.13 / L, 11.13 / L, 36 / L, 40, 1, true, at - arc / 2, arc),
      new MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.15, roughness: 0.8, emissive: 0xece7dd, emissiveMap: tex, emissiveIntensity: 0.22, depthWrite: false }));
    m.position.y = 98.5 / L - 0.5; model.add(m); return m;
  }
  const NAME = ['LIZ VAMPIRE', 98, 12], YEAR = ['1996', 176, 20];
  const decalName = decal(engraving(NAME[0], NAME[1], NAME[2]), 74, ROLL_NAME);
  const decalYear = decal(engraving(YEAR[0], YEAR[1], YEAR[2]), 88, ROLL_YEAR);
  let faceIn = false;
  function redrawEngraving() { // the font stylesheet itself is loaded late, so ask again whenever fonts finish loading
    if (faceIn || !document.fonts || !document.fonts.load) return;
    document.fonts.load('40px "Metamorphous"').then((f) => {
      if (faceIn || !f || !f.length) return;
      faceIn = true;
      decalName.material.map.dispose(); decalYear.material.map.dispose();
      const a = engraving(NAME[0], NAME[1], NAME[2]), b = engraving(YEAR[0], YEAR[1], YEAR[2]);
      decalName.material.map = decalName.material.emissiveMap = a; decalYear.material.map = decalYear.material.emissiveMap = b;
      decalName.material.needsUpdate = decalYear.material.needsUpdate = true; wake(12);
    }).catch(() => {});
  }
  redrawEngraving();
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', redrawEngraving);
  { const fc = document.getElementById('fontcss'); if (fc) fc.addEventListener('load', redrawEngraving); }

  /* ---------------------------------------------------------------- the ink line: drawn in this same layer, so the needle sits ON it.
     A soft-edged ribbon along the path; how much of it shows is decided by time (boot script), never by scroll position. */
  const inkG = new Group(); scene.add(inkG);
  let inkMesh = null, inkDot = null, inkSegs = 0;
  const inkMat = new MeshBasicMaterial({
    color: 0xece7dd, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    alphaMap: softTex([[0, 0], [0.2, 0.035], [0.36, 0.13], [0.435, 0.3], [0.452, 1], [0.548, 1], [0.565, 0.3], [0.64, 0.13], [0.8, 0.035], [1, 0]]),
  });
  const dotMat = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    alphaMap: softTex([[0, 1], [0.18, 0.75], [0.5, 0.16], [1, 0]], true),
  });
  function buildInk() {
    if (!lab.ink || !inkMap) return;
    const pts = lab.ink.pts, n = pts.length / 2, s = inkMap.s, HW = 9;
    const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), idx = new Uint16Array((n - 1) * 6);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = pts[b * 2] - pts[a * 2], ty = pts[b * 2 + 1] - pts[a * 2 + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const x = pts[i * 2] * s, y = -pts[i * 2 + 1] * s, nx = ty * HW, ny = tx * HW; // across the stroke (world y is up)
      pos[i * 6] = x + nx; pos[i * 6 + 1] = y + ny; pos[i * 6 + 3] = x - nx; pos[i * 6 + 4] = y - ny;
      uv[i * 4] = 0; uv[i * 4 + 1] = 0.5; uv[i * 4 + 2] = 1; uv[i * 4 + 3] = 0.5;
      if (i < n - 1) { const k = i * 6, v = i * 2; idx[k] = v; idx[k + 1] = v + 1; idx[k + 2] = v + 2; idx[k + 3] = v + 1; idx[k + 4] = v + 3; idx[k + 5] = v + 2; }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('uv', new BufferAttribute(uv, 2)); g.setIndex(new BufferAttribute(idx, 1));
    if (inkMesh) { inkMesh.geometry.dispose(); inkMesh.geometry = g; }
    else {
      inkMesh = new Mesh(g, inkMat); inkMesh.frustumCulled = false; inkMesh.renderOrder = -2; inkG.add(inkMesh);
      inkDot = new Mesh(new PlaneGeometry(30, 30), dotMat); inkDot.renderOrder = -1; inkDot.frustumCulled = false; inkG.add(inkDot);
    }
    inkSegs = n - 1;
  }
  T.model = performance.now();
  await breathe();

  /* ---------------------------------------------------------------- poses, one per slot
     size = the slot's CSS --k (machine length / slot width) · tilt (in the screen plane) · yaw · roll · idle amplitudes ·
     focus = the point of the machine that sits on the slot centre (-.5 needle tip … +.5 back end) ·
     fit = size and tilt follow the slot's shape (first value = the pose of the still image) */
  const POSES = {
    hero:  { tilt: 11, yaw: -17, roll: ROLL_NAME + 8 * DEG, idleRoll: 0.26, idleYaw: 2.5, bob: 3, focus: 0.0, fit: { k: [0.9, 0.97], tilt: [11, 19] } },
    story: { tilt: 3,  yaw: 10,  roll: -ROLL_YEAR + 6 * DEG, idleRoll: 0.13, idleYaw: 1.2, bob: 0, focus: 0.2 },
    craft: { tilt: 52, yaw: -16, roll: 40 * DEG, idleRoll: 0, idleYaw: 0, bob: 0, focus: -0.5, tip: true },
    rest:  { tilt: -3, yaw: 7,   roll: ROLL_NAME - 14 * DEG, idleRoll: 0, idleYaw: 0, bob: 0, focus: 0.0 },
  };
  const qZ = new Quaternion(), qY = new Quaternion(), AX_Z = new Vector3(0, 0, 1), AX_Y = new Vector3(0, 1, 0);
  function poseQuat(p, yawExtra, out) {
    qZ.setFromAxisAngle(AX_Z, p.tilt * DEG); qY.setFromAxisAngle(AX_Y, (p.yaw + (yawExtra || 0)) * DEG);
    return out.copy(qZ).multiply(qY);
  }

  /* ---------------------------------------------------------------- layout (measured on resize / when the page reflows — never per frame) */
  let W = 0, H = 0, VH = 0, slots = [], inkMap = null, measured = false;
  function measure() {
    const w = canvas.clientWidth, h = canvas.clientHeight, sy = window.scrollY;
    VH = window.innerHeight;
    if (w !== W || h !== H) {
      W = w; H = h;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.position.set(0, 0, H / (2 * Math.tan(FOV * DEG / 2))); // 1 world unit = 1 CSS px at z = 0
      camera.near = camera.position.z * 0.2; camera.far = camera.position.z * 2.5; camera.updateProjectionMatrix();
    }
    slots = [].map.call(document.querySelectorAll('[data-pose]'), (el) => {
      const r = el.getBoundingClientRect(), base = POSES[el.dataset.pose];
      let k = parseFloat(getComputedStyle(el).getPropertyValue('--k')) || 1, pose = base;
      if (base.fit) { // the hero slot grows with the screen: a taller slot gets a bigger, steeper machine
        const t = Math.min(1, Math.max(0, (r.height / r.width - 0.4) / 0.2));
        k = base.fit.k[0] + (base.fit.k[1] - base.fit.k[0]) * t;
        pose = Object.assign({}, base, { tilt: base.fit.tilt[0] + (base.fit.tilt[1] - base.fit.tilt[0]) * t });
      }
      return { el, pose, name: el.dataset.pose, k, x: r.left + r.width / 2, y: r.top + sy + r.height / 2, w: r.width, h: r.height };
    });
    const svg = document.querySelector('.ink');
    if (svg && lab.ink) { // how the line's own units map onto the page
      const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, s = Math.min(r.width / vb.width, r.height / vb.height);
      const rebuilt = !inkMap || inkMap.s !== s;
      inkMap = { s, ox: r.left + (r.width - vb.width * s) / 2, oy: r.top + sy + (r.height - vb.height * s) / 2, top: r.top + sy - 40, bottom: r.bottom + sy + 60 };
      if (rebuilt) buildInk();
    }
    measured = true; wake(4);
  }
  let measureQueued = false;
  function queueMeasure() { if (!measureQueued) { measureQueued = true; requestAnimationFrame(() => { measureQueued = false; measure(); }); } }

  /* ---------------------------------------------------------------- motion state */
  let active = null;                       // the slot the machine is anchored to
  const off = new Vector2(0, 0);           // distance still to travel to that anchor (page px) — decays to 0
  let scale = 0, rollNow = 0, idleAmp = 0; // eased values
  const quat = new Quaternion(), qT = new Quaternion(), v3 = new Vector3(), anchor = new Vector2(), cur = new Vector2();
  let frozen = false, sweepT = -1;
  const tipTarget = new Vector2(), headPt = new Vector2();

  function inkPoint(p, out) { // the line's head, in page px
    const pts = lab.ink.pts, n = pts.length / 2 - 1, f = Math.max(0, Math.min(1, p)) * n, i = Math.floor(f), t = f - i, j = Math.min(n, i + 1);
    return out.set(inkMap.ox + (pts[i * 2] + (pts[j * 2] - pts[i * 2]) * t) * inkMap.s, inkMap.oy + (pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * t) * inkMap.s);
  }
  function anchorOf(slot, now, out) { // where the machine's centre belongs for this slot (page px); returns its size
    const p = slot.pose, s = slot.k * slot.w;
    poseQuat(p, 0, qT);
    if (p.tip && inkMap) {
      const prog = lab.ink.progress(now);
      inkPoint(prog, tipTarget);
      if (prog >= 1) { // done: the hand lifts and waits beside the drawing, in the clear space above the wing
        const u = Math.min(1, Math.max(0, (now - lab.ink.doneAt - 250) / 1100)), e = u * u * (3 - 2 * u), rest = lab.ink.rest;
        tipTarget.x += (inkMap.ox + rest[0] * inkMap.s - tipTarget.x) * e; tipTarget.y += (inkMap.oy + rest[1] * inkMap.s - tipTarget.y) * e;
      }
      out.copy(tipTarget);
    } else out.set(slot.x, slot.y);
    v3.set(-p.focus * s, 0, 0).applyQuaternion(qT); // put the focus point on the target (screen y runs down, world y up)
    out.x += v3.x; out.y -= v3.y;
    return s;
  }
  function pickSlot(sy) {
    const mid = sy + VH * 0.48; let best = null, bd = Infinity;
    for (let i = 0; i < slots.length; i++) { const d = Math.abs(slots[i].y - mid); if (d < bd) { bd = d; best = slots[i]; } }
    if (!active) return best;
    const cd = Math.abs(active.y - mid);
    // a little hysteresis so it doesn't flip-flop at the midpoint (slots are re-measured objects: compare by element)
    return best.el !== active.el && bd < cd - 36 ? best : slots.find((x) => x.el === active.el) || best;
  }

  /* ---------------------------------------------------------------- frame loop: only runs while something is changing */
  function wake(n) {
    awake = Math.max(awake, n || 2);
    if (ready && !raf && !lost && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function frame(now) {
    const t0 = lab.perf ? performance.now() : 0;
    step(now);
    if (lab.perf) { const d = performance.now() - t0; lab.perf.n++; lab.perf.sum += d; if (d > lab.perf.max) lab.perf.max = d; lab.perf.all.push(d); } // measuring only
  }
  function step(now) {
    raf = 0;
    if (!measured || !slots.length) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    const sy = window.scrollY, moved = sy !== lastSy; lastSy = sy;

    // which slot
    const pick = pickSlot(sy);
    const s = anchorOf(pick, now, anchor);
    if (!active || pick.el !== active.el) {
      if (active) { // carry on from where it is now, but never from further than just outside the screen
        off.set(cur.x - anchor.x, cur.y - anchor.y);
        const lim = VH * 0.95; if (Math.abs(off.y) > lim) off.y = lim * Math.sign(off.y);
      } else { // first frame: start exactly on the still it replaces, then ease into this screen's pose
        const f = pick.pose.fit;
        off.set(0, 0); scale = f ? f.k[0] * pick.w : s; rollNow = pick.pose.roll;
        quat.copy(f ? poseQuat(Object.assign({}, pick.pose, { tilt: f.tilt[0] }), 0, qT) : qT);
      }
      root.dataset.machine = pick.name;
    }
    active = pick; // (same slot, possibly re-measured)
    const p = active.pose;

    // ease: position (the remaining offset), size, turn
    const kPos = 1 - Math.exp(-dt / 0.16), kRot = 1 - Math.exp(-dt / 0.22);
    off.multiplyScalar(1 - kPos); if (off.lengthSq() < 0.04) off.set(0, 0);
    scale += (s - scale) * kPos;
    cur.set(anchor.x + off.x, anchor.y + off.y);

    // idle life only for the poses that have it, and only once it has arrived
    const settled = off.lengthSq() === 0;
    const wantIdle = !frozen && (p.idleRoll || p.bob) && settled ? 1 : 0;
    idleAmp += (wantIdle - idleAmp) * (1 - Math.exp(-dt / 0.6));
    const t = now / 1000;
    poseQuat(p, p.idleYaw * Math.sin(t * 0.43) * idleAmp, qT);
    quat.slerp(qT, kRot);
    const rollTarget = p.roll + p.idleRoll * Math.sin(t * 0.55) * idleAmp;
    rollNow += (rollTarget - rollNow) * kRot;
    const bob = p.bob * Math.sin(t * 0.8) * idleAmp;

    // the light: when the machine comes alive the studio lights make one full turn round the barrel
    // (it starts and ends exactly on the still), then a very slow drift
    let env = 0;
    if (sweepT >= 0) {
      sweepT += dt; const u = Math.min(1, sweepT / 2.1), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; env = -Math.PI * 2 * e; if (u >= 1) sweepT = -1;
    }
    if (!frozen) env += 0.16 * Math.sin(t * 0.3) * idleAmp;
    scene.environmentRotation.set(env, 0, 0);

    // to the screen
    machine.position.set(cur.x - W / 2, H / 2 - (cur.y - sy + bob), 0);
    machine.quaternion.copy(quat); machine.scale.setScalar(scale); rollG.rotation.x = rollNow;

    // dim the machine while it is travelling, so it never competes with the words it passes behind
    // (by exposure: the ink line is not tone-mapped, so the drawing keeps its brightness)
    const far = Math.min(1, Math.max(0, (off.length() - VH * 0.06) / (VH * 0.5)));
    const dim = Math.round((1 - 0.74 * far * far * (3 - 2 * far)) * 100) / 100;
    if (dim !== lastDim) { renderer.toneMappingExposure = dim * dim; lastDim = dim; }

    // the line: moves with the page, shows as much as time has drawn; a point of light at the needle while it works
    let inkOn = false;
    if (inkMesh) {
      const prog = lab.ink.progress(now);
      inkOn = prog > 0 && inkMap.bottom - sy > 0 && inkMap.top - sy < H;
      inkG.visible = inkOn;
      if (inkOn) {
        inkG.position.set(inkMap.ox - W / 2, H / 2 - (inkMap.oy - sy), 0);
        inkMesh.geometry.setDrawRange(0, Math.max(0, Math.min(inkSegs, Math.ceil(prog * inkSegs))) * 6);
        const glow = prog >= 1 ? Math.max(0, 1 - (now - lab.ink.doneAt) / 500) : Math.min(1, prog * 30);
        inkDot.visible = glow > 0.01;
        if (inkDot.visible) { inkPoint(prog, headPt); inkDot.position.set(headPt.x - inkMap.ox, -(headPt.y - inkMap.oy), 0); dotMat.opacity = glow * 0.9; }
      }
    }

    // nothing to draw while the machine is parked off-screen and the line is not in view
    const rad = scale * 0.56, sy0 = cur.y - sy;
    const offscreen = sy0 < -rad || sy0 > H + rad;
    const animating = !settled || Math.abs(s - scale) > 0.2 || quat.angleTo(qT) > 0.002 || Math.abs(rollTarget - rollNow) > 0.002 || sweepT >= 0 ||
      (lab.ink && lab.ink.running(now));
    const idling = idleAmp > 0.01 || wantIdle === 1;
    skip = !skip;
    if ((!offscreen || inkOn || awake > 0) && (moved || animating || awake > 0 || (idling && skip))) { // idle-only motion renders every other frame
      if (firstFrame) T.preRender = performance.now();
      renderer.render(scene, camera);
      if (firstFrame) { firstFrame = false; T.first = performance.now(); root.classList.add('gl'); sweepT = frozen ? -1 : 0; if (lab.onLive) lab.onLive(); }
    }
    if (awake > 0) awake--;
    if (animating || awake > 0 || (idling && !offscreen)) raf = requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- losing / regaining the GPU */
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); lost = true; if (raf) cancelAnimationFrame(raf); raf = 0; root.classList.remove('gl'); if (lab.stills) lab.stills();
  });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; buildEnv(); firstFrame = true; W = 0; measure(); wake(6); });

  /* ---------------------------------------------------------------- hooks for the page + for making the poster stills */
  lab.wake = wake;
  lab.gl = {
    freeze(b) { frozen = !!b; idleAmp = 0; sweepT = -1; wake(6); },
    snap() {
      if (active) { off.set(0, 0); scale = anchorOf(active, performance.now(), anchor); quat.copy(poseQuat(active.pose, 0, qT)); rollNow = active.pose.roll; }
      wake(6);
    },
    state() { return { active: active && active.name, off: [off.x, off.y], scale, W, H, dim: lastDim, raf: !!raf }; },
  };
  if (lab.ink) lab.ink.onchange = () => wake(4);

  /* ---------------------------------------------------------------- go: measure, compile the shaders off the critical path, start */
  measure();
  T.measured = performance.now();
  window.addEventListener('resize', queueMeasure);
  if (window.ResizeObserver) new ResizeObserver(queueMeasure).observe(document.getElementById('main'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(queueMeasure);
  window.addEventListener('scroll', () => wake(2), { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(4); });
  await breathe();
  try { // put the machine where it will first be drawn, then let the GPU build the programs without blocking the page
    const first = pickSlot(window.scrollY), s0 = anchorOf(first, performance.now(), anchor);
    machine.position.set(anchor.x - W / 2, H / 2 - (anchor.y - window.scrollY), 0); machine.scale.setScalar(s0); machine.quaternion.copy(qT);
    inkG.visible = true;
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  } catch (e) { /* compiled on first draw instead */ }
  T.compiled = performance.now();
  ready = true;
  wake(8);
}

init().catch(() => { lab.glFailed = true; if (lab.stills) lab.stills(); }); // no WebGL: the stills take over
