/* ============ SERVICE PAGES — analytics + Google Ads conversions only ============
   same IDs and labels as js/main.js; keep the two in sync. */
(function () {
  'use strict';

  var GA_ID = 'G-M32DX04HDN'; // GA4 Measurement ID
  var AW_ID = 'AW-18472197461'; // Google Ads conversion ID (account 257-714-8713)
  var AW_CONVERSIONS = {
    call_click: 'JLzeCKmD4IMdENW6nehE', // "Website call click" conversion
    whatsapp_click: 'DzqeCJjpyYsdENW6nehE' // "WhatsApp click" conversion (primary)
  };

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

  /* ---------- conversion event hooks (WhatsApp primary, calls secondary) ---------- */
  document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
    a.addEventListener('click', function () { track('call_click'); });
  });
  document.querySelectorAll('a[href*="wa.me/972542264377"]').forEach(function (a) {
    a.addEventListener('click', function () { track('whatsapp_click'); });
  });
})();
