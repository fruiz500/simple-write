/* Simple Write: zoom, ruler (margins and tab stops), tab layout, picture handles */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const L = SW.layout = {};
  const IN = 96;                                   // CSS pixels per inch
  const page = $('page'), scroller = $('scroller'), root = $('doc');
  const zoom = () => parseFloat(page.style.zoom || '1') || 1;
  const inch = (v) => parseFloat(v) / (/cm/.test(v) ? 2.54 : /mm/.test(v) ? 25.4 : /pt/.test(v) ? 72 : 1);
  const r2 = (n) => Math.round(n * 100) / 100;
  SW.units = () => (SW.store.get('sw.units') === 'cm' ? 'cm' : 'in');
  const CM = () => SW.units() === 'cm';
  const fmtLen = (v) => (CM() ? r2(v * 2.54) + 'cm' : r2(v) + 'in');   // v in inches

  /* ---------- zoom ---------- */
  let fit = false;
  const paperPx = () => SW.paperInfo(ed.settings().paper).w * IN;
  L.setZoom = function (v, keep) {
    fit = v === 'fit';
    let z = fit ? (scroller.clientWidth - 48) / paperPx() : parseFloat(v);
    z = Math.max(0.4, Math.min(3, z || 1));
    z = Math.round(z * 100) / 100;
    page.style.zoom = z; $('ruler').style.zoom = z;
    const sel = $('sel-zoom');
    let opt = [...sel.options].find((o) => o.value !== 'fit' && Math.abs(parseFloat(o.value) - z) < 0.004);
    if (!opt) {
      opt = $('zoom-custom') || Object.assign(document.createElement('option'), { id: 'zoom-custom' });
      opt.value = String(z); opt.textContent = Math.round(z * 100) + '%'; sel.appendChild(opt);
    }
    sel.value = fit ? 'fit' : opt.value;
    $('zoom-range').value = Math.round(z * 100);
    if (!keep) SW.store.set('sw.zoom', fit ? 'fit' : String(z));
    L.updateRuler(); L.updateHandles(); ed.positionBars(); ed.updateStats(); SW.hf.paintSoon();
  };
  L.zoomBy = (d) => L.setZoom(zoom() + d);
  $('sel-zoom').addEventListener('change', () => L.setZoom($('sel-zoom').value));
  $('zoom-range').addEventListener('input', () => L.setZoom($('zoom-range').value / 100));
  window.addEventListener('resize', () => { if (fit) L.setZoom('fit', true); L.updateRuler(); L.updateHandles(); });
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || SW.doc.view !== 'doc') return;
    e.preventDefault(); L.zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || document.querySelector('dialog[open]')) return;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); L.zoomBy(0.1); }
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); L.zoomBy(-0.1); }
    else if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); L.setZoom(1); }
  });

  /* ---------- tab characters: each one stretches to the next tab stop ---------- */
  function blockOf(el) { return el.closest('li, td, th, p, h1, h2, h3, h4, h5, h6, blockquote, div') || root; }
  L.layoutTabs = function () {
    const tabs = [...root.querySelectorAll('.tab')];
    if (!tabs.length || SW.doc.view !== 'doc') return;
    const stops = ed.settings().tabs.map((v) => v * IN), z = zoom(), step = IN / 2;
    const last = stops.length ? stops[stops.length - 1] : 0;
    tabs.forEach((t) => { t.style.width = '0px'; });
    for (const t of tabs) {
      const b = blockOf(t.parentNode), br = b.getBoundingClientRect(), cs = getComputedStyle(b);
      const left = br.left + (parseFloat(cs.paddingLeft) || 0) * z + (parseFloat(cs.borderLeftWidth) || 0) * z;
      const right = br.right - (parseFloat(cs.paddingRight) || 0) * z;
      const x = (t.getBoundingClientRect().left - left) / z;
      let next = stops.find((s) => s > x + 1);
      if (next === undefined) next = last + Math.ceil((x - last + 1) / step) * step;
      const room = (right - t.getBoundingClientRect().left) / z;
      t.style.width = Math.max(4, Math.min(next - x, room > 4 ? room : next - x)) + 'px';
    }
  };
  let tabRaf = 0;
  L.layoutTabsSoon = () => { cancelAnimationFrame(tabRaf); tabRaf = requestAnimationFrame(L.layoutTabs); };
  root.addEventListener('input', L.layoutTabsSoon);
  const origRefresh = ed.refresh;
  ed.refresh = function () { origRefresh.apply(this, arguments); L.layoutTabs(); L.updateHandles(); };

  /* ---------- ruler: margins and tab stops ---------- */
  const ruler = $('ruler');
  const geoWrite = (m) => {                          // m: margins in inches
    const fm = SW.doc.fm, f = fmtLen;
    const same = m.l === m.r && m.r === m.t && m.t === m.b;
    SW.setMeta(fm, 'geometry', same ? (Math.abs(m.l - 1) < 0.005 ? null : 'margin=' + f(m.l)) : 'left=' + f(m.l) + ',right=' + f(m.r) + ',top=' + f(m.t) + ',bottom=' + f(m.b));
  };
  const curMargins = () => { const s = ed.settings(); return { l: inch(s.ml), r: inch(s.mr), t: inch(s.mt), b: inch(s.mb) }; };
  const tabsWrite = (list) => SW.setMeta(SW.doc.fm, 'tabstops', list.length ? list.map(fmtLen).join(', ') : null);
  L.toggleRuler = function (force) {
    const on = force === undefined ? ruler.hidden : force;
    ruler.hidden = !on || SW.doc.view !== 'doc';
    $('ck-ruler').classList.toggle('on', on);
    SW.store.set('sw.ruler', on ? '1' : '0');
    L.updateRuler();
  };
  L.units = () => { L.updateRuler(); };
  L.rulerWanted = () => SW.store.get('sw.ruler') === '1';
  let live = null;                                   // margins and tab stops while dragging
  L.updateRuler = function () {
    if (SW.doc.view !== 'doc') { ruler.hidden = true; return; }
    ruler.hidden = !L.rulerWanted();
    if (ruler.hidden) return;
    const z = zoom();
    const W = page.getBoundingClientRect().width / z;
    ruler.style.width = W + 'px'; ruler.style.zoom = z;
    const m = live ? live.m : curMargins(), tabs = live ? live.tabs : ed.settings().tabs;
    const x0 = m.l * IN, x1 = W - m.r * IN;
    let h = '<div class="rz" style="left:0;width:' + x0 + 'px"></div><div class="rz" style="left:' + x1 + 'px;right:0"></div>';
    const cm = CM(), per = cm ? 4 : 8, unitPx = cm ? IN / 2.54 : IN;     // ticks per unit, pixels per unit
    for (let i = -Math.floor(m.l * unitPx / (unitPx / per)); x0 + i * unitPx / per <= W; i++) {
      const x = x0 + i * unitPx / per; if (x < 0) continue;
      const k = i % per === 0 ? 'm' : i % (per / 2) === 0 ? 'h' : 's';
      h += '<i class="tk ' + k + '" style="left:' + x + 'px"></i>';
      if (k === 'm' && i > 0 && x < x1) h += '<b class="tl" style="left:' + x + 'px">' + i / per + '</b>';
    }
    tabs.forEach((t, i) => { h += '<span class="rt" data-i="' + i + '" style="left:' + (x0 + t * IN) + 'px" title="Tab stop: drag to move, double-click to remove"></span>'; });
    h += '<span class="rm" data-side="l" style="left:' + x0 + 'px" title="Left margin: drag to change"></span><span class="rm" data-side="r" style="left:' + x1 + 'px" title="Right margin: drag to change"></span>';
    ruler.innerHTML = h;
  };
  const rulerX = (e) => (e.clientX - ruler.getBoundingClientRect().left) / zoom();
  ruler.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const W = page.getBoundingClientRect().width / zoom();
    const m0 = curMargins(), tabs0 = ed.settings().tabs.slice();
    const snap = (v) => (CM() ? Math.round(v * 2.54 * 10) / 10 / 2.54 : Math.round(v * 16) / 16);
    const t = e.target;
    if (t.classList.contains('rm')) {
      const side = t.dataset.side;
      const move = (ev) => {
        const x = rulerX(ev) / IN, m = Object.assign({}, m0);
        if (side === 'l') m.l = Math.max(0, Math.min(snap(x), W / IN - m0.r - 1)); else m.r = Math.max(0, Math.min(snap(W / IN - x), W / IN - m0.l - 1));
        live = { m, tabs: tabs0 };
        page.style.setProperty('--ml', m.l + 'in'); page.style.setProperty('--mr', m.r + 'in');
        L.updateRuler(); L.layoutTabs(); L.updateHandles();
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        const m = live ? live.m : m0; live = null;
        geoWrite(m); ed.metaChanged();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      return;
    }
    if (t.classList.contains('rt')) {
      const i = +t.dataset.i;
      const move = (ev) => {
        const x = Math.max(0.05, Math.min(snap((rulerX(ev) - m0.l * IN) / IN), (W - m0.l * IN - m0.r * IN) / IN));
        const list = tabs0.slice(); list[i] = x; live = { m: m0, tabs: list };
        L.updateRuler();
      };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        const list = (live ? live.tabs : tabs0).slice().sort((a, b) => a - b); live = null;
        tabsWrite(list); ed.metaChanged();
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      return;
    }
    // a click on the empty ruler adds a tab stop
    const x = snap((rulerX(e) - m0.l * IN) / IN);
    if (x > 0.05 && x < (W - m0.l * IN - m0.r * IN) / IN && !tabs0.some((v) => Math.abs(v - x) < 0.06)) { tabsWrite(tabs0.concat([x]).sort((a, b) => a - b)); ed.metaChanged(); }
  });
  ruler.addEventListener('dblclick', (e) => {
    const t = e.target; if (!t.classList.contains('rt')) return;
    const list = ed.settings().tabs.slice(); list.splice(+t.dataset.i, 1);
    tabsWrite(list); ed.metaChanged();
  });
  L.settingsChanged = function () { $('ck-columns').classList.toggle('on', ed.settings().cols === 2); if (!live) { L.updateRuler(); L.layoutTabsSoon(); } };

  /* ---------- two columns ---------- */
  L.toggleColumns = function (force) {
    const fm = SW.doc.fm;
    ed.syncMetaFromSource();
    const cur = String(SW.doc.fm.meta.classoption || '').split(/[\s,]+/).filter(Boolean);
    const on = force === undefined ? !cur.includes('twocolumn') : force;
    const rest = cur.filter((c) => c !== 'twocolumn');
    SW.setMeta(fm, 'classoption', (on ? rest.concat(['twocolumn']) : rest).join(',') || null);
    ed.metaChanged();
  };

  /* ---------- picture handles: drag a corner to resize ---------- */
  const handles = $('imghandles');
  const picOf = () => { const o = ed.selObj; return o && o.isConnected && SW.doc.view === 'doc' && (o.nodeName === 'IMG' || o.nodeName === 'FIGURE' || o.classList.contains('media')) ? o : null; };
  let hRaf = 0;
  L.updateHandles = function () {
    cancelAnimationFrame(hRaf);
    hRaf = requestAnimationFrame(() => {
      const o = picOf();
      if (!o) { handles.hidden = true; return; }
      const img = o.classList.contains('media') ? o.querySelector('.mv') : o.nodeName === 'IMG' ? o : o.querySelector('img'), b = img.getBoundingClientRect();
      handles.hidden = false;
      Object.assign(handles.style, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });
    });
  };
  ['scroll'].forEach((ev) => scroller.addEventListener(ev, L.updateHandles));
  document.addEventListener('selectionchange', L.updateHandles);
  handles.addEventListener('mousedown', (e) => {
    const o = picOf(), c = e.target.dataset && e.target.dataset.c; if (!o || !c) return;
    e.preventDefault(); e.stopPropagation();
    if (o.classList.contains('media')) {                // video and audio: the width only; the shape follows
      const box = o.querySelector('.mv'), z = zoom(), r0 = box.getBoundingClientRect(), w0 = r0.width / z, h0 = r0.height / z, x0 = e.clientX, y0 = e.clientY;
      const dx = /w/.test(c) ? -1 : /e/.test(c) ? 1 : 0, dy = /^n/.test(c) ? -1 : /^s/.test(c) ? 1 : 0;
      const maxW = Math.max(60, o.clientWidth || root.getBoundingClientRect().width / z);
      ed.op(() => {});
      const move = (ev) => {
        if (!(ev.buttons & 1)) { up(); return; }               // the button was let go where no mouseup reached us
        const dw = dx ? dx * (ev.clientX - x0) / z : dy * (ev.clientY - y0) / z * (w0 / Math.max(1, h0));
        SW.media.setWidth(o, Math.max(60, Math.min(maxW, w0 + dw))); L.updateHandles(); ed.positionBars();
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); ed.changed(true); L.updateHandles(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      return;
    }
    const img = o.nodeName === 'IMG' ? o : o.querySelector('img'), z = zoom();
    const r0 = img.getBoundingClientRect(), w0 = r0.width / z, h0 = r0.height / z, x0 = e.clientX, y0 = e.clientY;
    const dx = /w/.test(c) ? -1 : /e/.test(c) ? 1 : 0, dy = /^n/.test(c) ? -1 : /^s/.test(c) ? 1 : 0;
    const corner = c.length === 2, stretched = !!img.dataset.height;
    const maxW = Math.max(60, root.getBoundingClientRect().width / z);
    ed.op(() => {});                                  // one undo step for the whole drag
    const move = (ev) => {
      if (!(ev.buttons & 1)) { up(); return; }
      if (corner) {                                   // corners keep the shape
        const w = Math.max(24, Math.min(maxW, w0 + dx * (ev.clientX - x0) / z));
        img.dataset.width = Math.round(w) + 'px';
        if (stretched) img.dataset.height = Math.round(h0 * w / w0) + 'px';
      } else if (dx) {                                // left/right sides: width only
        img.dataset.width = Math.round(Math.max(12, Math.min(maxW, w0 + dx * (ev.clientX - x0) / z))) + 'px';
        img.dataset.height = Math.round(h0) + 'px';
      } else {                                        // top/bottom sides: height only
        img.dataset.width = Math.round(w0) + 'px';
        img.dataset.height = Math.round(Math.max(12, h0 + dy * (ev.clientY - y0) / z)) + 'px';
      }
      SW.layoutImg(o); L.updateHandles(); ed.positionBars();
    };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      ed.changed(true); L.layoutTabs(); L.updateHandles();
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });

  /* ---------- start (after the editor is initialized) ---------- */
  L.start = function () {
    const z0 = SW.store.get('sw.zoom');
    L.setZoom(z0 === 'fit' ? 'fit' : (parseFloat(z0) || 1), true);
    if (L.rulerWanted()) L.toggleRuler(true);
  };
  L.viewChanged = () => { L.updateRuler(); L.updateHandles(); L.layoutTabsSoon(); };
})();
