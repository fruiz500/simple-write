/* Simple Write: files, pictures, drafts */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$;
  const files = SW.files = {};
  const doc = () => SW.doc;

  /* ---------- pictures (assets) kept beside the document ---------- */
  const assets = new Map();   // name -> { blob, url, data }
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/webm': 'weba', 'audio/flac': 'flac' };
  const MEDIA_RE = /\.(mp4|m4v|webm|ogv|mov|mp3|m4a|wav|aac|oga|ogg|opus|flac|weba)$/i;
  const isMedia = (blob, name) => /^(video|audio)\//.test(blob.type || '') || MEDIA_RE.test(name || '');
  const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', weba: 'audio/webm' };
  function cleanName(n) { return String(n || 'picture').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'picture'; }
  function put(name, blob) {
    if (!blob.type && MEDIA_RE.test(name)) blob = blob.slice(0, blob.size, MIME[name.split('.').pop().toLowerCase()] || '');
    const old = assets.get(name); if (old) URL.revokeObjectURL(old.url);
    const a = { blob, url: URL.createObjectURL(blob), data: null };
    assets.set(name, a);
    if (blob.size < 8e6 && !isMedia(blob, name)) SW.blobToDataUrl(blob).then((d) => { a.data = d; }).catch(() => {});
  }
  // a new picture: returns its name, e.g. images/plot-2.png
  SW.addAssetBlob = function (blob, suggested) {
    const ext = EXT[blob.type] || (String(suggested).match(/\.(\w{2,4})$/) || [])[1] || 'png';
    const base = cleanName(suggested);
    const dir = isMedia(blob, String(suggested)) ? 'media/' : 'images/';
    let name = dir + base + '.' + ext, n = 2;
    while (assets.has(name)) name = dir + base + '-' + n++ + '.' + ext;
    put(name, blob);
    files.saveAsset(name, blob);
    return name;
  };
  SW.hasAsset = (name) => assets.has(name);
  function find(src) {
    if (!src) return null;
    const clean = decodeURIComponent(String(src)).replace(/^\.\//, '');
    if (assets.has(clean)) return assets.get(clean);
    const base = clean.split('/').pop();
    for (const [k, v] of assets) if (k.split('/').pop() === base) return v;
    return null;
  }
  SW.resolveAsset = (src) => { const a = find(src); return a ? a.url : src; };
  SW.assetDataUrl = (src) => { const a = find(src); return a ? a.data : null; };
  SW.putAsset = (name, blob) => { put(name, blob); files.saveAsset(name, blob); };
  SW.assetBlob = (src) => { const a = find(src); return a ? a.blob : null; };
  SW.assetNameForUrl = (url) => { for (const [k, v] of assets) if (v.url === url) return k; return null; };
  function clearAssets() { for (const a of assets.values()) URL.revokeObjectURL(a.url); assets.clear(); }
  // pictures the document uses
  function usedAssets(md) {
    const out = new Set();
    const re = /!\[[^\]]*\]\(\s*<?([^)\s>]+)/g; let m;
    while ((m = re.exec(md))) { const a = find(m[1]); if (a) for (const [k, v] of assets) if (v === a) out.add(k); }
    const bre = /^background:[ \t]*["']?([^\s"'#][^\s"']*)/m;     // the slide background picture, named in the front matter
    const bm = bre.exec(md.slice(0, md.indexOf('\n---', 4) + 1 || 0));
    if (bm) { const a = find(bm[1]); if (a) for (const [k, v] of assets) if (v === a) out.add(k); }
    const mre = /<(?:video|audio|source)\b[^>]*?\bsrc=["']([^"']+)/gi;
    while ((m = mre.exec(md))) { const a = find(m[1]); if (a) for (const [k, v] of assets) if (v === a) out.add(k); }
    return [...out];
  }

  /* ---------- drafts in IndexedDB (each browser tab is one document) ---------- */
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('simple-write', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('drafts', { keyPath: 'id' }); d.createObjectStore('assets'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  files.draftId = null;
  files.saveAsset = (name, blob) => { if (files.draftId) tx('assets', 'readwrite', (s) => s.put(blob, files.draftId + '|' + name)).catch(() => {}); };
  files.saveDraft = async function () {
    if (!files.draftId) return;
    const md = SW.ed.getMarkdown();
    if (!md.trim() && !files.hadDraft) return;
    files.hadDraft = true;
    try {
      await tx('drafts', 'readwrite', (s) => s.put({ id: files.draftId, name: doc().name || firstHeading(md) || 'Untitled', md, bib: SW.bib.text, time: Date.now(), modified: doc().modified, format: doc().format }));
    } catch (e) { SW.message('Could not keep a draft in this browser: ' + e.message); }
  };
  files.autosaveSoon = SW.debounce(() => files.saveDraft(), 1500);
  async function loadDraft(id) {
    const d = await tx('drafts', 'readonly', (s) => s.get(id));
    if (!d) return false;
    clearAssets();
    const keys = await tx('assets', 'readonly', (s) => s.getAllKeys());
    for (const k of keys.filter((k) => String(k).startsWith(id + '|'))) {
      const blob = await tx('assets', 'readonly', (s) => s.get(k));
      if (blob) put(String(k).slice(id.length + 1), blob);
    }
    files.draftId = id; files.hadDraft = true;
    try { sessionStorage.setItem('sw.draft', id); } catch (e) { /* ignore */ }
    SW.bib.set(d.bib || '');
    doc().format = d.format || 'md';
    doc().fileHandle = null; doc().dirHandle = null;
    SW.ed.setName(d.name === 'Untitled' ? '' : d.name);
    SW.ed.setMarkdown(d.md);
    SW.ed.setModified(!!d.modified);
    return true;
  }
  async function deleteDraft(id) {
    await tx('drafts', 'readwrite', (s) => s.delete(id));
    const keys = await tx('assets', 'readonly', (s) => s.getAllKeys());
    await tx('assets', 'readwrite', (s) => { keys.filter((k) => String(k).startsWith(id + '|')).forEach((k) => s.delete(k)); });
  }
  async function pruneDrafts() {
    try {
      const all = (await tx('drafts', 'readonly', (s) => s.getAll())).sort((a, b) => b.time - a.time);
      const old = all.filter((d, i) => i >= 40 || Date.now() - d.time > 60 * 864e5);
      for (const d of old) if (d.id !== files.draftId) await deleteDraft(d.id);
    } catch (e) { /* ignore */ }
  }
  function firstHeading(md) { const m = String(md).match(/^#{1,6}[ \t]+(.+?)[ \t]*(?:\{#[^}]*\})?$/m); return m ? m[1].replace(/[`*_$\\]/g, '').trim().slice(0, 60) : ''; }
  // a fresh document in this tab (the old one stays in Recent drafts)
  function fresh(name) {
    files.draftId = newId(); files.hadDraft = false;
    try { sessionStorage.setItem('sw.draft', files.draftId); } catch (e) { /* ignore */ }
    clearAssets();
    SW.bib.set('');
    const d = doc(); d.fileHandle = null; d.dirHandle = null; d.format = 'md'; d.savedOnce = false;
    SW.ed.setName(name || '');
  }
  files.start = async function () {
    let id = null;
    const h = location.hash.match(/draft=([\w]+)/);
    if (/^#(new|ai)\b/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); try { sessionStorage.removeItem('sw.draft'); } catch (e) { /* ignore */ } }
    else if (h) { id = h[1]; history.replaceState(null, '', location.pathname + location.search); }
    else { try { id = sessionStorage.getItem('sw.draft'); } catch (e) { /* ignore */ } }
    let ok = false;
    if (id) { try { ok = await loadDraft(id); } catch (e) { ok = false; } }
    if (!ok) {
      fresh('');
      SW.ed.setMarkdown('');
      SW.ed.setModified(false);
      try { const n = (await tx('drafts', 'readonly', (s) => s.count())); if (n) SW.message('Earlier documents are in File ▸ Recent drafts.', 6000); } catch (e) { /* ignore */ }
    }
    pruneDrafts();
  };
  // window.open copies sessionStorage to the new tab, so the hash tells it to start blank
  files.newWindow = () => window.open(location.pathname + '#new', '_blank');
  files.showDrafts = async function () {
    let all = [];
    try { all = (await tx('drafts', 'readonly', (s) => s.getAll())).sort((a, b) => b.time - a.time); } catch (e) { SW.message('Drafts are not available in this browser.'); return; }
    const items = all.filter((d) => d.id !== files.draftId).map((d) => ({
      label: d.name || 'Untitled',
      sub: new Date(d.time).toLocaleString() + (d.modified ? ' • not saved to a file' : ''),
      actions: [
        { label: 'Open here', run: async () => { await files.saveDraft(); await loadDraft(d.id); } },
        { label: 'New tab', run: () => { window.open(location.pathname + '#draft=' + d.id, '_blank'); } },
        { label: 'Delete', run: async (row) => { await deleteDraft(d.id); row.remove(); return false; } }
      ]
    }));
    SW.dlg.list('Recent drafts', 'Everything you type is kept in this browser as a draft, one per tab. Save to a file to keep it for good.', items);
  };

  /* ---------- opening ---------- */
  const DOC_RE = /\.(md|markdown|mdown|txt|text|docx|html?|zip)$/i;
  const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  files.open = async function () {
    if (window.showOpenFilePicker) {
      try {
        const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Documents', accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'text/html': ['.html', '.htm'], 'application/zip': ['.zip'], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'], 'application/x-bibtex': ['.bib'] } }] });
        const list = [];
        for (const h of hs) { const f = await h.getFile(); f._handle = h; list.push(f); }
        return files.openFiles(list);
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    $('open-file').click();
  };
  files.openFolder = async function () {
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
        const list = [];
        const walk = async (d, prefix, depth) => {
          for await (const [name, h] of d.entries()) {
            if (h.kind === 'file' && (DOC_RE.test(name) || IMG_RE.test(name) || MEDIA_RE.test(name) || /\.bib$/i.test(name))) { const f = await h.getFile(); f._rel = prefix + name; if (!prefix) f._handle = h; list.push(f); }
            else if (h.kind === 'directory' && depth < 2 && !name.startsWith('.')) await walk(h, prefix + name + '/', depth + 1);
          }
        };
        await walk(dir, '', 0);
        return files.openFiles(list, dir);
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    $('open-folder').click();
  };
  $('open-file').addEventListener('change', (e) => { const l = [...e.target.files]; e.target.value = ''; if (l.length) files.openFiles(l); });
  $('open-folder').addEventListener('change', (e) => {
    const l = [...e.target.files]; e.target.value = '';
    l.forEach((f) => { f._rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/'); });
    if (l.length) files.openFiles(l);
  });

  files.openFiles = async function (list, dirHandle) {
    try {
      // a .zip holds a document and its pictures
      const zips = list.filter((f) => /\.zip$/i.test(f.name));
      for (const z of zips) {
        await SW.libs.jszip();
        const zip = await JSZip.loadAsync(z);
        const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
        const mdEntry = entries.find((e) => /\.(md|markdown)$/i.test(e.name));
        const root = mdEntry ? mdEntry.name.replace(/[^/]*$/, '') : '';
        for (const e of entries) {
          const blob = await e.async('blob');
          const f = new File([blob], e.name.split('/').pop(), { type: IMG_RE.test(e.name) ? 'image/' + (e.name.split('.').pop().toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml')) : MIME[(e.name.split('.').pop() || '').toLowerCase()] || '' });
          f._rel = e.name.startsWith(root) ? e.name.slice(root.length) : e.name;
          list.push(f);
        }
        list = list.filter((f) => f !== z);
        dirHandle = null;
      }
      const docs = list.filter((f) => DOC_RE.test(f.name) && !/\.zip$/i.test(f.name));
      const imgs = list.filter((f) => IMG_RE.test(f.name) || /^image\//.test(f.type) || MEDIA_RE.test(f.name));
      const bibs = list.filter((f) => /\.bib$/i.test(f.name));
      if (!docs.length) {
        if (imgs.length) { const mm = imgs.filter((f) => MEDIA_RE.test(f.name) || /^(video|audio)\//.test(f.type)), pp = imgs.filter((f) => !mm.includes(f)); if (pp.length) SW.ed.insertImages(pp); if (mm.length) SW.media.insert(mm); return; }
        if (bibs.length) { for (const b of bibs) SW.bib.add(await b.text()); files.bibChanged(); SW.message('References added.'); return; }
        SW.message('Nothing to open there.'); return;
      }
      let main = docs[0];
      if (docs.length > 1) {
        main = await new Promise((res) => {
          SW.dlg.list('Which document?', 'Pick the document to open.', docs.map((f) => ({ label: f._rel || f.name, run: () => res(f) }))).then(() => res(null));
        });
        if (!main) return;
      }
      await files.saveDraft();
      const name = main.name.replace(/\.[^.]*$/, '');
      const ext = (main.name.match(/\.([^.]*)$/) || [])[1].toLowerCase();
      fresh(name);
      const dirOfMain = main._rel ? main._rel.replace(/[^/]*$/, '') : '';
      for (const f of imgs) {
        let rel = f._rel || f.name;
        if (dirOfMain && rel.startsWith(dirOfMain)) rel = rel.slice(dirOfMain.length);
        put(rel, f);
        files.saveAsset(rel, f);
      }
      let md = '';
      SW.message('Opening ' + main.name + '…', 20000);
      if (/^(md|markdown|mdown|txt|text)$/.test(ext)) md = await main.text();
      else if (/^html?$/.test(ext)) md = SW.htmlToMarkdown(await main.text());
      else if (ext === 'docx') md = await SW.importDocx(main);
      else if (ext === 'pdf') { SW.message('Simple Write cannot open PDF files. Open the original Word or Markdown file instead; to get text out of a PDF, copy it from a PDF viewer.', 10000); return; }
      const sp = SW.splitFrontMatter(md);
      const bibName = sp.fm.meta.bibliography;
      const bibFile = bibs.find((b) => !bibName || b.name === bibName.split('/').pop()) || bibs[0];
      SW.bib.set(bibFile ? await bibFile.text() : '');
      const d = doc();
      d.format = /^(md|markdown|mdown)$/.test(ext) ? 'md' : ext === 'txt' || ext === 'text' ? 'txt' : ext === 'docx' ? 'docx' : 'md';
      d.fileHandle = main._handle && /^(md|markdown|mdown|txt|text|docx)$/.test(ext) ? main._handle : null;
      d.dirHandle = dirHandle || null;
      d.fileExt = ext;
      SW.ed.setMarkdown(md);
      SW.ed.setModified(false);
      files.saveDraft();
      const missing = [...SW.ed.root().querySelectorAll('img')].filter((i) => !/^(https?:|data:|blob:)/.test(i.getAttribute('src') || '') && !SW.hasAsset(i.dataset.src)).length;
      SW.message('Opened ' + main.name + (missing ? '. ' + missing + ' picture(s) not found: use Open folder, or select the pictures together with the document.' : ''), missing ? 9000 : 3500);
    } catch (e) {
      console.error(e);
      SW.message('Could not open the file: ' + (e.message || e), 8000);
    }
  };

  files.bibChanged = function () {
    const fm = doc().fm;
    SW.ed.syncMetaFromSource();
    if (SW.bib.text.trim() && !fm.meta.bibliography) SW.setMeta(fm, 'bibliography', 'references.bib');
    SW.ed.metaChanged();
  };

  /* ---------- saving ---------- */
  const TYPES = {
    md: { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
    docx: { description: 'Word document', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } },
    html: { description: 'Web page', accept: { 'text/html': ['.html'] } },
    txt: { description: 'Plain text', accept: { 'text/plain': ['.txt'] } },
    zip: { description: 'Zip archive', accept: { 'application/zip': ['.zip'] } }
  };
  function suggestedName() { const d = doc(); return d.name || firstHeading(SW.ed.getMarkdown()).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'document'; }
  async function writeHandle(h, blob) { const w = await h.createWritable(); await w.write(blob); await w.close(); }
  async function pickSave(name, fmt) {
    if (!window.showSaveFilePicker) return null;
    try { return await window.showSaveFilePicker({ suggestedName: name + '.' + fmt, types: [TYPES[fmt]] }); }
    catch (e) { if (e.name === 'AbortError') throw e; return null; }
  }
  async function build(fmt) {
    const md = SW.ed.getMarkdown();
    if (fmt === 'md') return new Blob([md], { type: 'text/markdown' });
    if (fmt === 'txt') return new Blob([files.plainText(md)], { type: 'text/plain' });
    if (fmt === 'html') return new Blob([await files.htmlPage(md)], { type: 'text/html' });
    if (fmt === 'docx') return SW.exportDocx(md);
  }
  files.save = async function (forceAs) {
    const d = doc();
    if (d.view === 'md') SW.ed.syncMetaFromSource();
    let name = suggestedName(), fmt = d.format || 'md';
    if (forceAs || (!d.fileHandle && !d.dirHandle && !d.savedOnce)) {
      const r = await SW.dlg.saveAs(name, fmt);
      if (!r) return;
      name = r.name; fmt = r.fmt;
      if (fmt === 'pdf') { files.print(); return; }
      d.fileHandle = null; d.dirHandle = d.format === 'md' && fmt === 'md' ? d.dirHandle : null;
    }
    try {
      const md = SW.ed.getMarkdown();
      const wantZip = fmt === 'zip';                    // everything in one .zip: the document, pictures, video and audio
      const pics = fmt === 'md' || wantZip ? usedAssets(md) : [];
      const bib = (fmt === 'md' || wantZip) && SW.bib.text.trim() ? (d.fm.meta.bibliography || 'references.bib') : '';
      if (wantZip || (fmt === 'md' && (pics.length || bib))) {
        // the document plus its pictures: into a folder when the browser can, otherwise a .zip
        if (!wantZip && !d.dirHandle && window.showDirectoryPicker) {
          const ok = await SW.dlg.ask('Save with pictures', 'The pictures and references are saved as separate files next to the document (in an images folder). Choose the folder to save into.', [{ label: 'Download a .zip instead', value: 'zip' }, { label: 'Choose folder…', value: 'ok', primary: true }]);
          if (ok === 'ok') { try { d.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { return; } }
          else if (ok !== 'zip') return;
        }
        if (!wantZip && d.dirHandle) {
          const fh = await d.dirHandle.getFileHandle(name + '.md', { create: true });
          await writeHandle(fh, new Blob([md], { type: 'text/markdown' }));
          for (const p of pics) {
            const parts = p.split('/'); let dir = d.dirHandle;
            for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true });
            const ph = await dir.getFileHandle(parts[parts.length - 1], { create: true });
            await writeHandle(ph, SW.assetBlob(p));
          }
          if (bib) await writeHandle(await d.dirHandle.getFileHandle(bib.split('/').pop(), { create: true }), new Blob([SW.bib.text], { type: 'text/plain' }));
          done(name, 'md', 'Saved ' + name + '.md with ' + pics.length + ' picture(s) in the folder ' + d.dirHandle.name);
          return;
        }
        await SW.libs.jszip();
        const zip = new JSZip();
        zip.file(name + '.md', md);
        for (const p of pics) zip.file(p, SW.assetBlob(p), isMedia(SW.assetBlob(p), p) ? { compression: 'STORE' } : undefined);   // video and audio are already compressed
        if (bib) zip.file(bib.split('/').pop(), SW.bib.text);
        const blob = await zip.generateAsync({ type: 'blob' });
        const h = await pickSave(name, 'zip').catch(() => 'abort');
        if (h === 'abort') return;
        if (h) await writeHandle(h, blob); else SW.download(blob, name + '.zip');
        done(name, 'md', 'Saved ' + name + '.zip (the document and its ' + (pics.length ? pics.length + ' picture/media file(s)' : 'files') + ')');
        d.fileHandle = null;
        return;
      }
      const blob = await build(fmt);
      let h = d.fileHandle && !forceAs && d.format === fmt ? d.fileHandle : null;
      if (!h) { h = await pickSave(name, fmt).catch(() => 'abort'); if (h === 'abort') return; }
      if (h) { await writeHandle(h, blob); if (fmt === 'md' || fmt === 'docx' || fmt === 'txt') d.fileHandle = h; }
      else SW.download(blob, name + '.' + fmt);
      done(name, fmt, 'Saved ' + name + '.' + fmt);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error(e);
      SW.message('Could not save: ' + (e.message || e), 8000);
    }
  };
  function done(name, fmt, msg) {
    const d = doc();
    d.savedOnce = true;
    if (fmt === 'md' || fmt === 'docx' || fmt === 'txt') d.format = fmt;
    SW.ed.setName(name);
    SW.ed.setModified(false);
    files.saveDraft();
    SW.message(msg + (fmt === 'docx' || fmt === 'txt' ? '' : ''), 5000);
  }

  files.print = function () {
    if (doc().view === 'md') SW.ed.setView('doc');
    const t = document.title; document.title = suggestedName();
    SW.ed.deselect();
    setTimeout(() => { window.print(); document.title = t; }, 50);
  };

  // plain text: what the reader sees, equations as LaTeX
  files.plainText = function (md) {
    const r = SW.renderForExport(md).root;
    r.querySelectorAll('.math').forEach((m) => {
      if (m.classList.contains('display')) { const p = document.createElement('p'); p.textContent = m.dataset.tex + (m.dataset.num ? '   (' + m.dataset.num + ')' : ''); m.replaceWith(p); }
      else m.replaceWith(document.createTextNode(m.dataset.tex));
    });
    r.querySelectorAll('[data-secnum]').forEach((h) => h.prepend(h.getAttribute('data-secnum') + ' '));
    r.querySelectorAll('li > input[type=checkbox]').forEach((c) => c.replaceWith(c.hasAttribute('checked') ? '[x] ' : '[ ] '));
    r.querySelectorAll('.media').forEach((m) => { const v = m.querySelector('video, audio, iframe'); m.replaceWith(Object.assign(document.createElement('p'), { textContent: '[' + (v && v.nodeName === 'AUDIO' ? 'audio' : 'video') + ': ' + (v && v.nodeName === 'IFRAME' ? v.dataset.src || '' : ((v && v.dataset.src) || '').split('/').pop()) + ']' })); });
    r.querySelectorAll('.code-block').forEach((c) => { const p = document.createElement('pre'); p.textContent = c.dataset.code; c.replaceWith(p); });
    r.querySelectorAll('img').forEach((i) => i.replaceWith(document.createTextNode(i.alt ? '[' + i.alt + ']' : '[picture]')));
    r.querySelectorAll('.pagebreak').forEach((p) => p.replaceWith(document.createTextNode('\f')));
    r.querySelectorAll('li').forEach((li) => { const ol = li.parentNode.nodeName === 'OL'; let d = 0, p = li.parentNode; while (p && p !== r) { if (p.nodeName === 'LI') d++; p = p.parentNode; } li.prepend('\u00A0'.repeat(4 * d) + (li.classList.contains('task') ? '' : ol ? ([...li.parentNode.children].indexOf(li) + 1) + '. ' : '\u2022 ')); });
    r.querySelectorAll('tr').forEach((tr) => { [...tr.cells].forEach((c, i) => { if (i) c.prepend('\t'); }); });
    // innerText needs a rendered element
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;white-space:normal';
    box.appendChild(r); document.body.appendChild(box);
    const t = r.innerText; box.remove();
    return t.replace(/\u00A0/g, ' ').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  };

  // a single self-contained web page: MathML equations, pictures embedded
  files.htmlPage = async function (md) {
    const { root, meta } = SW.renderForExport(md);
    root.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    root.querySelectorAll('.math[data-tex]').forEach((m) => {
      let tex = m.dataset.tex; const disp = m.classList.contains('display'); if (disp && m.dataset.num) tex += ' \\tag{' + m.dataset.num + '}';
      try { m.innerHTML = katex.renderToString(tex, { displayMode: disp, output: 'mathml', throwOnError: false, strict: false }); } catch (e) { m.textContent = tex; }
    });
    for (const img of root.querySelectorAll('img')) {
      const b = SW.assetBlob(img.dataset.src || '');
      if (b) img.src = await SW.blobToDataUrl(b);
      img.removeAttribute('data-src');
    }
    for (const m of root.querySelectorAll('video, audio')) {      // small files are embedded; big ones stay as files next to the page
      const name = m.dataset.src || '', b = SW.assetBlob(name);
      m.removeAttribute('data-src'); m.removeAttribute('style'); m.setAttribute('controls', '');
      if (b && b.size < 10e6) m.src = await SW.blobToDataUrl(b); else m.setAttribute('src', name);
    }
    const s = SW.ed.settings();
    const title = SW.esc(doc().name || firstHeading(md) || 'Document');
    const css = 'body{max-width:' + SW.paperInfo(s.paper).dims[0] + ';margin:2rem auto;padding:0 1.5rem;font-family:' + SW.fontStack(s.font).replace(/"/g, "'") + ';font-size:' + s.size + ';line-height:' + (parseFloat(s.line) * 1.2).toFixed(2) + ';color:#1d1d1d}' +
      'h1,h2,h3,h4{color:#1f3864;line-height:1.25}table{border-collapse:collapse;margin:.4em auto}th,td{border:1px solid #999;padding:.25em .55em}th{background:#f0f0f0}' +
      'img{max-width:100%}figure{text-align:center;margin:1em auto}figcaption,.tcap{text-align:center;font-size:.92em}.num{font-weight:600}.math.display{display:block;text-align:center;margin:.5em 0;overflow-x:auto}' +
      'blockquote{border-left:3px solid #b4c3dc;margin:0 0 .6em;padding-left:1em;color:#444}code{background:#f2f2f2;padding:0 .25em;border-radius:3px;font-size:.9em}.code-block pre{background:#f6f8fa;padding:.6em .8em;overflow-x:auto;border-radius:4px}' +
      '.fn{font-size:.75em;vertical-align:super}.cite,.xref{color:#0563c1;text-decoration:none}mark.comment{background:#fde9b6}.pagebreak{break-after:page}.toc ul{list-style:none;padding-left:1.2em}.toc>ul{padding-left:0}.toc-title{font-weight:600}' +
      '.derived section{margin-top:1.5em;border-top:1px solid #ccc;font-size:.9em}.refs{list-style:none;padding-left:2.2em}.refs .rn{position:absolute;margin-left:-2.2em}.refs li{position:relative}' +
      (/^(true|yes)$/i.test(meta.numbersections || '') ? 'h1[data-secnum]::before,h2[data-secnum]::before,h3[data-secnum]::before,h4[data-secnum]::before{content:attr(data-secnum) "\\2002"}' : '');
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="Simple Write">\n<title>' + title + '</title>\n<style>' + css + '</style>\n</head>\n<body>\n' + root.innerHTML + '\n</body>\n</html>\n';
  };

  /* ---------- clipboard: the whole document ---------- */
  files.copyAll = async function (rich) {
    try {
      const md = SW.ed.getMarkdown();
      if (!rich) { await navigator.clipboard.writeText(md); SW.message('Copied the Markdown.'); return; }
      const { root } = SW.renderForExport(md);
      const x = SW.ed.clipboardFor(root);
      if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([x.html], { type: 'text/html' }), 'text/plain': new Blob([files.plainText(md)], { type: 'text/plain' }) })]);
      else await navigator.clipboard.writeText(files.plainText(md));
      SW.message('Copied the formatted document: paste it into Word or an email.');
    } catch (e) { SW.message('Could not copy: ' + e.message); }
  };
})();
