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
  const GOOGLE_HIT = /google-analytics\.com\/(g\/)?collect|\/pagead\/(1p-conversion|1p-user-list|viewthroughconversion|conversion)|\/rmkt\/collect|\/ccm\/collect|doubleclick\.net\/pagead/;
  const ADS_CONVERSION = /[?&]label=([^&]+)/; // every Ads conversion hit carries its conversion label
  browser.on('targetcreated', async (t) => {
    if (t.type() !== 'page') return;
    const pg = await t.page();
    if (!pg) return;
    await pg.setRequestInterception(true).catch(() => {});
    pg.on('request', (r) => {
      if (r.isInterceptResolutionHandled()) return;
      if (GOOGLE_HIT.test(r.url())) {
        const m = ADS_CONVERSION.exec(r.url());
        if (m) (pg.__adsLabels = pg.__adsLabels || []).push(m[1]); // which conversion label left the page
        r.respond({ status: 204, body: '' }).catch(() => {});
      }
      else r.continue().catch(() => {});
    });
  });

  // ---- pin the studio clock ----
  // js/common.js picks "call first" or "WhatsApp first" from the studio's opening hours (Israel time) and reads
  // window.__studioNow when it is set. Every page in this suite starts CLOSED (Tue 23:00) unless a check opens it,
  // so the result never depends on when the suite runs. Instants are UTC; Israel is UTC+3 until 25 Oct 2026, UTC+2 after.
  const CLOCK = {
    tueNoon: Date.UTC(2026, 9, 6, 9, 0),        // Tue 12:00 summer time  -> open
    tueNight: Date.UTC(2026, 9, 6, 20, 0),      // Tue 23:00              -> closed
    satNoon: Date.UTC(2026, 9, 10, 9, 0),       // Sat 12:00              -> closed
    fri15: Date.UTC(2026, 9, 9, 12, 0),         // Fri 15:00              -> open
    fri17: Date.UTC(2026, 9, 9, 14, 0),         // Fri 17:00              -> closed
    winter1130: Date.UTC(2026, 11, 1, 9, 30),   // Tue 11:30 winter time  -> open  (a fixed +3 offset would say 12:30)
    winter1030: Date.UTC(2026, 11, 1, 8, 30),   // Tue 10:30 winter time  -> closed (a fixed +3 offset would say 11:30 = open)
  };
  const CLOCK_EXPECT = { tueNoon: 'open', tueNight: 'closed', satNoon: 'closed', fri15: 'open', fri17: 'closed', winter1130: 'open', winter1030: 'closed' };
  const pinClock = async (pg, ms) => { await pg.evaluateOnNewDocument(`window.__studioNow = ${ms};`); return pg; };
  const _newPage = browser.newPage.bind(browser);
  browser.newPage = async () => pinClock(await _newPage(), CLOCK.tueNight);
  const _newContext = browser.createBrowserContext.bind(browser);
  browser.createBrowserContext = async (...args) => {
    const ctx = await _newContext(...args);
    const ctxNewPage = ctx.newPage.bind(ctx);
    ctx.newPage = async () => pinClock(await ctxNewPage(), CLOCK.tueNight);
    return ctx;
  };

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

  // craft: the wide window (js/ink.js) — small 16:9 window on black, then open to full bleed with the copy risen in
  async function craftAt(pg, at) { // at: 'small' = window resting small, 'open' = fully open + reading hold
    await pg.evaluate((at) => {
      const I = window.__ink, W = I.win, vh = innerHeight;
      const y = at === 'small' ? W.top - vh * 0.06 : W.top + vh * I.WIN_TRAVEL + vh * 0.2;
      if (window.__lenis) window.__lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y);
    }, at);
    await new Promise(r => setTimeout(r, 2200));
    return pg.evaluate(() => {
      const I = window.__ink, W = I.win, m = W.media, f = document.querySelector('.win-frame').getBoundingClientRect();
      return { v: +W.v.toFixed(3), copy: I.copyShown(), src: (m.currentSrc || '').replace(/^.*\/assets\//, ''), playing: !m.paused,
        frame: { w: Math.round(f.width), h: Math.round(f.height), op: +getComputedStyle(document.querySelector('.win-frame')).opacity } };
    });
  }
  const cSmall = await craftAt(page, 'small');
  await page.screenshot({ path: SHOT('04-craft-window.png') });
  const cOpen = await craftAt(page, 'open');
  await page.screenshot({ path: SHOT('04-craft.png') });
  check('craft window: rests small and wide (16:9) on black with the HD film, then opens to full bleed and the copy rises',
    Math.abs(cSmall.v - 0.35) < 0.02 && !cSmall.copy && cSmall.frame.op > 0.9 && Math.abs(cSmall.frame.w / cSmall.frame.h - 16 / 9) < 0.03 &&
    cOpen.v === 1 && cOpen.copy && /bw\/line_hd\.mp4$/.test(cOpen.src) && cOpen.playing,
    JSON.stringify({ small: cSmall, open: cOpen }));

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

  // nav pill + menu follow opening hours: closed = WhatsApp (call one tap away), open = call (WhatsApp one tap away)
  const WA_PREFIX = 'https://wa.me/972542264377?text=';
  const callState = await page.evaluate(() => ({
    navCta: document.querySelector('.nav-cta.when-closed').getAttribute('href'),
    navOpen: document.querySelector('.nav-cta.when-open').getAttribute('href'),
    menuCta: document.querySelector('.menu-cta.when-closed').getAttribute('href'),
    menuCall: (document.querySelector('.menu-call.when-closed') || { getAttribute: () => null }).getAttribute('href'),
    menuOpenCta: document.querySelector('.menu-cta.when-open').getAttribute('href'),
    menuOpenAlt: document.querySelector('.menu-call.when-open').getAttribute('href'),
    waLinks: [...document.querySelectorAll('a[href*="wa.me/972542264377"]')].map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })),
  }));
  check('nav pill + menu: WhatsApp when closed (call link kept), call when open (WhatsApp link kept); wa.me prefilled, new tab',
    callState.navCta.startsWith(WA_PREFIX) && callState.menuCta.startsWith(WA_PREFIX) && callState.menuCall === 'tel:039503487' &&
    callState.navOpen === 'tel:039503487' && callState.menuOpenCta === 'tel:039503487' && callState.menuOpenAlt.startsWith(WA_PREFIX) &&
    callState.waLinks.length === 8 && callState.waLinks.every(w => w.href.startsWith(WA_PREFIX) && w.href.length > WA_PREFIX.length && w.target === '_blank' && /noopener/.test(w.rel)),
    JSON.stringify({ nav: callState.navCta.slice(0, 40), menuCall: callState.menuCall, wa: callState.waLinks.length }));

  // booking: closed = WhatsApp button + phone number under it; open = call button + WhatsApp under it (both pairs in the HTML); no form
  const bookingUi = await page.evaluate(() => {
    const b = document.querySelector('#booking');
    return {
      intro: !!b.querySelector('.booking-intro'),
      waBtn: !!b.querySelector('a.btn.when-closed[href*="wa.me/972542264377"]'),
      callBtn: !!b.querySelector('a.btn.when-open[href="tel:039503487"]'),
      waAlt: !!b.querySelector('.booking-alt.when-open a[href*="wa.me/972542264377"]'),
      callAlt: (b.querySelector('.booking-alt.when-closed a[href^="tel:"]') || { getAttribute: () => null }).getAttribute('href'),
      noForm: !b.querySelector('form'),
    };
  });
  check('booking: WhatsApp button + call alternative, and the call button + WhatsApp alternative for opening hours (no form)', bookingUi.intro && bookingUi.waBtn && bookingUi.callAlt === 'tel:039503487' && bookingUi.callBtn && bookingUi.waAlt && bookingUi.noForm, JSON.stringify(bookingUi));

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

  // SEO metadata: title/description keywords, canonical, social preview, business info for Google
  const seo = await page.evaluate(() => {
    const m = (sel) => { const e = document.querySelector(sel); return e ? (e.content || e.getAttribute('href')) : null; };
    let ld = null;
    try { ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); } catch (e) {}
    return {
      title: document.title,
      desc: m('meta[name="description"]'),
      canonical: m('link[rel="canonical"]'),
      ogUrl: m('meta[property="og:url"]'), ogImage: m('meta[property="og:image"]'),
      ogW: m('meta[property="og:image:width"]'), ogSite: m('meta[property="og:site_name"]'),
      twDesc: m('meta[name="twitter:description"]'), theme: m('meta[name="theme-color"]'),
      h1: document.querySelector('h1').textContent,
      ld: ld && { type: ld['@type'], url: ld.url, logo: ld.logo, founding: ld.foundingDate,
        noRating: !ld.aggregateRating, noPostal: !ld.address.postalCode,
        piercing: /פירסינג/.test(JSON.stringify(ld.hasOfferCatalog || {})), coverUp: /כיסוי/.test(JSON.stringify(ld.hasOfferCatalog || {})),
        noAcademy: !/academy/i.test(JSON.stringify(ld.sameAs)),
        geo: ld.geo && [ld.geo.latitude, ld.geo.longitude],
        hours: (ld.openingHoursSpecification || []).map(h => [[].concat(h.dayOfWeek).join(','), h.opens, h.closes].join(' ')),
        whatsapp: (ld.contactPoint || []).some(c => c.telephone === '+972-54-226-4377' && /wa\.me\/972542264377/.test(c.url || '')),
        maps: ld.hasMap === 'https://www.google.com/maps/place/?q=place_id:ChIJhfVWRzm0AhUR0ZRQSdZyE3c' && (ld.sameAs || []).includes(ld.hasMap) },
      faqLd: (() => { try { return [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent)).find(j => j['@type'] === 'FAQPage') || null; } catch (e) { return null; } })(),
      faqVisible: [...document.querySelectorAll('#faq details')].map(d => ({ q: d.querySelector('summary').textContent.trim(), a: d.querySelector('p').textContent.trim() })),
      h1s: [...document.querySelectorAll('h1')].map(h => { const r = h.getBoundingClientRect(); return { t: h.textContent.trim(), w: r.width, h: r.height }; }),
      hoursText: document.body.innerText.match(/\d\d:\d\d–\d\d:\d\d/g) || [],
      poster: document.querySelector('.hero-video').getAttribute('poster'),
    };
  });
  const posterOk = seo.poster && (await page.evaluate(async (p) => (await fetch(p)).ok, seo.poster));
  const logoOk = seo.ld && (await page.evaluate(async (p) => (await fetch(new URL(p).pathname)).ok, seo.ld.logo));
  check('SEO: title + description target "קעקועים" + ראשון לציון, canonical, h1',
    /קעקועים/.test(seo.title) && /ראשון לציון/.test(seo.title) && /קעקועים/.test(seo.desc) && /ראשון לציון/.test(seo.desc) &&
    seo.desc.length <= 155 && seo.canonical === 'https://lizvampiretattoo.com/' && /קעקועים/.test(seo.h1) && seo.theme === '#060606',
    JSON.stringify({ title: seo.title.length, desc: seo.desc.length, canonical: seo.canonical, theme: seo.theme }));
  check('social preview: og url/site/image 1200w/twitter description + hero poster',
    seo.ogUrl === 'https://lizvampiretattoo.com/' && seo.ogImage === 'https://lizvampiretattoo.com/assets/img/og.jpg' &&
    seo.ogW === '1200' && !!seo.ogSite && !!seo.twDesc && posterOk, JSON.stringify({ ogUrl: seo.ogUrl, ogW: seo.ogW, posterOk }));
  check('business info for Google: TattooParlor, url/logo/1996, no rating/postal/academy; offers piercing + cover-ups (since 2026-10-01)',
    seo.ld && seo.ld.type === 'TattooParlor' && seo.ld.url === 'https://lizvampiretattoo.com/' && logoOk && seo.ld.founding === '1996' &&
    seo.ld.noRating && seo.ld.noPostal && seo.ld.piercing && seo.ld.coverUp && seo.ld.noAcademy && seo.ld.geo[0] === 31.9611,
    JSON.stringify(seo.ld));
  check('business info: hours Sun–Thu 11:00–20:00 + Fri 11:00–16:00, WhatsApp contact point, Google Maps place link',
    seo.ld && seo.ld.hours.length === 2 && seo.ld.hours.includes('Sunday,Monday,Tuesday,Wednesday,Thursday 11:00 20:00') && seo.ld.hours.includes('Friday 11:00 16:00') && seo.ld.whatsapp && seo.ld.maps,
    JSON.stringify({ hours: seo.ld && seo.ld.hours, whatsapp: seo.ld && seo.ld.whatsapp, maps: seo.ld && seo.ld.maps }));
  check('visible hours everywhere: Sun–Thu 11:00–20:00 and Fri 11:00–16:00 (nothing else)',
    seo.hoursText.filter(h => h === '11:00–20:00').length >= 2 && seo.hoursText.filter(h => h === '11:00–16:00').length >= 2 &&
    seo.hoursText.every(h => h === '11:00–20:00' || h === '11:00–16:00'), JSON.stringify(seo.hoursText));
  check('FAQPage structured data mirrors the visible FAQ (same questions + answers)',
    !!seo.faqLd && seo.faqLd.mainEntity.length === seo.faqVisible.length &&
    seo.faqLd.mainEntity.every((q, i) => q.name === seo.faqVisible[i].q && q.acceptedAnswer.text === seo.faqVisible[i].a),
    JSON.stringify({ ld: seo.faqLd && seo.faqLd.mainEntity.length, visible: seo.faqVisible.length }));
  check('exactly one H1, visible, says קעקועים בראשון לציון (desktop)',
    seo.h1s.length === 1 && seo.h1s[0].w > 100 && seo.h1s[0].h > 10 && /קעקועים/.test(seo.h1s[0].t) && /ראשון לציון/.test(seo.h1s[0].t),
    JSON.stringify(seo.h1s));
  const crawl = await page.evaluate(async () => {
    const r = await fetch('/robots.txt'); const rt = await r.text();
    const sm = await fetch('/sitemap.xml'); const st = await sm.text();
    const pages = ['', 'realism/', 'black-and-white/', 'color/', 'cover-up/', 'prices/', 'aftercare/', 'piercing/', 'accessibility.html', 'privacy.html', 'terms.html'];
    const locs = (st.match(/<loc>/g) || []).length;
    const served = {};
    for (const u of pages) served[u || '/'] = (await fetch('/' + u)).status;
    return { robots: r.ok && /Sitemap: https:\/\/lizvampiretattoo\.com\/sitemap\.xml/.test(rt),
      sitemap: sm.ok && locs === pages.length && pages.every(u => st.includes('<loc>https://lizvampiretattoo.com/' + u + '</loc>')),
      allServed: Object.values(served).every(s => s === 200), served };
  });
  check('robots.txt points to sitemap.xml; sitemap lists all 11 pages, each one served', crawl.robots && crawl.sitemap && crawl.allServed, JSON.stringify(crawl));

  // FAQ accordion
  const faqCount = await page.evaluate(() => document.querySelectorAll('#faq details').length);
  await page.click('#faq details:first-of-type summary');
  await new Promise(r => setTimeout(r, 300));
  const faqOpen = await page.evaluate(() => document.querySelector('#faq details').open);
  check('FAQ: 6 items (incl. cover-ups), accordion opens', faqCount === 6 && faqOpen, `items=${faqCount} open=${faqOpen}`);

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
    const conv = (window.dataLayer || []).filter(d => d[0] === 'event' && d[1] === 'conversion' && d[2] && d[2].send_to === 'AW-18472197461/JLzeCKmD4IMdENW6nehE').length;
    return { links: links.length, fired: after - before, adsConversions: conv };
  });
  check('every call CTA fires call_click',
    callTrack.links === 8 && callTrack.fired === callTrack.links && callTrack.adsConversions === callTrack.links,
    JSON.stringify(callTrack));

  const waTrack = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="wa.me/972542264377"]')];
    const per = links.map(a => {
      const ev0 = (window.__events || []).filter(e => e.name === 'whatsapp_click').length;
      const cv0 = (window.dataLayer || []).filter(d => d[0] === 'event' && d[1] === 'conversion' && d[2] && d[2].send_to === 'AW-18472197461/DzqeCJjpyYsdENW6nehE').length;
      const call0 = (window.__events || []).filter(e => e.name === 'call_click').length;
      a.addEventListener('click', e => e.preventDefault(), { once: true }); // don't open WhatsApp in the test browser
      a.click();
      return {
        ev: (window.__events || []).filter(e => e.name === 'whatsapp_click').length - ev0,
        cv: (window.dataLayer || []).filter(d => d[0] === 'event' && d[1] === 'conversion' && d[2] && d[2].send_to === 'AW-18472197461/DzqeCJjpyYsdENW6nehE').length - cv0,
        call: (window.__events || []).filter(e => e.name === 'call_click').length - call0,
      };
    });
    return { links: links.length, exactlyOne: per.every(p => p.ev === 1 && p.cv === 1 && p.call === 0), per };
  });
  check('every WhatsApp link fires exactly one whatsapp_click → AW-18472197461/DzqeCJjpyYsdENW6nehE',
    waTrack.links === 8 && waTrack.exactlyOne, JSON.stringify({ links: waTrack.links, exactlyOne: waTrack.exactlyOne }));

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
    links: [...document.querySelectorAll('#mobileMenu nav a')].filter(a => getComputedStyle(a).display !== 'none').length,
  }));
  await mp.screenshot({ path: SHOT('13-mobile-menu.png') });
  await mp.tap('#mobileMenu nav a[href="#gallery"]');
  await new Promise(r => setTimeout(r, 1600));
  const afterNav = await mp.evaluate(() => ({
    closed: document.getElementById('mobileMenu').hidden,
    galleryNear: Math.abs(document.querySelector('#gallery').getBoundingClientRect().top) < innerHeight * 1.2,
  }));
  check('mobile: hamburger menu opens, navigates, closes',
    btnVisible && menuState.open && menuState.links === 8 && afterNav.closed && afterNav.galleryNear,
    JSON.stringify({ btnVisible, menuState, afterNav }));

  // hero ink-mask runs on mobile (portrait stencil over SD film)
  await mp.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 600));
  const mHero = await mp.evaluate(() => {
    const c = document.querySelector('.mask-canvas');
    const v = document.querySelector('.hero-video');
    const ctx = c.getContext('2d');
    const corner = ctx.getImageData(4, 4, 1, 1).data;
    const vamp = document.querySelectorAll('.hero-title-m span')[1].getBoundingClientRect(), cr = c.getBoundingClientRect();
    const row = ctx.getImageData(0, Math.round((vamp.top + vamp.height / 2 - cr.top) * c.height / cr.height), c.width, 1).data; // VAMPIRE glyph body
    let holes = 0;
    for (let x = 3; x < row.length; x += 4) if (row[x] < 20) holes++;
    return {
      maskShown: getComputedStyle(c).display !== 'none',
      cornerAlpha: corner[3], holes,
      film: v.currentSrc, poster: v.getAttribute('poster'),
    };
  });
  check('mobile: ink-mask hero active (portrait stencil over the poster still, no film)',
    mHero.maskShown && mHero.cornerAlpha > 240 && mHero.holes > 20 && mHero.film === '' && /hero-poster-m\.jpg$/.test(mHero.poster),
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

  // craft window on a phone: the lighter 720p cut, wide window, opens with the copy
  const mSmall = await craftAt(mp, 'small');
  const mOpen = await craftAt(mp, 'open');
  check('mobile: craft window rests small and wide, opens with the copy, on the lighter 720p film',
    Math.abs(mSmall.v - 0.35) < 0.02 && Math.abs(mSmall.frame.w / mSmall.frame.h - 16 / 9) < 0.03 && mOpen.v === 1 && mOpen.copy &&
    /bw\/line\.mp4$/.test(mOpen.src), JSON.stringify({ small: mSmall, open: mOpen }));

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
  const gal0 = await mp.evaluate(() => ({
    shown: [...document.querySelectorAll('.gitem')].filter(g => g.getBoundingClientRect().height > 0).length,
    total: document.querySelectorAll('.gitem').length,
    btn: !document.querySelector('.gallery-more').hidden,
  }));
  await mp.evaluate(() => { const b = document.querySelector('.gallery-more'); b.scrollIntoView({ block: 'center' }); });
  await new Promise(r => setTimeout(r, 300));
  await mp.tap('.gallery-more');
  await new Promise(r => setTimeout(r, 400));
  const gal1 = await mp.evaluate(() => ({
    shown: [...document.querySelectorAll('.gitem')].filter(g => g.getBoundingClientRect().height > 0).length,
    btnHidden: document.querySelector('.gallery-more').hidden,
  }));
  check('mobile: gallery opens with 12 works + one "show all" button that reveals all 40',
    gal0.shown === 12 && gal0.total === 40 && gal0.btn && gal1.shown === 40 && gal1.btnHidden, JSON.stringify({ gal0, gal1 }));
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
    // the text rises / fades in on a clock (GSAP, once): audit the settled page, not a half-faded button
    await pg.evaluate(async () => {
      const pending = () => [...document.querySelectorAll('[data-fade], [data-split], [data-rise-group] > *')]
        .filter(e => e.offsetParent !== null && parseFloat(getComputedStyle(e).opacity) < 0.99).length;
      for (let i = 0; i < 40 && pending(); i++) await new Promise(r => setTimeout(r, 150));
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


  /* ================= HOURS-AWARE CTA (call first while open, WhatsApp first when closed) ================= */
  {
    const WA_LABEL = 'DzqeCJjpyYsdENW6nehE', CALL_LABEL = 'JLzeCKmD4IMdENW6nehE';
    const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

    // the class on <html> for each pinned instant (same page, clock moved + re-checked)
    const clk = await freshPage(DESK);
    await clk.goto(URL, { waitUntil: 'domcontentloaded' });
    const classes = await clk.evaluate((CLOCK) => {
      const out = {};
      for (const k in CLOCK) {
        window.__studioNow = CLOCK[k]; window.__studioRefresh();
        const c = document.documentElement.classList;
        out[k] = c.contains('studio-open') && !c.contains('studio-closed') ? 'open' : c.contains('studio-closed') && !c.contains('studio-open') ? 'closed' : 'neither';
      }
      return out;
    }, CLOCK);
    check('hours: <html> is studio-open Sun–Thu 11–20 + Fri 11–16 Israel time, studio-closed otherwise (Tue 12:00, Tue 23:00, Sat 12:00, Fri 15:00, Fri 17:00, winter-time offsets)',
      Object.keys(CLOCK_EXPECT).every(k => classes[k] === CLOCK_EXPECT[k]), JSON.stringify(classes));
    await clk.browserContext().close();

    // one real tap on a link; returns what it fired (site events + the Ads conversion request that left the page)
    async function tap(pg, sel) {
      const count = () => pg.evaluate(() => {
        const sent = (label) => (window.dataLayer || []).filter(d => d[0] === 'event' && d[1] === 'conversion' && d[2] && d[2].send_to === 'AW-18472197461/' + label).length;
        return { wa: (window.__events || []).filter(e => e.name === 'whatsapp_click').length, call: (window.__events || []).filter(e => e.name === 'call_click').length,
          cvWa: sent('DzqeCJjpyYsdENW6nehE'), cvCall: sent('JLzeCKmD4IMdENW6nehE') };
      });
      const before = await count();
      const n0 = (pg.__adsLabels || []).length;
      const geo = await pg.evaluate(async (sel) => {
        const a = document.querySelector(sel);
        if (!a) return { missing: true };
        if (getComputedStyle(a.closest('.mobile-bar') || a).position !== 'fixed') {
          window.scrollTo(0, a.getBoundingClientRect().top + scrollY - innerHeight / 2);
          await new Promise(r => setTimeout(r, 1400)); // scroll-reveal fade
        }
        const r = a.getBoundingClientRect();
        const hit = r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), shown: r.width > 0 && r.height > 0 && +getComputedStyle(a).opacity > 0.9,
          uncovered: !!hit && (hit === a || a.contains(hit)), href: a.getAttribute('href'), text: a.innerText.replace(/\s+/g, ' ').trim(), name: a.getAttribute('aria-label') };
      }, sel);
      if (geo.missing || !geo.shown || !geo.uncovered) return { geo, fired: null };
      await (await pg.$(sel)).click();
      for (let i = 0; i < 40 && (pg.__adsLabels || []).length === n0; i++) await wait(100);
      await wait(500); // a duplicate would arrive right behind the first
      const after = await count();
      // ads = the distinct conversion labels on the requests that left the page after the tap (answered locally with 204)
      return { geo, fired: { wa: after.wa - before.wa, call: after.call - before.call, cvWa: after.cvWa - before.cvWa, cvCall: after.cvCall - before.cvCall, ads: [...new Set((pg.__adsLabels || []).slice(n0))] } };
    }
    const firedOnlyWa = t => !!t.fired && t.fired.wa === 1 && t.fired.call === 0 && t.fired.cvWa === 1 && t.fired.cvCall === 0 && t.fired.ads.length === 1 && t.fired.ads[0] === WA_LABEL;
    const firedOnlyCall = t => !!t.fired && t.fired.call === 1 && t.fired.wa === 0 && t.fired.cvCall === 1 && t.fired.cvWa === 0 && t.fired.ads.length === 1 && t.fired.ads[0] === CALL_LABEL;
    const gone = (pg, sel) => pg.evaluate((sel) => [...document.querySelectorAll(sel)].every(e => e.getBoundingClientRect().width === 0), sel);

    const barGeo = {};
    for (const [state, ms] of [['closed', CLOCK.tueNight], ['closed-sat', CLOCK.satNoon], ['open', CLOCK.tueNoon]]) {
      const open = state === 'open';
      const pg = await freshPage(PHONE);
      await pinClock(pg, ms);
      // taps must not leave the page (no WhatsApp tab, no dialler); the site's own click listeners still run
      await pg.evaluateOnNewDocument(() => document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a[href^="tel:"],a[href*="wa.me"]')) e.preventDefault(); }, true));
      await pg.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 }); await wait(1500);
      await pg.evaluate(() => { const b = document.querySelector('.cookie-note button'); if (b) b.click(); });
      await wait(300);
      const cls = await pg.evaluate(() => document.documentElement.className);
      const barH = await pg.evaluate(() => Math.round(document.querySelector('.mobile-bar').getBoundingClientRect().height));

      const wide = open ? '.mobile-bar .mb-call' : '.mobile-bar .mb-wa', narrow = open ? '.mobile-bar .mb-wa' : '.mobile-bar .mb-call';
      const tWide = await tap(pg, wide), tNarrow = await tap(pg, narrow);
      barGeo[state] = { wide: { x: tWide.geo.x, w: tWide.geo.w, h: tWide.geo.h }, narrow: { x: tNarrow.geo.x, w: tNarrow.geo.w, h: tNarrow.geo.h }, barH };
      const wideText = open ? /התקשרו לייעוץ חינם.*פתוחים עכשיו/ : /שלחו וואטסאפ לייעוץ חינם.*סגורים עכשיו, נחזור אליכם/;
      const narrowText = open ? /^וואטסאפ/ : /^חיוג$/;
      const callName = await pg.evaluate(() => document.querySelector('.mobile-bar .mb-call').getAttribute('aria-label'));
      check(`phone bar (${state}): ${open ? 'CALL' : 'WHATSAPP'} is the wide button, ${open ? 'WhatsApp' : 'call'} the narrow one — visible, uncovered, ≥44px, bar 68px, labels right`,
        new RegExp(open ? 'studio-open' : 'studio-closed').test(cls) && barH === 68 &&
        tWide.geo.shown && tWide.geo.uncovered && tWide.geo.w >= 250 && tWide.geo.h >= 44 && wideText.test(tWide.geo.text) &&
        tNarrow.geo.shown && tNarrow.geo.uncovered && tNarrow.geo.w >= 44 && tNarrow.geo.w <= 90 && tNarrow.geo.h >= 44 && narrowText.test(tNarrow.geo.text) &&
        /חיוג לסטודיו: 03-9503487$/.test(callName) && (open ? /^התקשרו לייעוץ חינם/.test(callName) : callName === 'חיוג לסטודיו: 03-9503487'),
        JSON.stringify({ cls: cls.match(/studio-\w+/g), barH, wide: tWide.geo, narrow: tNarrow.geo, callName }));
      check(`phone bar (${state}): each button fires exactly its own conversion (one site event, one Ads conversion, only its own label on the wire)`,
        (open ? firedOnlyCall(tWide) && firedOnlyWa(tNarrow) : firedOnlyWa(tWide) && firedOnlyCall(tNarrow)),
        JSON.stringify({ wide: tWide.fired, narrow: tNarrow.fired }));

      if (state !== 'closed-sat') {
        // #booking: the solid button and the text alternative swap; the other pair is display:none (can't be tapped)
        const main = open ? '#booking a.btn.when-open' : '#booking a.btn.when-closed';
        const alt = open ? '#booking .booking-alt.when-open a' : '#booking .booking-alt.when-closed a';
        const hiddenPair = open ? '#booking .when-closed' : '#booking .when-open';
        const tMain = await tap(pg, main), tAlt = await tap(pg, alt);
        const hidden = await gone(pg, hiddenPair);
        check(`booking (${state}): main button = ${open ? '«התקשרו עכשיו» (tel)' : '«שלחו וואטסאפ»'}, second option = ${open ? 'WhatsApp' : 'phone'}; the other pair is not rendered`,
          tMain.geo.shown && tMain.geo.uncovered && tMain.geo.h >= 44 && (open ? tMain.geo.href === 'tel:039503487' && /התקשרו עכשיו/.test(tMain.geo.text) : /wa\.me\/972542264377/.test(tMain.geo.href) && /שלחו וואטסאפ/.test(tMain.geo.text)) &&
          tAlt.geo.shown && tAlt.geo.uncovered && (open ? /wa\.me\/972542264377/.test(tAlt.geo.href) : tAlt.geo.href === 'tel:039503487') && hidden,
          JSON.stringify({ main: tMain.geo, alt: tAlt.geo, hidden }));
        check(`booking (${state}): both links fire exactly their own conversion`,
          (open ? firedOnlyCall(tMain) && firedOnlyWa(tAlt) : firedOnlyWa(tMain) && firedOnlyCall(tAlt)),
          JSON.stringify({ main: tMain.fired, alt: tAlt.fired }));
      }

      if (open) {
        const v = await axeViolations(pg);
        check('a11y: axe WCAG 2.1 AA — 0 violations (mobile, studio open)', v.length === 0, v.join(' | '));
        // the hours flip without a reload: move the clock to closing time and re-check
        const flipped = await pg.evaluate((ms) => {
          window.__studioNow = ms; window.__studioRefresh();
          const wa = document.querySelector('.mobile-bar .mb-wa').getBoundingClientRect(), call = document.querySelector('.mobile-bar .mb-call');
          return { cls: document.documentElement.className.match(/studio-\w+/g), waW: Math.round(wa.width), callW: Math.round(call.getBoundingClientRect().width), callName: call.getAttribute('aria-label') };
        }, CLOCK.tueNight);
        check('hours flip live (no reload): at closing time WhatsApp becomes the wide button and the call label resets',
          flipped.cls.length === 1 && flipped.cls[0] === 'studio-closed' && flipped.waW >= 250 && flipped.callW <= 90 && flipped.callName === 'חיוג לסטודיו: 03-9503487', JSON.stringify(flipped));
      }
      await pg.browserContext().close();
    }
    const same = (a, b) => a.x === b.x && a.w === b.w && a.h === b.h;
    check('phone bar: identical geometry in both states (wide button right, narrow left, same height — nothing shifts when the hours flip)',
      same(barGeo.open.wide, barGeo.closed.wide) && same(barGeo.open.narrow, barGeo.closed.narrow) && barGeo.open.barH === barGeo.closed.barH && barGeo.open.wide.x > barGeo.open.narrow.x,
      JSON.stringify(barGeo));

    // desktop while open: the top-bar pill stays WhatsApp, #booking shows the call button; axe clean
    const dk = await freshPage(DESK);
    await pinClock(dk, CLOCK.tueNoon);
    await dk.goto(URL, { waitUntil: 'networkidle2' }); await wait(1500);
    const dkState = await dk.evaluate(() => {
      const shown = s => { const e = document.querySelector(s); return !!e && e.getBoundingClientRect().width > 0; };
      const navShown = [...document.querySelectorAll('.nav-cta')].filter(a => a.getBoundingClientRect().width > 0);
      return { cls: document.documentElement.className.match(/studio-\w+/g), nav: navShown.length === 1 ? navShown[0].getAttribute('href').slice(0, 26) : 'shown:' + navShown.length,
        callBtn: shown('#booking a.btn.when-open[href="tel:039503487"]'), waBtn: shown('#booking a.btn.when-closed'), waAlt: shown('#booking .booking-alt.when-open a[href*="wa.me/972542264377"]') };
    });
    const dkAxe = await axeViolations(dk);
    check('desktop (studio open): nav pill is the call button, #booking leads with the call button, axe 0 violations',
      dkState.cls[0] === 'studio-open' && dkState.nav === 'tel:039503487' && dkState.callBtn && !dkState.waBtn && dkState.waAlt && dkAxe.length === 0,
      JSON.stringify(dkState) + ' ' + dkAxe.join(' | '));
    await dk.browserContext().close();
  }

  /* ================= PHONE FIRST SCREEN: brand title, H1 and address line as one group ================= */
  {
    // real-phone sizes, incl. 393x660 = an iPhone 15 Pro with the browser bars showing; each with the cookie strip shown, then dismissed
    const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1';
    const SIZES = [[393, 660], [390, 844], [375, 667], [360, 640], [320, 568]];
    const measureHero = (pg) => pg.evaluate(() => {
      const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; };
      const q = (s) => document.querySelector(s);
      // the painted title = the canvas rows/columns that have punched-out (transparent) pixels
      const c = q('.mask-canvas'), k = c.height / c.getBoundingClientRect().height;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let top = -1, bottom = -1, left = c.width, right = 0;
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) if (d[(y * c.width + x) * 4 + 3] < 40) { if (top < 0) top = y; bottom = y; if (x < left) left = x; if (x > right) right = x; }
      const sub = q('.hero-sub');
      return { title: { t: top / k, b: bottom / k, l: left / k, r: right / k }, h1: R(q('.hero-h1')), meta: R(q('.hero-meta')), h1Text: q('.hero-h1').textContent.trim(),
        subOpacity: parseFloat(getComputedStyle(sub).opacity), cookie: R(q('.cookie-note')), bar: R(q('.mobile-bar')), topbar: R(q('.topbar')), tab: R(q('.a11y-tab')),
        thumbs: document.querySelectorAll('.hero-thumbs, .hero-thumbs-label, #hero img').length,
        hscroll: document.documentElement.scrollWidth - innerWidth, w: innerWidth };
    });
    const hits = (a, b) => !!a && !!b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const problems = [], seen = {};
    for (const [w, h] of SIZES) {
      const pg = await freshPage({ width: w, height: h, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await pg.setUserAgent(IPHONE_UA);
      await pg.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
      await pg.waitForFunction('window.__heroReady === true', { timeout: 20000 });
      // the title is punched once its face has arrived (a web font, 3s fallback): wait for the letters themselves,
      // so a slow font download on a cold cache can't decide the result
      await pg.waitForFunction(() => {
        const c = document.querySelector('.mask-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 40) return true;
        return false;
      }, { timeout: 15000, polling: 250 }).catch(() => {});
      await wait(1000);
      const shown = await measureHero(pg);
      await pg.click('.cookie-note button'); await wait(500);
      const gone = await measureHero(pg);
      const key = `${w}x${h}`;
      seen[key] = { gap: Math.round(shown.h1.t - shown.title.b), h1Top: Math.round(shown.h1.t), h1TopAfter: Math.round(gone.h1.t) };
      for (const [name, m] of [['cookie shown', shown], ['cookie dismissed', gone]]) {
        const at = `${key} ${name}: `;
        if (!(m.title.t >= 0 && m.title.b > m.title.t)) problems.push(at + 'title not painted');
        if (!(m.h1.t - m.title.b >= 8)) problems.push(at + `title and H1 overlap or touch (gap ${Math.round(m.h1.t - m.title.b)}px)`);
        if (!(m.meta.t >= m.h1.b - 1)) problems.push(at + 'address line not under the H1');
        if (!(m.subOpacity > 0.9 && m.h1.l >= 0 && m.h1.r <= m.w && m.meta.b <= m.bar.t)) problems.push(at + 'H1/address line not fully visible above the contact bar');
        for (const box of [m.h1, m.meta]) for (const [what, over] of [['cookie strip', m.cookie], ['contact bar', m.bar], ['top bar', m.topbar], ['accessibility tab', m.tab]]) if (hits(box, over)) problems.push(at + `text covered by the ${what}`);
        if (hits(m.title, m.tab) || hits(m.title, m.topbar) || hits(m.title, m.cookie) || hits(m.title, m.bar)) problems.push(at + 'title touches a bar or the accessibility tab');
        if (m.hscroll > 0) problems.push(at + `horizontal overflow ${m.hscroll}px`);
        if (m.thumbs !== 0) problems.push(at + 'gallery preview still in the hero');
        if (!/סטודיו לקעקועים בראשון לציון/.test(m.h1Text)) problems.push(at + 'H1 text');
      }
      if (!shown.cookie || gone.cookie) problems.push(key + ': cookie strip did not show / dismiss');
      if (Math.abs(shown.h1.t - gone.h1.t) > 1 || Math.abs(shown.title.t - gone.title.t) > 1) problems.push(key + `: hero text moved when the cookie strip was dismissed (${shown.h1.t} -> ${gone.h1.t})`);
      await pg.browserContext().close();
    }
    check('phone first screen (393x660, 390x844, 375x667, 360x640, 320x568 · cookie strip shown + dismissed): title, H1 and address line never overlap (gap ≥ 8px), nothing covers them, the strip does not move them, no sideways scroll, no gallery preview',
      problems.length === 0, problems.length ? problems.slice(0, 6).join(' | ') : JSON.stringify(seen));
  }

  /* ================= MOBILE LOAD WEIGHT (Google Ads landing-page experience) ================= */
  {
    const ctx = await browser.createBrowserContext();
    const pp = await ctx.newPage();
    await pp.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const reqs = [];
    pp.on('request', r => reqs.push(r.url()));
    let barAtDCL = null;
    pp.on('domcontentloaded', async () => {
      barAtDCL = await pp.evaluate(() => {
        const links = [...document.querySelectorAll('.mobile-bar a')];
        const ok = links.map(a => { const r = a.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && a.contains(hit); });
        return { tappable: links.length === 2 && ok.every(Boolean), loaderUp: !document.getElementById('loader').classList.contains('done') };
      }).catch(e => ({ err: e.message }));
    });
    await pp.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 1500));
    const film = await pp.evaluate(async () => { const v = document.querySelector('.hero-video'); return { src: v.currentSrc, poster: v.poster, posterOk: (await fetch(v.poster)).ok }; });
    const filmRequested = reqs.filter(u => /hero_(sd|hd)\.mp4/.test(u));
    check('phone: hero shows the small poster still and downloads NO hero film',
      film.src === '' && /hero-poster-m\.jpg$/.test(film.poster) && film.posterOk && filmRequested.length === 0, JSON.stringify({ film, filmRequested }));
    const earlyFilms = reqs.filter(u => /(studio|reveal|line|line_hd)\.mp4/.test(u));
    check('phone: below-the-fold films are not downloaded at page load', earlyFilms.length === 0, earlyFilms.join(' | '));
    check('phone: both bar buttons are tappable from the first frame (above the loading screen)', barAtDCL && barAtDCL.tappable, JSON.stringify(barAtDCL));
    // scroll to the story film + gallery: film starts on approach, grid uses the 600px copies
    await pp.evaluate(() => document.getElementById('story').scrollIntoView());
    await new Promise(r => setTimeout(r, 1500));
    const story = await pp.evaluate(() => { const v = document.querySelector('.bd[data-bd="story"] video'); return { src: v.currentSrc, playing: !v.paused }; });
    await pp.evaluate(() => document.querySelector('.gallery-grid').scrollIntoView());
    await new Promise(r => setTimeout(r, 1500));
    const grid = await pp.evaluate(() => { const i = document.querySelector('.gitem img'); return { cur: i.currentSrc, full: i.src }; });
    check('phone: story film loads when scrolled near; gallery grid uses 600px copies, lightbox keeps full size',
      /studio\.mp4$/.test(story.src) && story.playing && /\/sm\/w\d\d\.jpg$/.test(grid.cur) && /\/work\/w\d\d\.jpg$/.test(grid.full),
      JSON.stringify({ story, grid }));
    await ctx.close();
  }
  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (failed.length ? `${failed.length} FAILED` : 'ALL ' + results.length + ' CHECKS PASSED'));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('VERIFY CRASHED:', e); process.exit(2); });
