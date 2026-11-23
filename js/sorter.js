/* Simple Write: Slide sorter. A page is everything between two page breaks. The sorter shows one thumbnail per page,
   in the deck's own look; drag to reorder, duplicate, delete, add a blank page. Double-click opens that page.
   Done (or Esc) applies everything as one undo step; Cancel throws the changes away. */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const S = SW.sorter = {};
  let cur = null;

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const blank = () => { const p = document.createElement('p'); p.appendChild(document.createElement('br')); return p; };

  function cleanCopy(nodes) {                     // a safe copy for a thumbnail
    return nodes.map((n) => {
      const c = n.cloneNode(true);
      if (c.nodeType !== 1) return c;
      const all = [c, ...c.querySelectorAll('*')];
      all.forEach((e) => { e.removeAttribute('contenteditable'); e.removeAttribute('id'); });
      c.querySelectorAll('.cpin, .toc-hide').forEach((e) => e.remove());
      c.querySelectorAll('.media').forEach((m) => {
        const v = m.querySelector('video, audio, iframe'), src = v ? (v.getAttribute('src') || '') : '';
        const ph = document.createElement('div'); ph.className = 'so-media';
        ph.textContent = (v && v.nodeName === 'AUDIO' ? '♪ ' : '▶ ') + (v && v.nodeName === 'IFRAME' ? 'online video' : decodeURIComponent(src.split('/').pop() || 'media'));
        m.replaceWith(ph);
      });
      return c;
    });
  }
  const isBlank = (nodes) => !nodes.some((n) => n.nodeType === 1 ? (n.textContent.replace(/​/g, '').trim() || n.querySelector('img, .math, table, hr, .media')) : (n.nodeType === 3 && n.nodeValue.trim()));

  S.open = function () {
    if (cur) return;
    if (SW.doc.view === 'md') ed.setView('doc');
    if (SW.present && SW.present.active()) return;
    const root = $('doc'), s = ed.settings(), info = SW.paperInfo(s.paper), W = Math.round(info.w * 96), H = Math.round(info.h * 96);
    root.querySelectorAll('video, audio').forEach((m) => m.pause());
    // split the document at its page breaks
    let items = [{ nodes: [] }];
    for (const n of [...root.childNodes]) {
      if (n.nodeType === 1 && n.classList.contains('pagebreak')) items.push({ nodes: [] });
      else items[items.length - 1].nodes.push(n);
    }
    const lk = SW.present.look(s.bg, s.fade, s.fit);
    const TW = W >= H ? 250 : 170, k = TW / W, TH = Math.round(H * k);

    const ov = document.createElement('div');
    ov.id = 'sorter'; ov.className = 'sorter';
    ov.innerHTML = '<div class="so-bar"><strong class="so-title"></strong><span class="so-hint">Drag to reorder · double-click to open a page</span><span class="so-sp"></span>' +
      '<button type="button" class="so-undo" disabled>Undo</button><button type="button" class="so-cancel">Cancel</button><button type="button" class="so-done">Done</button></div>' +
      '<div class="so-grid"></div>';
    const grid = ov.querySelector('.so-grid');
    let hist = [], dirty = false;

    function thumb(it) {
      const el = document.createElement('div'); el.className = 'so-item';
      el.style.width = TW + 'px';
      const sc = document.createElement('div'); sc.className = 'so-page' + (lk.shade ? ' shade' : '');
      sc.style.cssText = 'width:' + TW + 'px;height:' + TH + 'px;background:' + lk.bg + ';' + (lk.shade ? '--pr-shade:' + lk.shade + ';' : '') + '--pr-fg:' + lk.fg + ';--head-color:' + lk.head;
      const inner = document.createElement('div'); inner.className = 'so-scale';
      inner.style.cssText = 'width:' + W + 'px;height:' + H + 'px;transform:scale(' + k + ')';
      const sl = SW.present.makeSlide(cleanCopy(it.nodes), s);
      sl.el.classList.add('pr-on'); inner.appendChild(sl.el); sc.appendChild(inner);
      el.appendChild(sc);
      el.insertAdjacentHTML('beforeend', '<div class="so-foot"><span class="so-num grip so-grip" title="Drag to move">⠿ <b></b></span><span class="so-sp"></span>' +
        '<button type="button" data-so="add" title="Add a blank page after this one">+</button>' +
        '<button type="button" data-so="dup" title="Duplicate this page">⧉</button>' +
        '<button type="button" data-so="del" title="Delete this page">×</button></div>');
      it.el = el; it.sl = sl;
      return el;
    }
    function render() {
      items.forEach((it) => { if (!it.el) grid.appendChild(thumb(it)); });
      items.forEach((it, i) => { grid.appendChild(it.el); it.el.querySelector('.so-num b').textContent = i + 1; });
      grid.querySelectorAll('.so-item').forEach((el) => { if (!items.some((it) => it.el === el)) el.remove(); });
      ov.querySelector('.so-title').textContent = items.length + (items.length === 1 ? ' page' : ' pages');
      ov.querySelector('.so-undo').disabled = !hist.length;
      items.forEach((it) => { if (it.sl && !it.fit) { SW.present.shrinkSlide(it.sl.el, it.sl.inn); it.fit = true; } });
    }
    const remember = () => { hist.push(items.slice()); dirty = true; };

    // ---- buttons on a thumbnail
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('[data-so]'); if (!b) return;
      const el = b.closest('.so-item'), i = items.findIndex((it) => it.el === el); if (i < 0) return;
      remember();
      const op = b.dataset.so;
      if (op === 'del') { items.splice(i, 1); if (!items.length) items.push({ nodes: [blank()] }); }
      else if (op === 'add') items.splice(i + 1, 0, { nodes: [blank()] });
      else if (op === 'dup') items.splice(i + 1, 0, { nodes: items[i].nodes.map((n) => { const c = n.cloneNode(true); if (c.nodeType === 1) c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id')); return c; }), fresh: true });
      render();
    });
    grid.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      const el = e.target.closest('.so-item'); if (!el) return;
      finish(true, items.findIndex((it) => it.el === el));
    });
    ov.querySelector('.so-undo').addEventListener('click', undo);
    ov.querySelector('.so-cancel').addEventListener('click', () => finish(false));
    ov.querySelector('.so-done').addEventListener('click', () => finish(true));
    function undo() { if (!hist.length) return; items = hist.pop(); render(); }

    // ---- drag to reorder (mouse anywhere, touch by the grip)
    let drag = null;
    grid.addEventListener('pointerdown', (e) => {
      if (e.button || e.target.closest('button')) return;
      const el = e.target.closest('.so-item'); if (!el) return;
      if (e.pointerType !== 'mouse' && !e.target.closest('.so-grip')) return;
      drag = { el, x: e.clientX, y: e.clientY, on: false, id: e.pointerId };
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
        drag.on = true; drag.el.classList.add('so-drag');
        const r = drag.el.getBoundingClientRect();
        drag.dx = e.clientX - r.left; drag.dy = e.clientY - r.top;
        const g = drag.el.cloneNode(true); g.className = 'so-item so-ghost'; g.style.width = r.width + 'px';
        document.body.appendChild(g); drag.ghost = g;
        remember(); hist.pop(); drag.before = items.slice();
      }
      drag.ghost.style.left = (e.clientX - drag.dx) + 'px'; drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
      // where does it go: before the first thumbnail that lies after the pointer (row by row)
      let at = null;
      for (const o of grid.querySelectorAll('.so-item:not(.so-drag)')) {
        const r = o.getBoundingClientRect();
        if (e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2)) { at = o; break; }
      }
      if (at !== drag.el.nextElementSibling) grid.insertBefore(drag.el, at);
      const gr = grid.getBoundingClientRect();                      // scroll while dragging near the edge
      if (e.clientY < gr.top + 50) grid.scrollTop -= 14; else if (e.clientY > gr.bottom - 50) grid.scrollTop += 14;
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (!d.on) return;
      d.el.classList.remove('so-drag'); d.ghost.remove();
      const order = [...grid.querySelectorAll('.so-item')].map((el) => items.find((it) => it.el === el));
      if (order.some((it, i) => it !== d.before[i])) { hist.push(d.before); dirty = true; items = order; }
      render();
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); finish(true); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
    }
    window.addEventListener('keydown', onKey, true);

    function finish(apply, go) {
      if (!cur) return;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      document.querySelectorAll('.so-ghost').forEach((g) => g.remove());
      ov.remove(); cur = null;
      if (apply && dirty) {
        ed.op(() => {
          const pb = () => SW.makePagebreak();
          ed.deselect();
          root.replaceChildren();
          items.forEach((it, i) => {
            if (i) root.appendChild(pb());
            it.nodes.forEach((n) => root.appendChild(n));
          });
          if (!root.firstChild) root.appendChild(blank());
        });
      }
      if (apply && go != null && go >= 0) {
        const target = items[go].nodes.find((n) => n.nodeType === 1 && root.contains(n));
        if (target) {
          try { target.scrollIntoView({ block: 'start' }); const r = document.createRange(); r.setStart(target, 0); r.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); root.focus({ preventScroll: true }); } catch (_) { /* no caret */ }
        }
      }
    }
    cur = { finish };
    document.body.appendChild(ov);
    render();
  };
  S.active = () => !!cur;
})();
