/* Simple Write: page boundaries on screen.
   The page is cut where the text would run past the bottom margin, like the printer does: the block that does not fit is pushed down
   (an extra top margin, shown only on screen and never saved), and a gap like the one at a page break is drawn. Page numbers, headers and
   footers follow these boundaries. Blocks are not split inside (a long paragraph moves whole to the next page), so the screen can show a
   little more than print or Word do; those two remain the exact ones. Slides (screen paper) and two columns are not cut. */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, G = SW.pg = { bounds: [], total: 1 };
  let timer = 0, lastH = 0, probe = null;

  const clear = (root) => root.querySelectorAll('[data-pgpush]').forEach((e) => { e.removeAttribute('data-pgpush'); e.style.removeProperty('--pgpush'); if (!e.getAttribute('style')) e.removeAttribute('style'); });
  const num = (v) => parseFloat(v) || 0;

  G.run = function () {
    const page = $('page'), root = $('doc'); if (!page || !root || !SW.ed || !SW.doc) return;
    const s = SW.ed.settings(), hf = SW.hf;
    clear(root);
    const L = hf.layer();
    const on = SW.doc.view === 'doc' && !/^screen/.test(s.paper) && s.cols !== 2;
    if (SW.doc.view !== 'doc') { L.textContent = ''; return; }
    if (!probe) { probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;height:1.4rem;width:1px;left:0;top:0'; L.parentNode.appendChild(probe); }
    const cs = getComputedStyle(page), pt = num(cs.paddingTop), pb = num(cs.paddingBottom), band = probe.offsetHeight || 22;
    const paperH = SW.paperInfo(s.paper).h * 96, Hc = paperH - pt - pb, docTop = root.offsetTop, gap = pb + band + pt;

    // ---- units: the blocks of the page; list items count one by one
    const units = [];
    for (const c of root.children) {
      if (c.classList.contains('pagebreak')) units.push({ brk: c });
      else if (on && (c.nodeName === 'UL' || c.nodeName === 'OL')) [...c.children].forEach((li, i) => units.push({ el: li, host: i === 0 ? c : li }));
      else units.push({ el: c, host: c });
    }
    units.forEach((u) => { if (u.el) { u.T = u.el.offsetTop - docTop; u.h = u.el.offsetHeight; } });
    // ---- decide where the pages end
    const recs = [], pushes = [];
    let pageStart = 0, expect = true, shift = 0, pageNo = 1;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.brk) { recs.push({ type: 'x', el: u.brk, end: pageNo }); pageNo++; expect = true; continue; }
      let T = u.T + shift;
      if (expect) { pageStart = T; expect = false; }
      if (on) {
        const bottom = pageStart + Hc;
        let need = u.h;
        const nx = units[i + 1];
        if (/^H[1-6]$/.test(u.el.nodeName) && nx && nx.el && nx.h <= Hc) need = nx.T + nx.h - u.T;     // a heading stays with what follows
        if (T > pageStart + 1 && T + need > bottom + 1 && u.h <= Hc) {
          const extra = bottom - T + gap;
          const h = u.host, prev = h.previousElementSibling, hs = getComputedStyle(h);
          const nat = Math.max(num(hs.marginTop), prev ? num(getComputedStyle(prev).marginBottom) : 0);
          pushes.push([h, extra + nat]);
          shift += extra; T += extra; pageStart = bottom + gap;
          recs.push({ type: 'a', el: u.host, end: pageNo }); pageNo++;
        }
        if (T + u.h > pageStart + Hc + 1) { const n = Math.floor((T + u.h - pageStart - 1) / Hc); if (n > 0) { pageStart += n * Hc; pageNo += n; } }   // taller than a page: runs on without a gap
      }
    }
    const total = pageNo, lastBottom = pageStart + Hc + pt + pb;
    // ---- apply
    pushes.forEach(([h, m]) => { h.dataset.pgpush = '1'; h.style.setProperty('--pgpush', m + 'px'); });
    page.style.minHeight = Math.max(paperH, on ? lastBottom : 0) + 'px';
    // ---- where the boundaries are now
    const bounds = recs.map((r) => {
      if (r.type === 'x') return { end: r.end, foot: r.el.offsetTop - pb / 2, head: r.el.offsetTop + r.el.offsetHeight + pt / 2, band: null };
      const top = r.el.offsetTop;
      return { end: r.end, foot: top - pt - band - pb / 2, head: top - pt / 2, band: { top: top - pt - band, h: band } };
    });
    G.bounds = bounds; G.total = total;
    hf.paint(bounds, total);
    lastH = root.offsetHeight;
    $('st-pages').textContent = total + (total === 1 ? ' page' : ' pages');
    if (SW.ed.positionBars) SW.ed.positionBars();
  };
  G.schedule = () => { clearTimeout(timer); timer = setTimeout(G.run, 120); };
  G.heightChanged = () => { const r = $('doc'); if (r && Math.abs(r.offsetHeight - lastH) > 0.5) G.schedule(); };
})();
