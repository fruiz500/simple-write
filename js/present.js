/* Simple Write: Present. Each page (ending at a page break) becomes a slide, shown full screen.
   Keys: arrows, Space, PageUp/PageDown, Home/End, Esc.  Touch: swipe, or tap the screen.
   Front matter: background (dark | navy | sepia | a color | a picture), transition (fade | slide | none), reveal: bullets. */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const P = SW.present = {};
  const THEMES = {
    dark: { bg: '#1e1e1e', fg: '#f2f2f2', head: '#9fbbe6' },
    navy: { bg: '#0b2545', fg: '#eef4fb', head: '#8dc6ff' },
    sepia: { bg: '#f4ecd8', fg: '#3b2f1e', head: '#7a4a1d' },
    plain: { bg: '#ffffff', fg: '#1d1d1d', head: '#1f3864' }
  };
  const IMG = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

  function look(bg, fade, fit) {
    if (THEMES[bg]) return Object.assign({}, THEMES[bg]);
    if (bg && IMG.test(bg)) return { bg: (fade.light ? '#fff' : '#000') + ' center / ' + (fit === 'fit' ? 'contain' : fit === 'stretch' ? '100% 100%' : 'cover') + ' no-repeat url("' + SW.resolveAsset(bg) + '")', fg: fade.light ? '#1d1d1d' : '#fff', head: fade.light ? '#1f3864' : '#fff', shade: (fade.light ? 'rgba(255,255,255,' : 'rgba(0,0,0,') + fade.pct / 100 + ')' };
    if (bg) {
      const t = document.createElement('div'); t.style.color = bg; document.body.appendChild(t);
      const c = getComputedStyle(t).color; t.remove();
      const m = c.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3 && t.style.color) {
        const lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
        return lum < 0.55 ? { bg, fg: '#f2f2f2', head: '#ffffff' } : { bg, fg: '#1d1d1d', head: '#1f3864' };
      }
    }
    return Object.assign({}, THEMES.plain);
  }

  // one slide: the nodes inside a padded page, in the document's font (shared with the slide sorter)
  P.makeSlide = function (nodes, s, n, total) {
    const el = document.createElement('div'); el.className = 'pr-slide';
    el.style.padding = s.mt + ' ' + s.mr + ' ' + s.mb + ' ' + s.ml;
    const inn = document.createElement('div'); inn.className = 'pr-in doc';
    inn.style.setProperty('--doc-font', SW.fontStack(s.font)); inn.style.setProperty('--doc-size', s.size);
    inn.style.setProperty('--doc-line', String(Math.round(parseFloat(s.line) * 1.2 * 100) / 100));
    nodes.forEach((n) => inn.appendChild(n));
    const blocks = [...inn.children].filter((c) => c.textContent.trim() || c.querySelector('img'));
    if (blocks.length && blocks.length <= 3 && /^H[12]$/.test(blocks[0].nodeName) && blocks.slice(1).every((c) => c.nodeName === 'P' && !c.querySelector('img, .math.display'))) el.classList.add('pr-title');
    el.appendChild(inn);
    if (n) {                                                      // header and footer of the document, with this page's number
      const e = SW.hf.effective(s), c = Object.assign({ page: n, pages: total }, SW.hf.ctx(SW.doc.fm.meta, $('doc')));
      if (!(n === 1 && e.skipFirst)) [[e.head, 'top'], [e.foot, 'bottom']].forEach(([z, side]) => {
        if (!z.some(Boolean)) return;
        const row = document.createElement('div'); row.className = 'pr-hf ' + side; row.style.left = s.ml; row.style.right = s.mr; row.style[side] = 'calc(' + (side === 'top' ? s.mt : s.mb) + ' / 2)';
        z.forEach((t) => { const sp = document.createElement('span'); sp.textContent = SW.hf.text(t, c); row.appendChild(sp); });
        el.appendChild(row);
      });
    }
    return { el, inn };
  };
  // a slide that is too full is made smaller so nothing is cut off (call once it is in the page)
  P.shrinkSlide = function (el, inn) {
    inn.style.zoom = '';
    const cs = getComputedStyle(el);
    const avail = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const need = inn.scrollHeight;
    if (need > avail + 2) inn.style.zoom = String(Math.max(0.45, Math.floor(avail / need * 100) / 100));
  };
  P.look = look;

  let cur = null;

  function slideIndexAtCaret() {
    const root = $('doc'), sel = getSelection();
    if (!sel.rangeCount || !root.contains(sel.anchorNode)) return 0;
    let n = 0;
    for (const b of root.querySelectorAll('.pagebreak')) {
      if (b.compareDocumentPosition(sel.anchorNode) & Node.DOCUMENT_POSITION_FOLLOWING) n++;
    }
    return n;
  }

  P.start = function (fromHere) {
    if (cur) return;
    if (SW.doc.view === 'md') ed.setView('doc');
    const s = ed.settings(), info = SW.paperInfo(s.paper), W = Math.round(info.w * 96), H = Math.round(info.h * 96);
    const root = $('doc');
    const startAt = fromHere ? slideIndexAtCaret() : 0;
    root.querySelectorAll('video, audio').forEach((m) => m.pause());
    const clone = root.cloneNode(true);
    clone.querySelectorAll('.derived, .cpin, .toc-hide').forEach((n) => n.remove());
    root.querySelectorAll('.media iframe').forEach((f) => { f.src = f.getAttribute('src'); });      // an online player left playing in the page is stopped
    clone.querySelectorAll('iframe').forEach((f) => f.removeAttribute('src'));                       // online players load only when their slide is shown
    clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));

    // split at the page breaks
    const groups = [[]];
    for (const n of [...clone.childNodes]) {
      if (n.nodeType === 1 && n.classList.contains('pagebreak')) groups.push([]); else groups[groups.length - 1].push(n);
    }
    const filled = (g) => g.some((n) => (n.nodeType === 3 ? n.nodeValue.trim() : n.nodeType === 1 && (n.textContent.replace(/​/g, '').trim() || n.querySelector('img, .math, table, hr'))));
    const used = groups.map((g, i) => ({ g, i })).filter((x) => filled(x.g));
    if (!used.length) { SW.message('There is nothing to present yet.', 3500); return; }
    let first = Math.max(0, used.findIndex((x) => x.i >= startAt)); if (first < 0) first = 0;
    if (fromHere && used.every((x) => x.i < startAt)) first = used.length - 1;

    const lk = look(s.bg, s.fade, s.fit);
    const ov = document.createElement('div');
    ov.id = 'present'; ov.className = 'present' + (lk.shade ? ' shade' : ''); ov.dataset.trans = s.trans;
    ov.style.cssText = 'background:' + lk.bg + ';' + (lk.shade ? '--pr-shade:' + lk.shade + ';' : '') + '--pr-fg:' + lk.fg + ';--head-color:' + lk.head;
    ov.innerHTML = '<div class="pr-stage"></div><div class="pr-count"></div><button type="button" class="pr-close" aria-label="Exit">×</button>';
    const stage = ov.querySelector('.pr-stage');
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    const slides = used.map((x) => {
      const sl = P.makeSlide(x.g, s, x.i + 1, groups.length); stage.appendChild(sl.el);
      const items = s.reveal ? [...sl.inn.querySelectorAll('li')] : [];
      return { el: sl.el, inn: sl.inn, items, shown: 0 };
    });
    document.body.appendChild(ov);
    ov.querySelectorAll('.media').forEach((m) => SW.media.setup(m));      // the copies need their players wired up again

    const show = (i, mode) => {                        // mode: 'fwd' (items hidden) or 'back' (all shown)
      cur.i = i;
      stage.querySelectorAll('video, audio').forEach((m) => m.pause());
      stage.querySelectorAll('iframe').forEach((f) => { if (f.closest('.pr-slide') === slides[i].el) { if (!f.getAttribute('src')) f.src = f.dataset.src; } else if (f.getAttribute('src')) f.removeAttribute('src'); });
      slides.forEach((sl, j) => { sl.el.className = sl.el.className.replace(/\bpr-(on|before|after)\b/g, '').trim() + ' ' + (j === i ? 'pr-on' : j < i ? 'pr-before' : 'pr-after'); });
      const sl = slides[i];
      if (mode) { sl.shown = mode === 'back' ? sl.items.length : 0; sl.items.forEach((li, k) => li.classList.toggle('pr-hide', k >= sl.shown)); }
      ov.querySelector('.pr-count').textContent = (i + 1) + ' / ' + slides.length;
    };
    const next = () => {
      const sl = slides[cur.i];
      if (sl.shown < sl.items.length) { sl.items[sl.shown++].classList.remove('pr-hide'); return; }
      if (cur.i < slides.length - 1) show(cur.i + 1, 'fwd');
    };
    const prev = () => {
      const sl = slides[cur.i];
      if (sl.shown > 0) { sl.items[--sl.shown].classList.add('pr-hide'); return; }
      if (cur.i > 0) show(cur.i - 1, 'back');
    };
    const fit = () => {
      const k = Math.min(innerWidth / W, innerHeight / H);
      stage.style.transform = 'translate(-50%,-50%) scale(' + k + ')';
    };
    const shrink = () => slides.forEach((sl) => P.shrinkSlide(sl.el, sl.inn));

    const stop = () => {
      if (!cur) return;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', fit);
      document.removeEventListener('fullscreenchange', onFs);
      cur = null;
      ov.querySelectorAll('video, audio').forEach((m) => { m.pause(); m.removeAttribute('src'); m.load(); });
      ov.remove();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    const onFs = () => { if (!document.fullscreenElement) stop(); };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key; let used = true;
      if (k === 'Escape') stop();
      else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'n' || k === 'N') next();
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p' || k === 'P') prev();
      else if (k === 'Home') show(0, 'fwd');
      else if (k === 'End') show(slides.length - 1, 'back');
      else used = false;
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    cur = { i: 0, stop };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', fit);
    document.addEventListener('fullscreenchange', onFs);

    // mouse and touch
    ov.addEventListener('click', (e) => {
      if (e.target.closest('.pr-close')) { stop(); return; }
      if (e.target.closest('video, audio')) return;               // the player's own controls
      if (e.clientX < innerWidth * 0.3) prev(); else next();
    });
    let t0 = null;
    ov.addEventListener('touchstart', (e) => { t0 = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    ov.addEventListener('touchend', (e) => {
      if (!t0 || !e.changedTouches.length) return;
      const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y; t0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); if (dx < 0) next(); else prev(); }
      else if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx)) { e.preventDefault(); if (dy < 0) next(); else prev(); }
    });
    let hideT = 0;
    ov.addEventListener('mousemove', () => { ov.classList.add('pr-ui'); clearTimeout(hideT); hideT = setTimeout(() => ov.classList.remove('pr-ui'), 2500); });

    fit(); shrink(); show(first, 'fwd');
    if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
    else SW.message('Press Esc to leave the presentation.', 3000);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (cur) shrink(); });
    // pictures that load late change the height: look again
    ov.querySelectorAll('img').forEach((im) => { if (!im.complete) im.addEventListener('load', () => { if (cur) shrink(); }); });
  };
  P.stop = () => { if (cur) cur.stop(); };
  P.active = () => !!cur;
})();
