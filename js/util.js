/* Simple Write: shared helpers */
(function () {
  'use strict';
  const SW = window.SW = window.SW || {};

  SW.$ = (id) => document.getElementById(id);
  SW.esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  SW.O = ''; SW.C = '';   // private-use brackets for placeholders

  SW.store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  SW.debounce = (fn, ms) => { let t = 0; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = () => { clearTimeout(t); fn(); }; d.cancel = () => clearTimeout(t); return d; };

  SW.slug = (t) => String(t).toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

  SW.message = function (t, ms) {
    const m = SW.$('st-msg'); if (!m) return;
    m.textContent = t; clearTimeout(SW.message.t);
    SW.message.t = setTimeout(() => { m.textContent = ''; }, ms || 3500);
  };

  // load a script once: the local copy in lib/ first, then the CDN
  const loading = {};
  SW.loadScript = function (local, cdn, test) {
    if (test && test()) return Promise.resolve();
    if (loading[local]) return loading[local];
    const one = (src) => new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
    loading[local] = one(local).catch(() => cdn ? one(cdn) : Promise.reject(new Error('could not load ' + local)))
      .then(() => { if (test && !test()) throw new Error('library did not start: ' + local); })
      .catch((e) => { delete loading[local]; throw e; });
    return loading[local];
  };
  SW.libs = {
    hljs: () => SW.loadScript('lib/highlight.min.js', 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.10.0/highlight.min.js', () => window.hljs),
    jszip: () => SW.loadScript('lib/jszip.min.js', 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', () => window.JSZip),
  };

  SW.cssColorToHex = function (c) {
    if (!c) return '';
    c = c.trim();
    const m = c.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return 'transparent';
      return '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
    }
    return c.toLowerCase();
  };

  SW.blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  SW.dataUrlToBlob = function (url) {
    const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
    if (!m) return null;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] || 'application/octet-stream' });
  };

  SW.download = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  /* ---------- MathML -> LaTeX (pasting from Simple Solver, Word, MathJax pages) ---------- */
  const GREEK_TEX = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ϵ': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ϑ': 'vartheta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'varsigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi', 'ϕ': 'varphi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
    'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi', 'Σ': 'Sigma', 'Υ': 'Upsilon', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega', 'ℏ': 'hbar', 'ℓ': 'ell', '∞': 'infty', '∂': 'partial', '∇': 'nabla' };
  const OP_TEX = { '×': '\\times', '·': '\\cdot', '⋅': '\\cdot', '±': '\\pm', '∓': '\\mp', '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx', '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow', '∫': '\\int', '∑': '\\sum', '∏': '\\prod', '−': '-', '∈': '\\in', '∉': '\\notin', '∝': '\\propto', '≡': '\\equiv', '∼': '\\sim', '≪': '\\ll', '≫': '\\gg', '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots', '∘': '\\circ', '∥': '\\parallel', '⊥': '\\perp', '∧': '\\wedge', '∨': '\\vee', '⊂': '\\subset', '⊆': '\\subseteq', '∪': '\\cup', '∩': '\\cap', '°': '^\\circ', '′': "'", '″': "''", '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '\\&', '$': '\\$', '∮': '\\oint', '∬': '\\iint', '∭': '\\iiint', '√': '\\surd', '⟨': '\\langle', '⟩': '\\rangle', '∖': '\\setminus', '∅': '\\emptyset', '∀': '\\forall', '∃': '\\exists', '≃': '\\simeq', '≅': '\\cong', '⊗': '\\otimes', '⊕': '\\oplus', '†': '\\dagger', '⌈': '\\lceil', '⌉': '\\rceil', '⌊': '\\lfloor', '⌋': '\\rfloor', '¬': '\\neg', '⇀': '\\rightharpoonup', '↦': '\\mapsto', '≜': '\\triangleq', '≔': ':=', '∠': '\\angle', '△': '\\triangle', '⋆': '\\star', '∗': '\\ast', '⊙': '\\odot', '‖': '\\|', '⁡': '', '⁢': '', '⁣': '', '⁤': '' };
  const ACCENT_TEX = { '¯': 'bar', 'ˉ': 'bar', '‾': 'overline', '_': 'overline', '^': 'hat', 'ˆ': 'hat', '̂': 'hat', '˙': 'dot', '¨': 'ddot', '→': 'vec', '⃗': 'vec', '~': 'tilde', '˜': 'tilde', '̃': 'tilde', 'ˇ': 'check', '˘': 'breve', '´': 'acute', '`': 'grave' };
  const BIGOP = /^(∑|∏|∫|∮|∬|∭|⋃|⋂|lim|max|min|sup|inf|limsup|liminf|det)$/;
  const LOWER_FN = /^(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|coth|exp|ln|log|lg|lim|max|min|sup|inf|det|dim|ker|deg|gcd|arg|Pr|hom)$/;
  SW.TEX_MAPS = { GREEK_TEX, OP_TEX, ACCENT_TEX, LOWER_FN };

  function mmlToTex(el) {
    const kids = (n) => [...n.children].map(mmlToTex).join('');
    const g = (t) => '{' + t + '}';
    const gb = (t) => /^(\\[A-Za-z]+|[^\\{}\s])\s*$/.test(t) ? t.trim() : g(t);
    const kid = (n, i) => n.children[i] ? mmlToTex(n.children[i]) : '';
    const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
    const tag = el.localName.toLowerCase();
    switch (tag) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'menclose': case 'mmultiscripts': case 'mtd': case 'mth': case 'merror': return kids(el);
      case 'semantics': return kid(el, 0);
      case 'annotation': case 'annotation-xml': case 'mphantom': case 'none': case 'mprescripts': return '';
      case 'mn': return text(el);
      case 'mi': {
        const t = text(el);
        if (GREEK_TEX[t]) return '\\' + GREEK_TEX[t] + ' ';
        if (OP_TEX[t] !== undefined) return OP_TEX[t] + ' ';
        if (t.length === 1) return el.getAttribute('mathvariant') === 'normal' && /[A-Za-z]/.test(t) ? '\\mathrm{' + t + '}' : t;
        if (LOWER_FN.test(t)) return '\\' + t + ' ';
        return '\\mathrm{' + t + '}';
      }
      case 'mo': {
        const t = text(el);
        if (OP_TEX[t] !== undefined) return OP_TEX[t] + ' ';
        if (GREEK_TEX[t]) return '\\' + GREEK_TEX[t] + ' ';
        if (LOWER_FN.test(t)) return '\\' + t + ' ';
        return t;
      }
      case 'mtext': { const t = el.textContent; return t.trim() ? '\\text{' + t.replace(/[{}\\#%&$_^~]/g, (c) => '\\' + c) + '}' : '\\ '; }
      case 'ms': return '\\text{"' + el.textContent + '"}';
      case 'mspace': { const w = parseFloat(el.getAttribute('width') || '0'); return w >= 1.5 ? '\\qquad ' : w >= 0.8 ? '\\quad ' : w > 0 ? '\\, ' : ''; }
      case 'mfrac': return (/^0/.test(el.getAttribute('linethickness') || '') ? '\\binom' : '\\frac') + g(kid(el, 0)) + g(kid(el, 1));
      case 'msqrt': return '\\sqrt' + g(kids(el));
      case 'mroot': return '\\sqrt[' + kid(el, 1) + ']' + g(kid(el, 0));
      case 'msup': return gb(kid(el, 0)) + '^' + g(kid(el, 1));
      case 'msub': return gb(kid(el, 0)) + '_' + g(kid(el, 1));
      case 'msubsup': return gb(kid(el, 0)) + '_' + g(kid(el, 1)) + '^' + g(kid(el, 2));
      case 'munder': case 'mover': case 'munderover': {
        const b = el.children[0], baseT = b ? text(b) : '', base = kid(el, 0);
        if (tag === 'mover') {
          const acc = ACCENT_TEX[text(el.children[1] || el)];
          if (acc) return '\\' + acc + g(base);
          return BIGOP.test(baseT) ? base + '^' + g(kid(el, 1)) : '\\overset' + g(kid(el, 1)) + g(base);
        }
        if (tag === 'munder') {
          const u = text(el.children[1] || el);
          if (u === '⏟') return '\\underbrace' + g(base);
          if (u === '_' || u === '‾' || u === '¯') return '\\underline' + g(base);
          return BIGOP.test(baseT) ? base + '_' + g(kid(el, 1)) : '\\underset' + g(kid(el, 1)) + g(base);
        }
        return base + '_' + g(kid(el, 1)) + '^' + g(kid(el, 2));
      }
      case 'mfenced': {
        const open = el.getAttribute('open') ?? '(', close = el.getAttribute('close') ?? ')', sep = (el.getAttribute('separators') || ',')[0];
        const f = (c) => c === '{' ? '\\{' : c === '}' ? '\\}' : c || '.';
        return '\\left' + f(open) + [...el.children].map(mmlToTex).join(sep) + '\\right' + f(close);
      }
      case 'mtable': return '\\begin{matrix} ' + [...el.children].map((r) => [...r.children].map(mmlToTex).join(' & ')).join(' \\\\ ') + ' \\end{matrix}';
      default: return el.children.length ? kids(el) : text(el);
    }
  }
  SW.cleanTex = (t) => String(t).replace(/\s+/g, ' ').replace(/\s*([_^])\s*/g, '$1').trim();
  SW.mmlToTex = (el) => SW.cleanTex(mmlToTex(el));
  SW.mmlStringToTex = function (s) {
    const doc = new DOMParser().parseFromString(s, 'text/html');
    const m = doc.querySelector('math');
    if (!m) return null;
    const ann = m.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"], annotation[encoding="TeX"]');
    return ann ? ann.textContent.trim() : SW.mmlToTex(m);
  };
})();
