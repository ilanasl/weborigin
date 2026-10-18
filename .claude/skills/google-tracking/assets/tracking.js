/*
 * tracking.js — tiny dataLayer helper for GTM-based tracking.
 *
 * Plain <script src="/tracking.js" defer></script> exposes window.siteTracking
 * and starts auto-tracking (add data-no-auto to the script tag to skip that).
 * For React/Vite/Next use tracking.module.js instead (same behaviour, SSR-safe).
 *
 * What it does automatically (initAutoTracking):
 *   - contact_click {method: phone|whatsapp|email, link_url, link_location}
 *     for tel:, mailto:, wa.me / api.whatsapp.com / whatsapp:// links
 *   - generate_lead on submit for <form data-track-lead="form_id"> ONLY when the
 *     form has no better success signal. Prefer calling track('generate_lead', ...)
 *     from the real success callback or the thank-you page.
 *   - any element with data-track-event="event_name" (+ data-track-* params) on click
 *
 * link_location is taken from the nearest ancestor with data-track-location,
 * else the nearest <header>/<footer>/<nav>/<section id>, so you can tell
 * "WhatsApp button in hero" from "WhatsApp in footer" without extra code.
 */
(function (root) {
  'use strict';

  function dl() {
    root.dataLayer = root.dataLayer || [];
    return root.dataLayer;
  }

  function track(event, params) {
    if (!event) return;
    var payload = { event: event };
    if (params) for (var k in params) if (params[k] !== undefined && params[k] !== '') payload[k] = params[k];
    // GA4 ecommerce: clear the previous ecommerce object so values don't leak between events
    if (payload.ecommerce) dl().push({ ecommerce: null });
    dl().push(payload);
  }

  function locationOf(el) {
    var tagged = el.closest('[data-track-location]');
    if (tagged) return tagged.getAttribute('data-track-location');
    var region = el.closest('header, footer, nav, section[id], main[id], aside[id]');
    if (!region) return 'body';
    return region.id || region.tagName.toLowerCase();
  }

  function contactMethod(href) {
    var h = href.toLowerCase();
    if (h.indexOf('tel:') === 0) return 'phone';
    if (h.indexOf('mailto:') === 0) return 'email';
    if (h.indexOf('whatsapp://') === 0 || /^https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com)\//.test(h)) return 'whatsapp';
    return null;
  }

  function dataParams(el) {
    var out = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-track-') === 0 && a.name !== 'data-track-event' && a.name !== 'data-track-location') {
        out[a.name.slice(11).replace(/-/g, '_')] = a.value;
      }
    }
    return out;
  }

  var started = false;
  function initAutoTracking() {
    if (started || typeof document === 'undefined') return;
    started = true;

    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('a[href], [data-track-event]') : null;
      if (!el) return;

      var custom = el.getAttribute('data-track-event');
      if (custom) {
        var p = dataParams(el);
        p.link_location = p.link_location || locationOf(el);
        track(custom, p);
        return; // an explicit event wins over the automatic contact_click
      }

      var href = el.getAttribute('href') || '';
      var method = contactMethod(href);
      if (method) {
        track('contact_click', {
          method: method,
          link_url: href.split('?')[0],
          link_location: locationOf(el)
        });
      }
    }, true);

    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || !form.hasAttribute || !form.hasAttribute('data-track-lead')) return;
      if (typeof form.checkValidity === 'function' && !form.checkValidity()) return;
      track('generate_lead', {
        form_id: form.getAttribute('data-track-lead') || form.id || 'form',
        link_location: locationOf(form)
      });
    }, true);
  }

  var api = { track: track, initAutoTracking: initAutoTracking };
  root.siteTracking = api;
  if (typeof document !== 'undefined' && !(document.currentScript && document.currentScript.hasAttribute('data-no-auto'))) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAutoTracking);
    else initAutoTracking();
  }
})(typeof window !== 'undefined' ? window : this);
