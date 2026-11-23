/* Simple Write: rotating, flipping and cropping pictures.
   These change the picture itself (a new file in the images folder), so the Markdown stays plain
   and Word, PDF and every other program show the same result. Undo brings the old picture back. */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const P = SW.pic = {};
  const imgOf = (o) => (o.nodeName === 'IMG' ? o : o.querySelector('img'));

  async function sourceBlob(img) {
    const src = img.dataset.src || img.getAttribute('src') || '';
    let b = SW.assetBlob(src);
    if (!b) { try { const r = await fetch(img.src); if (r.ok) b = await r.blob(); } catch (e) { b = null; } }
    return b;
  }
  async function loadBitmap(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const im = new Image(); im.src = url;
      await im.decode();
      return im;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const outType = (blob) => (/jpe?g/.test(blob.type) ? 'image/jpeg' : /webp/.test(blob.type) ? 'image/webp' : 'image/png');
  const toBlob = (c, type) => new Promise((r) => c.toBlob(r, type, 0.92));
  function baseName(img) {
    const s = (img.dataset.src || 'picture').split('/').pop().replace(/\.\w+$/, '');
    return s.replace(/-(rot|flip|crop)\d*(-\d+)?$/, '');
  }
  async function getPicture(img) {
    const blob = await sourceBlob(img);
    if (!blob) { SW.message('This picture comes from a web address that does not allow changes. Save it to your computer and insert it again.', 8000); return null; }
    return { blob, im: await loadBitmap(blob) };
  }
  // put the new picture in place: one undo step
  function swap(o, img, blob, name, sizeFn) {
    const src = SW.addAssetBlob(blob, name);
    ed.op(() => {
      img.dataset.src = src; img.src = SW.resolveAsset(src);
      if (sizeFn) sizeFn();
      SW.layoutImg(o);
    });
    ed.selectObj(o);
    if (SW.layout) SW.layout.updateHandles();
  }

  /* rotate by 90 degrees (deg = 90 or -90), or flip left to right */
  P.rotate = async function (o, deg, flip) {
    const img = imgOf(o); if (!img) return;
    const pic = await getPicture(img); if (!pic) return;
    const { blob, im } = pic, W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement('canvas');
    c.width = deg ? H : W; c.height = deg ? W : H;
    const g = c.getContext('2d');
    if (outType(blob) === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
    g.translate(c.width / 2, c.height / 2);
    if (deg) g.rotate(deg * Math.PI / 180);
    if (flip) g.scale(-1, 1);
    g.drawImage(im, -W / 2, -H / 2);
    const out = await toBlob(c, outType(blob));
    const shown = img.getBoundingClientRect(), z = parseFloat(document.getElementById('page').style.zoom || '1') || 1;
    swap(o, img, out, baseName(img) + (flip ? '-flip' : '-rot') + '.png', () => {
      if (!deg) return;
      // a rotated picture keeps its place on the page: the old height becomes the width
      if (img.dataset.height) { const w = img.dataset.width; img.dataset.width = img.dataset.height; img.dataset.height = w; }
      else if (/px$/.test(img.dataset.width || '')) img.dataset.width = Math.round(shown.height / z) + 'px';
    });
  };

  /* the crop box: drag it over a picture (or a video frame). Returns the box as fractions of the whole, or null.
     opts: { init: {x,y,w,h}, auto: () => box, unit: 'pixels' } */
  const dlg = $('dlg-crop');
  P.askBox = async function (src, W, H, opts) {
    opts = opts || {};
    const wrap = $('crop-wrap'), view = $('crop-img'), box = $('crop-box'), autoBtn = $('crop-auto');
    view.src = src;
    let r = Object.assign({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, opts.init || {});   // fractions of the picture
    const draw = () => Object.assign(box.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
    const info = () => { $('crop-info').textContent = Math.round(r.w * W) + ' \u00D7 ' + Math.round(r.h * H) + ' pixels (of ' + W + ' \u00D7 ' + H + ')'; };
    draw(); info();
    autoBtn.hidden = !opts.auto;
    autoBtn.onclick = () => { const a = opts.auto(); if (a) { r = a; draw(); info(); } else SW.message('No black bars found.', 2500); };
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    const down = (e) => {
      e.preventDefault();
      const b = wrap.getBoundingClientRect(), fx = (ev) => cl((ev.clientX - b.left) / b.width, 0, 1), fy = (ev) => cl((ev.clientY - b.top) / b.height, 0, 1);
      const k = e.target.dataset.k, r0 = Object.assign({}, r), x0 = fx(e), y0 = fy(e);
      const mode = k || (e.target === box ? 'move' : 'new');
      const move = (ev) => {
        const x = fx(ev), y = fy(ev), min = 0.02;
        if (mode === 'move') { r.x = cl(r0.x + x - x0, 0, 1 - r0.w); r.y = cl(r0.y + y - y0, 0, 1 - r0.h); }
        else if (mode === 'new') { r = { x: Math.min(x, x0), y: Math.min(y, y0), w: Math.max(min, Math.abs(x - x0)), h: Math.max(min, Math.abs(y - y0)) }; r.w = Math.min(r.w, 1 - r.x); r.h = Math.min(r.h, 1 - r.y); }
        else {
          let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h;
          if (/w/.test(mode)) x1 = Math.min(x, x2 - min); else x2 = Math.max(x, x1 + min);
          if (/n/.test(mode)) y1 = Math.min(y, y2 - min); else y2 = Math.max(y, y1 + min);
          r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }
        draw(); info();
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    };
    wrap.onpointerdown = down;
    $('crop-all').onclick = () => { r = { x: 0, y: 0, w: 1, h: 1 }; draw(); info(); };
    dlg.returnValue = '';
    const ok = await new Promise((res) => { dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }); dlg.showModal(); });
    wrap.onpointerdown = null; autoBtn.hidden = true;
    return ok ? r : null;
  };
  P.crop = async function (o) {
    const img = imgOf(o); if (!img) return;
    const pic = await getPicture(img); if (!pic) return;
    const { blob, im } = pic, W = im.naturalWidth, H = im.naturalHeight;
    const r = await P.askBox(im.src, W, H);
    if (!r || (r.w > 0.999 && r.h > 0.999)) return;
    const sx = Math.round(r.x * W), sy = Math.round(r.y * H), sw = Math.max(1, Math.round(r.w * W)), sh = Math.max(1, Math.round(r.h * H));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    const out = await toBlob(c, outType(blob));
    swap(o, img, out, baseName(img) + '-crop.png', () => {
      // what is left keeps its size on the page (the picture does not grow to fill the old box)
      if (/px$/.test(img.dataset.width || '')) img.dataset.width = Math.max(12, Math.round(parseFloat(img.dataset.width) * r.w)) + 'px';
      else if (/%$/.test(img.dataset.width || '')) img.dataset.width = Math.max(1, Math.round(parseFloat(img.dataset.width) * r.w)) + '%';
      if (/px$/.test(img.dataset.height || '')) img.dataset.height = Math.max(12, Math.round(parseFloat(img.dataset.height) * r.h)) + 'px';
    });
  };
})();
