/* বাংলা সংবাদ — Google Sheet controlled Ads (GitHub Pages safe)
 *
 * Ads sheet columns:
 * A Position | B Active | C Image URL | D Click URL | E Title | F Ad Code
 *
 * Position: TOP, MIDDLE, MIDDLE TOP, MIDDLE BOTTOM, BOTTOM, ALL
 *
 * Important:
 * - The page must be served from GitHub Pages/HTTP(S), not opened as file://.
 * - Image/banner ads are rendered directly in the page.
 * - Google AdSense snippets are rendered in the parent page (NOT inside an iframe).
 * - Other third-party HTML ad code is isolated in an iframe for safety.
 */
(function () {
  'use strict';

  const SHEET_ID = '1gX73WskIs3D-8IcyPJ24NT0xn1KIEJSjMXOF9nCQqTg';
  const SHEET_NAME = 'Ads';
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
    '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(SHEET_NAME);
  const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
  const DESIGN_WIDTH = 1200;
  const ADSENSE_MIN_HEIGHT = 90;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const val = (row, i) => row && row.c && row.c[i] && row.c[i].v != null
    ? String(row.c[i].v).trim() : '';

  function parseGViz(raw) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) throw new Error('Invalid Google Sheet response');
    const data = JSON.parse(raw.slice(start, end));
    if (data.status && data.status !== 'ok') throw new Error('Google Sheet status: ' + data.status);
    return data.table && Array.isArray(data.table.rows) ? data.table.rows : [];
  }

  function isActive(value) {
    const v = String(value || '').toLowerCase().trim();
    return !v || ['yes', 'true', '1', 'active', 'on', 'হ্যাঁ', 'চালু'].includes(v);
  }

  function normalizePosition(value) {
    const p = String(value || '').toUpperCase().trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
    if (p === 'TOP') return 'TOP';
    if (p === 'BOTTOM' || p === 'FOOTER') return 'BOTTOM';
    if (p === 'MIDDLE TOP' || p === 'MIDDLETOP') return 'MIDDLE_TOP';
    if (p === 'MIDDLE BOTTOM' || p === 'MIDDLEBOTTOM') return 'MIDDLE_BOTTOM';
    if (p === 'MIDDLE') return 'MIDDLE';
    if (p === 'ALL' || p === 'EVERYWHERE' || p === 'ALL POSITIONS') return 'ALL';
    return '';
  }

  function safeUrl(value) {
    const u = String(value || '').trim();
    return /^(https?:|mailto:|tel:)/i.test(u) ? u : '';
  }

  function getSlots() {
    const seen = new Set();
    return Array.from(document.querySelectorAll(
      '.sheet-ad-slot[data-ad-slot],.sheet-ad-slot[data-ad-position],' +
      '.ad-slot[data-ad-slot],.ad-slot[data-ad-position]'
    )).filter(slot => {
      if (seen.has(slot)) return false;
      seen.add(slot);
      return true;
    });
  }

  function canonicalSlotPosition(slot) {
    return normalizePosition(
      slot.getAttribute('data-ad-position') || slot.getAttribute('data-ad-slot') || ''
    );
  }

  function mapSlots(slots) {
    const explicit = slots.map(canonicalSlotPosition);
    if (explicit.every(Boolean)) return explicit;
    if (slots.length === 2) return ['TOP', 'BOTTOM'];
    if (slots.length === 3) return ['TOP', 'MIDDLE', 'BOTTOM'];
    if (slots.length === 4) return ['TOP', 'MIDDLE_TOP', 'MIDDLE_BOTTOM', 'BOTTOM'];
    return [];
  }

  function pick(adSets, position, used) {
    const exact = adSets[position] || [];
    if (exact.length) {
      const index = used[position] || 0;
      used[position] = index + 1;
      return exact[index % exact.length];
    }
    const all = adSets.ALL || [];
    if (all.length) return all[0];
    if (position === 'MIDDLE' && adSets.MIDDLE && adSets.MIDDLE.length) return adSets.MIDDLE[0];
    if ((position === 'MIDDLE_TOP' || position === 'MIDDLE_BOTTOM') && adSets.MIDDLE && adSets.MIDDLE.length) {
      const index = used.MIDDLE || 0;
      used.MIDDLE = index + 1;
      return adSets.MIDDLE[index % adSets.MIDDLE.length];
    }
    return null;
  }

  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-ads-loader-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === 'yes') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.async = true;
      script.src = src;
      script.dataset.adsLoaderSrc = src;
      script.onload = () => { script.dataset.loaded = 'yes'; resolve(); };
      script.onerror = () => reject(new Error('Could not load ad script: ' + src));
      document.head.appendChild(script);
    });
  }

  function extractAdSenseConfig(code) {
    if (!/adsbygoogle/i.test(String(code || '')) || !/data-ad-(client|slot)/i.test(String(code || ''))) {
      return null;
    }
    const doc = new DOMParser().parseFromString(String(code), 'text/html');
    const ins = doc.querySelector('ins.adsbygoogle, ins[data-ad-client][data-ad-slot]');
    if (!ins) return null;
    const client = ins.getAttribute('data-ad-client') || '';
    const slot = ins.getAttribute('data-ad-slot') || '';
    if (!client || !slot) return null;
    return {
      client,
      slot,
      format: ins.getAttribute('data-ad-format') || 'auto',
      responsive: ins.getAttribute('data-full-width-responsive') || 'true',
      style: ins.getAttribute('style') || 'display:block',
      layout: ins.getAttribute('data-ad-layout') || '',
      layoutKey: ins.getAttribute('data-ad-layout-key') || ''
    };
  }

  async function renderAdSense(slot, code, title) {
    const config = extractAdSenseConfig(code);
    if (!config) return false;

    slot.innerHTML = '';
    slot.classList.add('ad-loaded', 'adsense-slot');
    slot.setAttribute('data-ad-loaded', 'yes');
    slot.setAttribute('aria-label', title || 'Advertisement');
    slot.style.minHeight = ADSENSE_MIN_HEIGHT + 'px';

    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.setAttribute('data-ad-client', config.client);
    ins.setAttribute('data-ad-slot', config.slot);
    ins.setAttribute('data-ad-format', config.format);
    ins.setAttribute('data-full-width-responsive', config.responsive);
    if (config.layout) ins.setAttribute('data-ad-layout', config.layout);
    if (config.layoutKey) ins.setAttribute('data-ad-layout-key', config.layoutKey);
    ins.style.cssText = config.style || 'display:block';
    ins.style.display = 'block';
    ins.style.width = '100%';
    ins.style.minWidth = '0';
    slot.appendChild(ins);

    try {
      await loadExternalScript(ADSENSE_SRC);
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
      return true;
    } catch (error) {
      console.warn('AdSense failed to load:', error);
      slot.setAttribute('data-ad-loaded', 'error');
      return false;
    }
  }

  function renderImageAd(slot, imageUrl, clickUrl, title) {
    const src = safeUrl(imageUrl);
    if (!src) return false;
    const href = safeUrl(clickUrl);
    slot.innerHTML = '';

    const img = document.createElement('img');
    img.src = src;
    img.alt = title || 'Advertisement';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.style.cssText = 'display:block;width:100%;height:auto;max-width:100%;object-fit:contain;border:0;margin:0;padding:0;';

    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer sponsored';
      a.style.cssText = 'display:block;width:100%;height:auto;text-decoration:none;';
      a.appendChild(img);
      slot.appendChild(a);
    } else {
      slot.appendChild(img);
    }
    slot.classList.add('ad-loaded');
    slot.setAttribute('data-ad-loaded', 'yes');
    return true;
  }

  function renderThirdPartyCode(slot, code, title) {
    if (!String(code || '').trim()) return false;
    slot.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'sheet-ad-code-wrap';
    wrap.style.cssText = 'position:relative;width:100%;max-width:100%;height:0;margin:0 auto;padding:0;overflow:hidden;display:block;line-height:0;box-sizing:border-box;';

    const iframe = document.createElement('iframe');
    iframe.title = String(title || 'Advertisement');
    iframe.setAttribute('aria-label', String(title || 'Advertisement'));
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('frameborder', '0');
    iframe.style.cssText = 'display:block;position:absolute;left:0;top:0;width:' + DESIGN_WIDTH + 'px;min-width:' + DESIGN_WIDTH + 'px;max-width:none;height:250px;border:0;margin:0;padding:0;background:transparent;overflow:hidden;transform-origin:top left;';

    const doc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=' + DESIGN_WIDTH + ',initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body{width:' + DESIGN_WIDTH + 'px!important;min-width:' + DESIGN_WIDTH + 'px!important;max-width:' + DESIGN_WIDTH + 'px!important;margin:0!important;padding:0!important;overflow:hidden!important;}*{box-sizing:border-box;}</style></head><body style="width:' + DESIGN_WIDTH + 'px;min-width:' + DESIGN_WIDTH + 'px;max-width:' + DESIGN_WIDTH + 'px;margin:0;padding:0;overflow:hidden;line-height:normal;">' + String(code) + '</body></html>';
    iframe.srcdoc = doc;
    wrap.appendChild(iframe);
    slot.appendChild(wrap);

    const fit = () => {
      try {
        const available = Math.max(1, wrap.clientWidth || DESIGN_WIDTH);
        const scale = Math.min(1, available / DESIGN_WIDTH);
        iframe.style.transform = 'scale(' + scale + ')';
        const d = iframe.contentDocument;
        if (!d || !d.body) return;
        const bodyRect = d.body.getBoundingClientRect();
        let h = bodyRect.height || 0;
        d.body.querySelectorAll('*').forEach(el => {
          try {
            const cs = d.defaultView.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.bottom > 0) h = Math.max(h, r.bottom);
          } catch (_) {}
        });
        const scrollH = Math.max(d.documentElement ? d.documentElement.scrollHeight : 0, d.body.scrollHeight || 0);
        const rawH = Math.min(900, Math.max(90, Math.ceil(h || scrollH || 250)));
        iframe.style.height = rawH + 'px';
        wrap.style.height = Math.ceil(rawH * scale) + 'px';
      } catch (_) {}
    };

    iframe.addEventListener('load', () => {
      fit();
      [150, 500, 1200, 2500, 5000].forEach(ms => setTimeout(fit, ms));
      try {
        if (window.ResizeObserver && iframe.contentDocument && iframe.contentDocument.body) {
          const ro = new ResizeObserver(fit);
          ro.observe(iframe.contentDocument.body);
        }
      } catch (_) {}
    });
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(fit);
      ro.observe(wrap);
    } else {
      window.addEventListener('resize', fit, { passive: true });
    }

    slot.classList.add('ad-loaded');
    slot.setAttribute('data-ad-loaded', 'yes');
    return true;
  }

  async function render(slot, ad) {
    if (!ad) {
      slot.innerHTML = '';
      slot.setAttribute('data-ad-loaded', 'no-ad');
      return false;
    }

    if (ad.code) {
      const isAdSense = extractAdSenseConfig(ad.code);
      if (isAdSense) {
        const ok = await renderAdSense(slot, ad.code, ad.title);
        if (ok) return true;
      }
      if (renderThirdPartyCode(slot, ad.code, ad.title)) return true;
    }

    return renderImageAd(slot, ad.image, ad.click, ad.title);
  }

  async function fetchRows() {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = SHEET_URL + '&_=' + Date.now() + '-' + attempt;
        const response = await fetch(url, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'follow'
        });
        if (!response.ok) throw new Error('Ads sheet HTTP ' + response.status);
        return parseGViz(await response.text());
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(700 * (attempt + 1));
      }
    }
    throw lastError || new Error('Ads sheet fetch failed');
  }

  async function load() {
    const slots = getSlots();
    if (!slots.length) return;

    // file:// is the common reason the Sheet request appears to work nowhere on a laptop.
    if (location.protocol === 'file:') {
      console.warn('Ads loader: open this site through GitHub Pages/HTTP(S), not file://.');
      return;
    }

    try {
      const rows = await fetchRows();
      const ads = { TOP: [], MIDDLE: [], MIDDLE_TOP: [], MIDDLE_BOTTOM: [], BOTTOM: [], ALL: [] };

      rows.forEach(row => {
        const position = normalizePosition(val(row, 0));
        if (!position || !Object.prototype.hasOwnProperty.call(ads, position) || !isActive(val(row, 1))) return;
        const ad = {
          code: val(row, 5),
          image: val(row, 2),
          click: val(row, 3),
          title: val(row, 4)
        };
        if (ad.code || ad.image) ads[position].push(ad);
      });

      const positions = mapSlots(slots);
      if (!positions.length || positions.length !== slots.length) {
        console.warn('Ads loader: unsupported slot layout:', slots.length);
        return;
      }

      const used = { TOP: 0, MIDDLE: 0, MIDDLE_TOP: 0, MIDDLE_BOTTOM: 0, BOTTOM: 0, ALL: 0 };
      for (let i = 0; i < slots.length; i++) {
        let position = positions[i];
        if (position === 'MIDDLE' && slots.length === 4) {
          const middleIndex = positions.slice(0, i + 1).filter(x => x === 'MIDDLE').length;
          position = middleIndex === 1 ? 'MIDDLE_TOP' : 'MIDDLE_BOTTOM';
        }
        const attr = position.toLowerCase().replace(/_/g, '-');
        slots[i].setAttribute('data-ad-position', attr);
        slots[i].setAttribute('data-ad-slot', attr);
        const ad = pick(ads, position, used);
        await render(slots[i], ad);
      }
    } catch (error) {
      console.warn('Google Sheet Ads load failed:', error);
      // Keep the original placeholder when the Sheet is unreachable, which makes setup errors visible.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
