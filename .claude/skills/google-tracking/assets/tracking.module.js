// tracking.module.js — ES module version of tracking.js for React / Vite / Next.
// Copy to src/lib/analytics.js. Call initAutoTracking() once on the client
// (e.g. in a useEffect in the root component); call track() from success callbacks.
// SSR-safe: every function is a no-op when window is undefined.

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

export function track(event, params = {}) {
  if (!isBrowser() || !event) return;
  window.dataLayer = window.dataLayer || [];
  const payload = { event };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') payload[k] = v;
  if (payload.ecommerce) window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push(payload);
}

function locationOf(el) {
  const tagged = el.closest('[data-track-location]');
  if (tagged) return tagged.getAttribute('data-track-location');
  const region = el.closest('header, footer, nav, section[id], main[id], aside[id]');
  return region ? region.id || region.tagName.toLowerCase() : 'body';
}

function contactMethod(href) {
  const h = href.toLowerCase();
  if (h.startsWith('tel:')) return 'phone';
  if (h.startsWith('mailto:')) return 'email';
  if (h.startsWith('whatsapp://') || /^https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com)\//.test(h)) return 'whatsapp';
  return null;
}

function dataParams(el) {
  const out = {};
  for (const a of el.attributes) {
    if (a.name.startsWith('data-track-') && a.name !== 'data-track-event' && a.name !== 'data-track-location') {
      out[a.name.slice(11).replace(/-/g, '_')] = a.value;
    }
  }
  return out;
}

let started = false;
export function initAutoTracking() {
  if (started || !isBrowser()) return;
  started = true;

  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('a[href], [data-track-event]');
    if (!el) return;
    const custom = el.getAttribute('data-track-event');
    if (custom) {
      const p = dataParams(el);
      p.link_location ||= locationOf(el);
      track(custom, p);
      return;
    }
    const href = el.getAttribute('href') || '';
    const method = contactMethod(href);
    if (method) track('contact_click', { method, link_url: href.split('?')[0], link_location: locationOf(el) });
  }, true);

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!form?.hasAttribute?.('data-track-lead')) return;
    if (form.checkValidity && !form.checkValidity()) return;
    track('generate_lead', { form_id: form.getAttribute('data-track-lead') || form.id || 'form', link_location: locationOf(form) });
  }, true);
}
