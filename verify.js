// end-to-end verification: node verify.js
const puppeteer = require('puppeteer-core');
const path = require('path');

const URL = process.env.SITE_URL || 'http://localhost:4173/';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOT = (n) => path.join(__dirname, 'verify-shots', n);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  require('fs').mkdirSync(path.join(__dirname, 'verify-shots'), { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox'] });

  /* ================= DESKTOP ================= */
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction('window.__heroReady === true', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 2200)); // let the staggered title entrance finish
  await page.screenshot({ path: SHOT('01-hero-top.png') });

  // fonts actually loaded
  const fonts = await page.evaluate(() => ({
    suez: document.fonts.check('16px "Suez One"'),
    assistant: document.fonts.check('16px "Assistant"'),
    metamorphous: document.fonts.check('16px "Metamorphous"'),
  }));
  check('Suez One + Assistant + Metamorphous (hero) loaded', fonts.suez && fonts.assistant && fonts.metamorphous, JSON.stringify(fonts));

  // hero: HD video playing behind canvas stencil, subtitle visible
  const hero = await page.evaluate(() => {
    const v = document.querySelector('.hero-video');
    return {
      playing: !v.paused && !v.ended && v.readyState > 2,
      videoWidth: v.videoWidth,
      subOpacity: parseFloat(getComputedStyle(document.querySelector('.hero-sub')).opacity),
    };
  });
  check('hero video playing behind stencil (HD rendition)', hero.playing && hero.videoWidth >= 1900, JSON.stringify(hero));
  check('hero subtitle visible at top', hero.subOpacity > 0.9, 'opacity=' + hero.subOpacity);

  // stencil pixels at top: corner opaque black, letterforms punched transparent
  const stencil = await page.evaluate(() => {
    const c = document.querySelector('.mask-canvas');
    const ctx = c.getContext('2d');
    const corner = ctx.getImageData(8, 8, 1, 1).data;
    const row = ctx.getImageData(0, Math.round(c.height * 0.40), c.width, 1).data;
    let holes = 0;
    for (let x = 3; x < row.length; x += 4) if (row[x] < 20) holes++;
    return { cornerAlpha: corner[3], cornerLum: corner[0], holePx: holes, rowW: c.width };
  });
  check('stencil drawn: black overlay + transparent letters',
    stencil.cornerAlpha > 240 && stencil.cornerLum < 20 && stencil.holePx > stencil.rowW * 0.05,
    JSON.stringify(stencil));

  async function scrollToHeroP(p) {
    await page.evaluate((p) => {
      const sec = document.querySelector('#hero');
      const y = (sec.offsetHeight - window.innerHeight) * p;
      if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y);
    }, p);
    await new Promise(r => setTimeout(r, 500));
  }
  const sampleGrid = () => page.evaluate(() => {
    const c = document.querySelector('.mask-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const grid = [];
    const step = 80;
    for (let y = 0; y < c.height; y += step)
      for (let x = 0; x < c.width; x += step)
        grid.push(d[(y * c.width + x) * 4 + 3] > 128 ? 1 : 0);
    return grid;
  });

  // zoom advances, viewport travels through a letter opening, dissolves at end
  const s0 = await page.evaluate(() => window.__scrubState.hero.scale);
  await scrollToHeroP(0.35);
  const gridDown = await sampleGrid();
  const s35 = await page.evaluate(() => window.__scrubState.hero.scale);
  await scrollToHeroP(0.5);
  const gridMid = await sampleGrid();
  await page.screenshot({ path: SHOT('02-hero-mid.png') });
  const transparentShare = 1 - gridMid.reduce((a, b) => a + b, 0) / gridMid.length;
  check('mid-zoom passes through a letter opening', transparentShare > 0.25, `transparent share at p=0.5: ${(transparentShare * 100).toFixed(0)}%`);
  const lineMid = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#hero .stage-line')).opacity));
  await scrollToHeroP(0.95);
  const late = await page.evaluate(() => window.__scrubState.hero);
  const line95 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#hero .stage-line')).opacity));
  await page.screenshot({ path: SHOT('03-hero-late.png') });
  await scrollToHeroP(1.0);
  const line100 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#hero .stage-line')).opacity));
  check('ink-mask zoom advances with scroll', s0 < s35 && s35 < late.scale, `scale ${s0.toFixed(2)} -> ${s35.toFixed(2)} -> ${late.scale.toFixed(2)}`);
  check('ink-mask dissolves at end (full video)', late.maskOpacity < 0.05, `maskOpacity=${late.maskOpacity}`);
  check('closing line appears late and persists to section end',
    lineMid < 0.1 && line95 > 0.9 && line100 > 0.9,
    `opacity p0.5=${lineMid} p0.95=${line95} p1.0=${line100}`);

  // REVERSE-SCROLL REGRESSION: stencil must be identical on the way back up
  await scrollToHeroP(0.35);
  const gridUp = await sampleGrid();
  const cssOpacityUp = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('.mask-canvas')).opacity));
  await page.screenshot({ path: SHOT('09-hero-return.png') });
  let mismatch = 0;
  for (let i = 0; i < gridDown.length; i++) if (gridDown[i] !== gridUp[i]) mismatch++;
  const mismatchPct = (100 * mismatch / gridDown.length);
  const opaqueShare = gridUp.reduce((a, b) => a + b, 0) / gridUp.length;
  check('reverse scroll: stencil identical on the way back up',
    mismatchPct < 1 && opaqueShare > 0.1 && opaqueShare < 0.9 && cssOpacityUp > 0.95,
    `grid mismatch ${mismatchPct.toFixed(2)}% opaqueShare=${opaqueShare.toFixed(2)} cssOpacity=${cssOpacityUp}`);
  await scrollToHeroP(0);

  // craft scrub
  await page.evaluate(() => {
    const sec = document.querySelector('#craft');
    const y = sec.offsetTop + (sec.offsetHeight - innerHeight) * 0.5;
    if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y);
  });
  await new Promise(r => setTimeout(r, 1200));
  const lineFrame = await page.evaluate(() => (window.__scrubState.line || {}).frame);
  await page.screenshot({ path: SHOT('04-craft.png') });
  check('craft scrub active', lineFrame > 20 && lineFrame < 90, `line frame ${lineFrame} of 97`);

  // gallery hover -> color
  await page.evaluate(() => {
    const g = document.querySelector('#gallery');
    if (window.__lenis) window.__lenis.scrollTo(g, { immediate: true }); else g.scrollIntoView();
  });
  await new Promise(r => setTimeout(r, 900));
  const before = await page.evaluate(() => getComputedStyle(document.querySelector('.gitem img')).filter);
  const img = await page.$('.gitem img');
  await img.hover();
  await new Promise(r => setTimeout(r, 900));
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('.gitem img')).filter);
  await page.screenshot({ path: SHOT('05-gallery-hover.png') });
  check('gallery blooms to color on hover',
    /grayscale\(1\)/.test(before) && /grayscale\(0\)/.test(after),
    `before="${before}" after="${after}"`);

  // filter
  await page.click('.gf[data-filter="color"]');
  await new Promise(r => setTimeout(r, 300));
  const filterState = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('.gitem:not(.hide)')];
    return {
      visible: vis.length,
      colorTotal: document.querySelectorAll('.gitem[data-style="color"]').length,
      allColor: vis.every(g => g.getAttribute('data-style') === 'color'),
    };
  });
  check('gallery filter works',
    filterState.colorTotal > 1 && filterState.visible === filterState.colorTotal && filterState.allColor,
    JSON.stringify(filterState));
  await page.click('.gf[data-filter="all"]');

  // styles list: ink-sweep on hover (display-only, decoupled from gallery)
  await page.evaluate(() => {
    const s = document.querySelector('#styles');
    if (window.__lenis) window.__lenis.scrollTo(s, { immediate: true }); else s.scrollIntoView();
  });
  await new Promise(r => setTimeout(r, 900));
  const li = await page.$('.styles-list li[data-style="color"]');
  const posBefore = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.styles-list li[data-style="color"]')).backgroundPosition);
  await li.hover();
  await new Promise(r => setTimeout(r, 750)); // let the .55s sweep finish
  const sweep = await page.evaluate(() => {
    const el = document.querySelector('.styles-list li[data-style="color"]');
    const cs = getComputedStyle(el);
    const sibling = getComputedStyle(document.querySelector('.styles-list li[data-style="realism"]'));
    return { pos: cs.backgroundPosition, clip: cs.webkitBackgroundClip || cs.backgroundClip, siblingOpacity: parseFloat(sibling.opacity) };
  });
  await page.screenshot({ path: SHOT('12-style-sweep.png') });
  check('style hover: ink fill sweeps through the word',
    posBefore !== sweep.pos && sweep.pos.startsWith('100%') && sweep.clip === 'text' && sweep.siblingOpacity < 0.5,
    `pos ${posBefore} -> ${sweep.pos}, clip=${sweep.clip}, sibling=${sweep.siblingOpacity}`);
  await li.click();
  await new Promise(r => setTimeout(r, 400));
  const stylesState = await page.evaluate(() => ({
    count: document.querySelectorAll('.styles-list li').length,
    activeAfterClick: document.querySelector('.gf.active').getAttribute('data-filter'),
    visible: document.querySelectorAll('.gitem:not(.hide)').length,
    total: document.querySelectorAll('.gitem').length,
  }));
  check('styles list: all 6 categories, display-only (click does not filter gallery)',
    stylesState.count === 6 && stylesState.activeAfterClick === 'all' && stylesState.visible === stylesState.total,
    JSON.stringify(stylesState));
  await new Promise(r => setTimeout(r, 200));

  // studio film strip pans with scroll
  async function scrollToStudioP(p) {
    await page.evaluate((p) => {
      const sec = document.querySelector('#studio');
      const y = sec.offsetTop + (sec.offsetHeight - innerHeight) * p;
      if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y);
    }, p);
    await new Promise(r => setTimeout(r, 500));
  }
  await scrollToStudioP(0.2);
  const st20 = await page.evaluate(() => window.__scrubState.studio);
  await scrollToStudioP(0.5);
  await page.screenshot({ path: SHOT('10-studio.png') });
  await scrollToStudioP(0.95);
  const st95 = await page.evaluate(() => window.__scrubState.studio);
  check('studio strip pans with scroll',
    st20.x < st95.x && st95.max > 0 && st95.x > st95.max * 0.9,
    `x ${Math.round(st20.x)} -> ${Math.round(st95.x)} of ${Math.round(st95.max)}`);
  const studioImgs = await page.evaluate(() =>
    [...document.querySelectorAll('.sframe img')].map(i => i.naturalWidth));
  check('studio photos loaded', studioImgs.length === 4 && studioImgs.every(w => w > 0), JSON.stringify(studioImgs));

  // lightbox with navigation (arrows, keys, wheel)
  await page.click('.gitem img');
  await new Promise(r => setTimeout(r, 400));
  const lbOpen = await page.evaluate(() => !document.getElementById('lightbox').hidden);
  const src1 = await page.evaluate(() => document.getElementById('lbImg').src);
  await page.click('#lbNext');
  await new Promise(r => setTimeout(r, 150));
  const src2 = await page.evaluate(() => document.getElementById('lbImg').src);
  await page.keyboard.press('ArrowLeft'); // RTL: forward
  await new Promise(r => setTimeout(r, 150));
  const src3 = await page.evaluate(() => document.getElementById('lbImg').src);
  await new Promise(r => setTimeout(r, 400)); // clear wheel debounce
  await page.mouse.move(720, 450);
  await page.mouse.wheel({ deltaY: 240 });
  await new Promise(r => setTimeout(r, 200));
  const src4 = await page.evaluate(() => document.getElementById('lbImg').src);
  await page.screenshot({ path: SHOT('06-lightbox.png') });
  await page.click('#lbClose');
  check('lightbox opens + navigates via arrow/key/wheel',
    lbOpen && src2 !== src1 && src3 !== src2 && src4 !== src3,
    [src1, src2, src3, src4].map(s => s.split('/').pop()).join(' -> '));

  // nav centered
  const nav = await page.evaluate(() => {
    const r = document.querySelector('.topbar nav').getBoundingClientRect();
    const navCenter = r.left + r.width / 2;
    return { navCenter, viewCenter: innerWidth / 2 };
  });
  check('nav links centered', Math.abs(nav.navCenter - nav.viewCenter) < 8, JSON.stringify(nav));

  // call-only: nav CTA is a phone-call link, no WhatsApp anywhere
  const callState = await page.evaluate(() => ({
    navCta: (document.querySelector('.nav-cta') || {}).getAttribute ? document.querySelector('.nav-cta').getAttribute('href') : null,
    menuCta: document.querySelector('.menu-cta') ? document.querySelector('.menu-cta').getAttribute('href') : null,
    anyWa: !!document.querySelector('[data-wa], a[href*="wa.me"], a[href*="whatsapp"]'),
  }));
  check('nav + menu CTA are call links (no WhatsApp on page)',
    callState.navCta === 'tel:039503487' && callState.menuCta === 'tel:039503487' && !callState.anyWa,
    JSON.stringify(callState));

  // booking is a call CTA (form removed)
  const bookingUi = await page.evaluate(() => {
    const b = document.querySelector('#booking');
    return {
      intro: !!b.querySelector('.booking-intro'),
      callBtn: (b.querySelector('a.btn[href^="tel:"]') || {}).getAttribute ? b.querySelector('a.btn[href^="tel:"]').getAttribute('href') : null,
      noForm: !b.querySelector('#waForm'),
    };
  });
  check('booking is a call CTA (form removed)', bookingUi.intro && bookingUi.callBtn === 'tel:039503487' && bookingUi.noForm, JSON.stringify(bookingUi));

  // social proof strip
  const proof = await page.evaluate(() => {
    const s = document.querySelector('#proof');
    return {
      text: s ? s.textContent : '',
      link: (document.querySelector('.proof-link') || {}).href || '',
      stars: !!document.querySelector('#proof .stars'),
    };
  });
  check('social proof strip: 4.6 / 244 + Google link',
    proof.text.includes('4.6') && proof.text.includes('244') && proof.stars && proof.link.includes('google.com/maps'),
    proof.link);

  // SEO metadata
  const seo = await page.evaluate(() => {
    const og = document.querySelector('meta[property="og:image"]');
    let ld = null;
    try { ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); } catch (e) {}
    return {
      ogImage: og ? og.content : null,
      ldType: ld && ld['@type'],
      reviewCount: ld && ld.aggregateRating && ld.aggregateRating.reviewCount,
      poster: document.querySelector('.hero-video').getAttribute('poster'),
    };
  });
  const posterOk = seo.poster && (await page.evaluate(async (p) => (await fetch(p)).ok, seo.poster));
  check('OG image + JSON-LD (244 reviews) + hero poster',
    !!seo.ogImage && seo.ldType === 'TattooParlor' && seo.reviewCount === 244 && posterOk,
    JSON.stringify(seo));

  // FAQ accordion
  const faqCount = await page.evaluate(() => document.querySelectorAll('#faq details').length);
  await page.click('#faq details:first-of-type summary');
  await new Promise(r => setTimeout(r, 300));
  const faqOpen = await page.evaluate(() => document.querySelector('#faq details').open);
  check('FAQ: 5 items, accordion opens', faqCount === 5 && faqOpen, `items=${faqCount} open=${faqOpen}`);

  // conversion tracking: EVERY tel: CTA records call_click (the Google Ads conversion).
  // click each one with navigation blocked, count call_click events vs links.
  const callTrack = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="tel:"]')];
    const before = (window.__events || []).filter(e => e.name === 'call_click').length;
    links.forEach(a => {
      a.addEventListener('click', e => e.preventDefault(), { once: true });
      a.click();
    });
    const after = (window.__events || []).filter(e => e.name === 'call_click').length;
    return { links: links.length, fired: after - before };
  });
  check('every call CTA fires call_click',
    callTrack.links >= 5 && callTrack.fired === callTrack.links,
    JSON.stringify(callTrack));

  // academy strip
  const academy = await page.evaluate(() => {
    const a = document.querySelector('#academy a');
    const bg = getComputedStyle(document.getElementById('academy')).backgroundColor;
    return { href: a.href, bg };
  });
  check('academy inverted strip links out', academy.href === 'https://www.lizvampireacademy.com/' && academy.bg !== 'rgb(6, 6, 6)', JSON.stringify(academy));

  check('no console errors (desktop)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  // custom 404 (after the console check — this fetch legitimately logs a 404)
  const notFound = await page.evaluate(async () => {
    const r = await fetch(new URL('does-not-exist-xyz', location.href)); // stay within the site's base path
    return { status: r.status, body: await r.text() };
  });
  check('custom 404 page served', notFound.status === 404 && notFound.body.includes('404') && notFound.body.includes('קעקוע'), `status=${notFound.status}`);

  // screenshot of proof + faq
  await page.evaluate(() => {
    const s = document.querySelector('#proof');
    if (window.__lenis) window.__lenis.scrollTo(s, { immediate: true }); else s.scrollIntoView();
  });
  await new Promise(r => setTimeout(r, 900));
  await page.screenshot({ path: SHOT('11-proof-faq.png') });

  /* ================= REDUCED MOTION ================= */
  const rm = await browser.newPage();
  await rm.setViewport({ width: 1440, height: 900 });
  await rm.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await rm.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  const rmState = await rm.evaluate(() => ({
    heroHeight: document.querySelector('#hero').offsetHeight,
    vh: innerHeight,
    mask: getComputedStyle(document.querySelector('.mask-canvas')).display,
    solidTitle: getComputedStyle(document.querySelector('.hero-copy-mobile')).display,
    lenis: !!window.__lenis,
  }));
  await rm.close();
  check('reduced motion: no pinned zoom, static layout + solid title',
    rmState.heroHeight < rmState.vh * 1.3 && rmState.mask === 'none' && rmState.solidTitle === 'flex' && !rmState.lenis,
    JSON.stringify(rmState));

  /* ================= MOBILE (full 3D) ================= */
  const mp = await browser.newPage();
  await mp.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const mpErrors = [];
  mp.on('pageerror', (e) => mpErrors.push(e.message));
  await mp.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await mp.waitForFunction('window.__heroReady === true', { timeout: 20000 });
  await mp.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1200));
  await mp.screenshot({ path: SHOT('08-mobile-hero.png') });

  // hamburger menu: open, navigate, close
  const btnVisible = await mp.evaluate(() => getComputedStyle(document.getElementById('menuBtn')).display !== 'none');
  await mp.tap('#menuBtn');
  await new Promise(r => setTimeout(r, 600));
  const menuState = await mp.evaluate(() => ({
    open: document.getElementById('mobileMenu').classList.contains('open'),
    links: document.querySelectorAll('#mobileMenu nav a').length,
  }));
  await mp.screenshot({ path: SHOT('13-mobile-menu.png') });
  await mp.tap('#mobileMenu nav a[href="#gallery"]');
  await new Promise(r => setTimeout(r, 1600));
  const afterNav = await mp.evaluate(() => ({
    closed: document.getElementById('mobileMenu').hidden,
    galleryNear: Math.abs(document.querySelector('#gallery').getBoundingClientRect().top) < innerHeight * 1.2,
  }));
  check('mobile: hamburger menu opens, navigates, closes',
    btnVisible && menuState.open && menuState.links === 7 && afterNav.closed && afterNav.galleryNear,
    JSON.stringify({ btnVisible, menuState, afterNav }));

  // hero ink-mask runs on mobile (portrait stencil over SD film)
  await mp.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 600));
  const mHero = await mp.evaluate(() => {
    const c = document.querySelector('.mask-canvas');
    const v = document.querySelector('.hero-video');
    const ctx = c.getContext('2d');
    const corner = ctx.getImageData(4, 4, 1, 1).data;
    const row = ctx.getImageData(0, Math.round(c.height * 0.44), c.width, 1).data; // VAMPIRE glyph body
    let holes = 0;
    for (let x = 3; x < row.length; x += 4) if (row[x] < 20) holes++;
    return {
      maskShown: getComputedStyle(c).display !== 'none',
      cornerAlpha: corner[3], holes,
      playing: !v.paused && v.readyState > 2, videoWidth: v.videoWidth,
    };
  });
  check('mobile: ink-mask hero active (portrait stencil + SD film)',
    mHero.maskShown && mHero.cornerAlpha > 240 && mHero.holes > 20 && mHero.playing && mHero.videoWidth === 960,
    JSON.stringify(mHero));

  async function mScrollHeroP(p) {
    await mp.evaluate((p) => {
      const sec = document.querySelector('#hero');
      window.scrollTo(0, (sec.offsetHeight - innerHeight) * p);
    }, p);
    await new Promise(r => setTimeout(r, 500));
  }
  await mScrollHeroP(0.5);
  const mScale = await mp.evaluate(() => window.__scrubState.hero.scale);
  await mp.screenshot({ path: SHOT('14-mobile-hero-mid.png') });
  await mScrollHeroP(0.95);
  const mLate = await mp.evaluate(() => window.__scrubState.hero);
  check('mobile: hero zoom advances and dissolves',
    mScale > 3 && mLate.maskOpacity < 0.05,
    `scale@0.5=${mScale.toFixed(2)} fade@0.95=${mLate.maskOpacity}`);

  // craft scrub on the light frame set
  await mp.evaluate(() => {
    const sec = document.querySelector('#craft');
    window.scrollTo(0, sec.offsetTop + (sec.offsetHeight - innerHeight) * 0.5);
  });
  await new Promise(r => setTimeout(r, 1600));
  const mLine = await mp.evaluate(() => (window.__scrubState.line || {}).frame);
  check('mobile: craft scrub active on light frames', mLine > 10 && mLine < 65, `frame ${mLine} of 72`);

  // studio swipe + sticky bar + clean console
  const mobStrip = await mp.evaluate(() => {
    const t = document.querySelector('.strip-track');
    return {
      swipeable: t.scrollWidth > t.clientWidth + 50,
      transform: getComputedStyle(t).transform,
      bar: getComputedStyle(document.querySelector('.mobile-bar')).display,
    };
  });
  check('mobile: studio swipe carousel + sticky bar',
    mobStrip.swipeable && mobStrip.transform === 'none' && mobStrip.bar === 'flex',
    JSON.stringify(mobStrip));
  check('mobile: no page errors', mpErrors.length === 0, mpErrors.slice(0, 3).join(' | '));

  /* ================= ACCESSIBILITY (IS 5568 / WCAG 2.0 AA) ================= */
  const AXE = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  async function axeViolations(pg) {
    // walk the page so scroll-revealed content is audited in its visible state
    await pg.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); }
      window.scrollTo(0, 0);
      document.querySelectorAll('.reveal').forEach(e => e.classList.add('visible'));
    });
    await wait(600);
    await pg.addScriptTag({ content: AXE });
    return pg.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }))
      .violations.map(v => `${v.id}(${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
  }
  async function freshPage(vp) {
    const ctx = await browser.createBrowserContext();   // clean storage = first-time visitor
    const pg = await ctx.newPage();
    await pg.setViewport(vp);
    return pg;
  }
  const DESK = { width: 1440, height: 900 };
  const MOB = { width: 390, height: 844, isMobile: true, hasTouch: true };

  // automated audit, desktop + mobile, plus every policy page
  const ad = await freshPage(DESK);
  await ad.goto(URL, { waitUntil: 'networkidle2' }); await wait(1500);
  const axeDesk = await axeViolations(ad);
  check('a11y: axe WCAG 2.1 AA — 0 violations (desktop)', axeDesk.length === 0, axeDesk.join(' | '));
  const am = await freshPage(MOB);
  await am.goto(URL, { waitUntil: 'networkidle2' }); await wait(1500);
  const axeMob = await axeViolations(am);
  check('a11y: axe WCAG 2.1 AA — 0 violations (mobile)', axeMob.length === 0, axeMob.join(' | '));
  await am.browserContext().close();
  for (const slug of ['accessibility', 'privacy', 'terms']) {
    const lp = await freshPage(DESK);
    const resp = await lp.goto(URL + slug + '.html', { waitUntil: 'networkidle2' });
    const h1 = await lp.evaluate(() => (document.querySelector('h1') || {}).textContent || '');
    const v = await axeViolations(lp);
    check(`policy page ${slug}.html: 200, has heading, 0 axe violations`, resp.status() === 200 && h1.length > 3 && v.length === 0,
      `status=${resp.status()} h1="${h1}" ${v.join(' | ')}`);
    await lp.browserContext().close();
  }
  const footLinks = await ad.evaluate(() => ['accessibility', 'privacy', 'terms'].every(s => !!document.querySelector(`footer a[href="${s}.html"]`)));
  check('footer links to accessibility / privacy / terms', footLinks);

  // keyboard: skip link is the first stop and lands focus on <main>
  await ad.goto(URL, { waitUntil: 'networkidle2' }); await wait(1500);
  await ad.keyboard.press('Tab');
  const firstStop = await ad.evaluate(() => document.activeElement.className);
  await ad.keyboard.press('Enter'); await wait(400);
  const afterSkip = await ad.evaluate(() => document.activeElement.id);
  check('keyboard: first Tab = skip link, Enter moves focus to main', firstStop === 'skip-link' && afterSkip === 'main', `first=${firstStop} after=${afterSkip}`);

  // visible focus ring
  const ring = await ad.evaluate(() => {
    const a = document.querySelector('.topbar nav a'); a.focus();
    const cs = getComputedStyle(a); return { w: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
  });
  check('keyboard: focus ring is a solid 3px outline', ring.w >= 3 && ring.style === 'solid', JSON.stringify(ring));

  // gallery by keyboard + lightbox as a dialog
  const kbGalTab = await ad.evaluate(() => [...document.querySelectorAll('.gitem')].filter(f => { const b = f.querySelector('button.gitem-open'); return b && b.tabIndex === 0 && b.getAttribute('aria-label'); }).length);
  await ad.evaluate(() => { const f = document.querySelector('.gitem .gitem-open'); f.scrollIntoView({ block: 'center' }); f.focus(); });
  await ad.keyboard.press('Enter'); await wait(300);
  const kbLbOpen = await ad.evaluate(() => ({ open: !document.getElementById('lightbox').hidden, focus: document.activeElement.id }));
  for (let i = 0; i < 5; i++) await ad.keyboard.press('Tab');
  const kbLbTrapped = await ad.evaluate(() => document.getElementById('lightbox').contains(document.activeElement));
  await ad.keyboard.press('Escape'); await wait(200);
  const kbLbBack = await ad.evaluate(() => ({ closed: document.getElementById('lightbox').hidden, back: document.activeElement === document.querySelector('.gitem .gitem-open') }));
  check('keyboard: 40 photos open with Enter; lightbox traps Tab; Esc returns focus',
    kbGalTab === 40 && kbLbOpen.open && kbLbOpen.focus === 'lbClose' && kbLbTrapped && kbLbBack.closed && kbLbBack.back,
    JSON.stringify({ kbGalTab, kbLbOpen, kbLbTrapped, kbLbBack }));

  // accessibility menu: side tab opens/closes, options apply + persist
  const menu0 = await ad.evaluate(() => {
    const t = document.querySelector('.a11y-tab');
    const r = t.getBoundingClientRect();
    return { exists: !!t, label: t.textContent.trim(), rightEdge: Math.round(innerWidth - r.right), expanded: t.getAttribute('aria-expanded') };
  });
  await ad.click('.a11y-tab'); await wait(450);
  const menu1 = await ad.evaluate(() => ({ expanded: document.querySelector('.a11y-tab').getAttribute('aria-expanded'),
    panel: !document.getElementById('a11yPanel').hidden, focusIn: document.getElementById('a11yPanel').contains(document.activeElement),
    opts: document.querySelectorAll('.a11y-opt').length }));
  await ad.keyboard.press('Escape'); await wait(400);
  const menu2 = await ad.evaluate(() => ({ closed: document.getElementById('a11yPanel').hidden, focusTab: document.activeElement.classList.contains('a11y-tab') }));
  check('a11y menu: side tab opens panel, Esc closes and returns focus',
    menu0.exists && menu0.label === 'נגישות' && menu0.rightEdge === 0 && menu1.expanded === 'true' && menu1.panel && menu1.focusIn && menu1.opts === 4 && menu2.closed && menu2.focusTab,
    JSON.stringify({ menu0, menu1, menu2 }));

  await ad.click('.a11y-tab'); await wait(400);
  await ad.click('.a11y-opt[data-opt="contrast"]');
  await ad.click('.a11y-size-ctl [data-size="1"]');
  await ad.click('.a11y-opt[data-opt="links"]');
  await ad.click('.a11y-opt[data-opt="font"]');
  await ad.reload({ waitUntil: 'networkidle2' }); await wait(800);
  const persisted = await ad.evaluate(() => ({
    cls: ['a11y-contrast', 'a11y-text-1', 'a11y-links', 'a11y-font'].filter(c => document.documentElement.classList.contains(c)).length,
    rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    bone: getComputedStyle(document.documentElement).getPropertyValue('--bone').trim(),
    pressed: document.querySelectorAll('.a11y-opt[aria-pressed="true"]').length,
    noHScroll: document.documentElement.scrollWidth <= innerWidth + 1 }));
  check('a11y menu: contrast / text size / links / font apply and persist after reload',
    persisted.cls === 4 && Math.abs(persisted.rootPx - 18.4) < 0.2 && persisted.bone === '#fff' && persisted.pressed === 3 && persisted.noHScroll,
    JSON.stringify(persisted));
  await ad.click('.a11y-tab'); await wait(400);
  await ad.click('.a11y-reset'); await wait(200);
  const resetCls = await ad.evaluate(() => document.documentElement.className);
  check('a11y menu: reset clears every setting', !/a11y-/.test(resetCls), resetCls);

  // stop animations: static layout, no mask zoom, every video paused
  await ad.click('.a11y-tab'); await wait(400);
  await Promise.all([ad.waitForNavigation({ waitUntil: 'networkidle2' }), ad.click('.a11y-opt[data-opt="still"]')]);
  await wait(1500);
  const still = await ad.evaluate(() => ({
    cls: document.documentElement.classList.contains('a11y-still'),
    mask: getComputedStyle(document.querySelector('.mask-canvas')).display,
    solidTitle: getComputedStyle(document.querySelector('.hero-copy-mobile')).display,
    videosPaused: [...document.querySelectorAll('video')].every(v => v.paused),
    lenis: !!window.__lenis }));
  check('a11y menu: "stop animations" = static layout, all videos paused',
    still.cls && still.mask === 'none' && still.solidTitle === 'flex' && still.videosPaused && !still.lenis, JSON.stringify(still));
  await ad.browserContext().close();

  // cookie notice: shown once, dismissal remembered
  const ck = await freshPage(DESK);
  await ck.goto(URL, { waitUntil: 'networkidle2' }); await wait(800);
  const ck1 = await ck.evaluate(() => !!document.querySelector('.cookie-note'));
  await ck.click('.cookie-note button');
  await ck.reload({ waitUntil: 'networkidle2' }); await wait(600);
  const ck2 = await ck.evaluate(() => !!document.querySelector('.cookie-note'));
  check('cookie notice shows on first visit, dismissal remembered', ck1 && !ck2, JSON.stringify({ first: ck1, afterDismiss: ck2 }));

  // 200% browser zoom (1440 wide at 200% = 720 CSS px): no sideways scrolling
  await ck.setViewport({ width: 720, height: 450 });
  await ck.reload({ waitUntil: 'networkidle2' }); await wait(1200);
  const zoom = await ck.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  check('200% zoom: no horizontal scrolling', zoom.sw <= zoom.w + 1, JSON.stringify(zoom));
  await ck.browserContext().close();

  // mobile menu announces state, takes focus, Esc returns it
  const mm = await freshPage(MOB);
  await mm.goto(URL, { waitUntil: 'networkidle2' }); await wait(1200);
  await mm.evaluate(() => document.getElementById('menuBtn').focus());
  await mm.keyboard.press('Enter'); await wait(400);
  const mm1 = await mm.evaluate(() => ({ exp: document.getElementById('menuBtn').getAttribute('aria-expanded'), focusIn: document.getElementById('mobileMenu').contains(document.activeElement) }));
  await mm.keyboard.press('Escape'); await wait(450);
  const mm2 = await mm.evaluate(() => ({ exp: document.getElementById('menuBtn').getAttribute('aria-expanded'), back: document.activeElement.id, hidden: document.getElementById('mobileMenu').hidden }));
  check('mobile menu: aria-expanded, focus moves in, Esc closes and returns focus',
    mm1.exp === 'true' && mm1.focusIn && mm2.exp === 'false' && mm2.back === 'menuBtn' && mm2.hidden, JSON.stringify({ mm1, mm2 }));
  await mm.browserContext().close();

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (failed.length ? `${failed.length} FAILED` : 'ALL ' + results.length + ' CHECKS PASSED'));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('VERIFY CRASHED:', e); process.exit(2); });
