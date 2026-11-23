/* Simple Write: menus, toolbar, views, start-up */
(function () {
  'use strict';
  const SW = window.SW, $ = SW.$, ed = SW.ed;
  const ui = SW.ui = {};

  /* ---------- menus ---------- */
  let openMenu = null;
  function closeMenus() { document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; }); document.querySelectorAll('.menu-btn.open').forEach((b) => b.classList.remove('open')); openMenu = null; }
  function showMenu(menu, anchor) {
    const was = openMenu === menu;
    closeMenus();
    if (was) return;
    if (SW.doc.view === 'doc') ed.saveRange();
    const r = anchor.getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 6) + 'px';
    menu.style.top = r.bottom + 2 + 'px';
    openMenu = menu;
    anchor.classList.add('open');
  }
  document.querySelectorAll('.menu-btn').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => showMenu($(b.dataset.menu), b));
    b.addEventListener('mouseenter', () => { if (openMenu && openMenu !== $(b.dataset.menu)) showMenu($(b.dataset.menu), b); });
  });
  document.addEventListener('mousedown', (e) => { if (openMenu && !e.target.closest('.menu') && !e.target.closest('.menu-btn') && !e.target.closest('#btn-color') && !e.target.closest('#btn-hilite')) closeMenus(); });
  document.querySelectorAll('.menu button[data-act]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { closeMenus(); act(b.dataset.act); });
  });

  function act(a) {
    const f = SW.files;
    switch (a) {
      case 'marks': return ed.toggleMarks();
      case 'dictate': return SW.dictate.toggle();
      case 'aitag': return SW.ai.insertTag();
      case 'csv': return SW.importCsv();
      case 'media': return SW.media.pick();
      case 'mediaurl': return SW.media.fromUrl();
      case 'transcribe': return SW.dictate.fromFile();
      case 'super': return toggleSuper();
      case 'present': return SW.present.start(false);
      case 'presenthere': return SW.present.start(true);
      case 'sorter': return SW.sorter.open();
      case 'aibar': return SW.ai.toggleBar();
      case 'aisetup': return SW.ai.setup();
      case 'ruler': return SW.layout.toggleRuler();
      case 'columns': return SW.layout.toggleColumns();
      case 'zoomin': return SW.layout.zoomBy(0.1);
      case 'zoomout': return SW.layout.zoomBy(-0.1);
      case 'zoomfit': return SW.layout.setZoom('fit');
      case 'new': return f.newWindow();
      case 'open': return f.open();
      case 'openFolder': return f.openFolder();
      case 'drafts': return f.showDrafts();
      case 'save': return f.save(false);
      case 'saveAs': return f.save(true);
      case 'print': return f.print();
      case 'copyMd': return f.copyAll(false);
      case 'copyRich': return f.copyAll(true);
      case 'pageSetup': return SW.dlg.pageSetup();
      case 'userName': return askName();
      case 'outline': return ui.togglePane('outline');
      case 'comments': return ui.togglePane('comments');
      case 'dark': return toggleDark();
      case 'focus': return toggleFocus();
      case 'replace': return SW.dlg.replace();
      default:
        if (SW.doc.view !== 'doc') { ed.setView('doc'); }
        return ed.cmd(a);
    }
  }
  ui.act = act;

  /* ---------- ribbon ---------- */
  document.querySelectorAll('.ribbon [data-cmd]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => ed.cmd(b.dataset.cmd));
  });
  const selStyle = $('sel-style'), selFont = $('sel-font'), selSize = $('sel-size');
  selFont.innerHTML = '<option value="">Font</option><option value="-">(Document font)</option>' + SW.FONTS.map((f) => '<option style="font-family:\'' + f + '\'">' + f + '</option>').join('');
  const SIZES = ['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '20', '24', '28', '36', '48'];
  selSize.innerHTML = '<option value="">Size</option><option value="-">(Document size)</option>' + SIZES.map((s) => '<option value="' + s + 'pt">' + s + '</option>').join('');
  [selStyle, selFont, selSize].forEach((s) => s.addEventListener('mousedown', () => ed.saveRange()));
  function restoreAnd(fn) { const r = ed.saved; ed.saved = null; ed.root().focus({ preventScroll: true }); if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); } fn(); }
  selStyle.addEventListener('change', () => restoreAnd(() => ed.cmd('formatBlock', selStyle.value)));
  selFont.addEventListener('change', () => { const v = selFont.value; restoreAnd(() => ed.cmd('font', v === '-' ? '' : v)); });
  selSize.addEventListener('change', () => { const v = selSize.value; restoreAnd(() => ed.cmd('size', v === '-' ? '' : v)); });

  // color palettes
  const COLORS = ['#000000', '#7f7f7f', '#c00000', '#e36c09', '#b8860b', '#00b050', '#00a0a0', '#0070c0', '#1f3864', '#7030a0', '#ff0000', '#ff66cc'];
  const HILITES = ['#ffff00', '#00ff00', '#00ffff', '#ff99cc', '#ffc000', '#d9d9d9'];
  function buildPalette(menu, colors, cmd, bar, noneLabel) {
    menu.innerHTML = '';
    for (const c of colors) {
      const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.title = c;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { closeMenus(); $(bar).style.background = c; restoreAnd(() => ed.cmd(cmd, c)); ui['last' + cmd] = c; });
      menu.appendChild(b);
    }
    const n = document.createElement('button'); n.type = 'button'; n.className = 'wide'; n.textContent = noneLabel;
    n.addEventListener('mousedown', (e) => e.preventDefault());
    n.addEventListener('click', () => { closeMenus(); restoreAnd(() => ed.cmd(cmd, '')); });
    menu.appendChild(n);
  }
  buildPalette($('menu-color'), COLORS, 'color', 'color-bar', 'Automatic (remove color)');
  buildPalette($('menu-hilite'), HILITES, 'hilite', 'hilite-bar', 'No highlight');
  for (const [btn, menu] of [['btn-color', 'menu-color'], ['btn-hilite', 'menu-hilite']]) {
    $(btn).addEventListener('mousedown', (e) => e.preventDefault());
    $(btn).addEventListener('click', () => showMenu($(menu), $(btn)));
  }

  // keep the ribbon in step with the cursor
  const STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'];
  ui.syncToolbar = function (r) {
    for (const c of STATE_CMDS) { const b = document.querySelector('.ribbon [data-cmd="' + c + '"]'); if (b) b.classList.toggle('on', ed.queryState(c)); }
    const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    const blk = el.closest('h1,h2,h3,h4,h5,h6,blockquote,p,li,td,th');
    const tag = blk ? blk.nodeName.toLowerCase() : 'p';
    selStyle.value = /^(h[1-6]|blockquote)$/.test(tag) ? tag : el.closest('blockquote') ? 'blockquote' : 'p';
    const span = el.closest('span[style]');
    const fam = span && span.style.fontFamily ? span.style.fontFamily.split(',')[0].replace(/['"]/g, '').trim() : '';
    selFont.value = SW.FONTS.includes(fam) ? fam : '';
    const sz = span && el.closest('span[style*="font-size"]') ? el.closest('span[style*="font-size"]').style.fontSize : '';
    selSize.value = SIZES.map((s) => s + 'pt').includes(sz) ? sz : '';
    const code = el.closest('code');
    document.querySelector('.ribbon [data-cmd="code"]').classList.toggle('on', !!(code && !code.closest('.obj')));
    document.querySelector('.ribbon [data-cmd="checklist"]').classList.toggle('on', !!el.closest('li.task'));
  };

  /* ---------- views and panes ---------- */
  $('v-toggle').addEventListener('click', () => ed.setView(SW.doc.view === 'doc' ? 'md' : 'doc'));
  ui.viewChanged = function (v) {
    $('v-toggle').textContent = v === 'doc' ? 'Show Markdown' : 'Show Document';
    $('v-toggle').title = v === 'doc' ? 'Switch to the Markdown source (Ctrl+/)' : 'Switch back to the formatted document (Ctrl+/)';
    document.querySelectorAll('.ribbon .fmt, .ribbon select').forEach((b) => { b.disabled = v !== 'doc'; });
    if (SW.layout) SW.layout.viewChanged();
    if (SW.ai) SW.ai.viewChanged();
  };
  ui.togglePane = function (which, force) {
    const p = $(which + '-pane');
    p.hidden = force === undefined ? !p.hidden : !force;
    $('ck-' + which).classList.toggle('on', !p.hidden);
    SW.store.set('sw.pane.' + which, p.hidden ? '0' : '1');
    if (which === 'outline') ed.updateOutline(); else ed.updateComments();
  };
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => ui.togglePane(b.dataset.close, false)));
  ui.commentCount = function (n) {
    // the pane opens by itself the first time a document has comments
    if (n && !ui.sawComments) { ui.sawComments = true; if (SW.store.get('sw.pane.comments') !== '0' && $('comments-pane').hidden) ui.togglePane('comments', true); }
    if (!n) ui.sawComments = false;
  };
  function toggleDark(force) {
    const on = force === undefined ? !document.body.classList.contains('dark') : force;
    document.body.classList.toggle('dark', on);
    $('ck-dark').classList.toggle('on', on);
    $('hljs-css').href = on ? 'lib/hljs-github-dark.css' : 'lib/hljs-github.css';
    SW.store.set('sw.dark', on ? '1' : '0');
  }
  function toggleFocus(force, quiet) {
    const on = force === undefined ? !document.body.classList.contains('focus') : force;
    document.body.classList.toggle('focus', on);
    $('ck-focus').classList.toggle('on', on);
    if (on && !quiet) SW.message('Focus mode: press Esc to bring the toolbars back.');
  }
  // super-focus: focus mode plus the browser's full screen, so its own toolbars go too
  let superOn = false;
  function toggleSuper(force) {
    const on = force === undefined ? !superOn : force;
    if (on === superOn) return;
    if (on) {
      if (!document.documentElement.requestFullscreen) { SW.message('This browser cannot go full screen. Try its own full-screen key (F11).', 6000); return; }
      superOn = true; toggleFocus(true, true);
      document.documentElement.requestFullscreen().then(() => SW.message('Super-focus: press Esc to leave.', 3500)).catch(() => { superOn = false; toggleFocus(false); SW.message('The browser would not go full screen.', 5000); });
    } else {
      superOn = false; toggleFocus(false);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }
  // Esc (or F11) leaves full screen by itself: bring the toolbars back too
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && superOn) { superOn = false; toggleFocus(false); } });

  /* ---------- your name (for comments) ---------- */
  ui.userName = () => SW.store.get('sw.user') || '';
  async function askName() {
    const v = await SW.dlg.ask('Your name', 'Shown with your comments, also in Word files.', [{ label: 'Cancel', value: 'cancel' }, { label: 'OK', value: 'ok', primary: true }], ui.userName());
    if (v !== null) SW.store.set('sw.user', v.trim());
  }

  /* ---------- keys that work everywhere ---------- */
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (openMenu) { closeMenus(); return; }
      if (document.body.classList.contains('focus') && !document.querySelector('dialog[open]')) { if (superOn) toggleSuper(false); else toggleFocus(false); return; }
    }
    if (document.querySelector('dialog[open]')) return;
    if (!mod || e.altKey) return;
    const c = e.code;
    if (c === 'KeyS') { e.preventDefault(); SW.files.save(e.shiftKey); }
    else if (c === 'KeyO') { e.preventDefault(); SW.files.open(); }
    else if (c === 'KeyP') { e.preventDefault(); SW.files.print(); }
    else if (c === 'KeyH') { e.preventDefault(); SW.dlg.replace(); }
    else if (c === 'Digit8' && e.shiftKey) { e.preventDefault(); if (SW.doc.view === 'doc') ed.toggleMarks(); }
    else if (c === 'KeyF' && e.shiftKey) { e.preventDefault(); toggleSuper(); }
    else if (c === 'Space' && e.shiftKey) { e.preventDefault(); SW.dictate.toggle(); }
    else if (c === 'Slash') { e.preventDefault(); ed.setView(SW.doc.view === 'doc' ? 'md' : 'doc'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'F5' && !document.querySelector('dialog[open]')) { e.preventDefault(); SW.present.start(e.shiftKey); } });
  window.addEventListener('beforeunload', (e) => {
    SW.files.saveDraft();
    if (SW.doc.modified && !ed.isEmpty()) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') SW.files.saveDraft(); });
  // dropping a file anywhere opens it
  document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); SW.files.openFiles([...e.dataTransfer.files]);
  });

  /* ---------- keep the ribbon on one line: shrink it a step at a time ---------- */
  function fitRibbon() {
    const rb = $('ribbon'), kids = [...rb.children].filter((k) => k.offsetParent !== null);
    if (!kids.length) return;
    const oneLine = () => { const t = kids.map((k) => k.offsetTop); return Math.max(...t) - Math.min(...t) < 12; };
    rb.classList.remove('c1', 'c2');
    if (oneLine()) return;
    rb.classList.add('c1');
    if (oneLine()) return;
    rb.classList.add('c2');            // c2 builds on c1; if it still wraps, the ribbon takes two lines
  }
  window.addEventListener('resize', SW.debounce(fitRibbon, 100));

  /* ---------- start ---------- */
  ed.init();
  fitRibbon();
  SW.layout.start();
  if (SW.store.get('sw.marks') === '1') ed.toggleMarks(true);
  if (SW.store.get('sw.dark') === '1') toggleDark(true);
  if (SW.store.get('sw.pane.outline') === '1') ui.togglePane('outline', true);
  if (SW.store.get('sw.pane.comments') === '1') ui.togglePane('comments', true);
  ui.viewChanged('doc');
  SW.files.start().then(() => { ed.root().focus(); SW.ai.start(); });
  // installable and usable offline: only where a service worker is allowed (https or localhost)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
