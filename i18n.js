/* Multi-language runtime for the Naples guide.
   The app is written in English. This file translates the rendered DOM (text nodes + a few
   attributes) using dictionaries keyed by the ENGLISH text (lang_it.js, lang_fr.js, ...).
   Missing dictionary or missing string -> English is shown. */
(function () {
  'use strict';
  var root = document.querySelector('.phone');
  if (!root) return;
  window.I18N = window.I18N || {};

  var LANGS = [
    { c: 'en', n: 'English' },
    { c: 'it', n: 'Italiano' },
    { c: 'fr', n: 'Français' },
    { c: 'es', n: 'Español' },
    { c: 'de', n: 'Deutsch' }
  ];
  var ATTRS = ['placeholder', 'aria-label', 'title', 'label'];
  var ATTR_SEL = '[placeholder],[aria-label],[title],[label]';
  var POP = ['pizza', 'Pompei', 'sunset', 'free', 'rain', 'museum'];

  function byCode(c) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].c === c) return LANGS[i]; return null; }

  // ---------------------------------------------------------------- flags
  // Simple inline SVG flags (26x18) used as data-URI backgrounds. No ids -> nothing can clash.
  var SVG = {
    en: '<rect width="26" height="18" fill="#012169"/><path d="M0 0L26 18M26 0L0 18" stroke="#fff" stroke-width="3.6"/><path d="M0 0L26 18M26 0L0 18" stroke="#C8102E" stroke-width="1.6"/><path d="M13 0V18M0 9H26" stroke="#fff" stroke-width="6"/><path d="M13 0V18M0 9H26" stroke="#C8102E" stroke-width="3.4"/>',
    it: '<rect width="26" height="18" fill="#fff"/><rect width="8.67" height="18" fill="#009246"/><rect x="17.33" width="8.67" height="18" fill="#CE2B37"/>',
    fr: '<rect width="26" height="18" fill="#fff"/><rect width="8.67" height="18" fill="#0055A4"/><rect x="17.33" width="8.67" height="18" fill="#EF4135"/>',
    es: '<rect width="26" height="18" fill="#AA151B"/><rect y="4.5" width="26" height="9" fill="#F1BF00"/>',
    de: '<rect width="26" height="6" fill="#000"/><rect y="6" width="26" height="6" fill="#DD0000"/><rect y="12" width="26" height="6" fill="#FFCE00"/>'
  };
  function flagUri(c) {
    return 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="18" viewBox="0 0 26 18">' + SVG[c] + '</svg>') + '")';
  }

  // ---------------------------------------------------------------- translator
  var dict = null, dictLang = 'en', cache = Object.create(null);
  function own(d, k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : undefined; }

  function fill(t, args) { return t.replace(/\{(\d)\}/g, function (m, i) { return args[+i] !== undefined ? args[+i] : m; }); }
  // Pattern rules for dynamic strings. Each returns [dictionaryKey, args] or null.
  var RULES = [
    function (s) { var m = /^(\d+) places?$/.exec(s); return m && [m[1] === '1' ? '{0} place' : '{0} places', [m[1]]]; },
    function (s) { var m = /^in (\d+) min$/.exec(s); return m && ['in {0} min', [m[1]]]; },
    function (s) { var m = /^in (\d+) h (\d+) min$/.exec(s); return m && ['in {0} h {1} min', [m[1], m[2]]]; },
    function (s) { var m = /^Then choose the station “(.+)” in the list\.$/.exec(s); return m && ['Then choose the station “{0}” in the list.', [m[1]]]; },
    function (s) { var m = /^Towards (.+)$/.exec(s); return m && ['Towards {0}', [m[1]]]; },
    function (s) { var m = /^Change at (.+)$/.exec(s); return m && ['Change at {0}', [m[1]]]; },
    function (s) { var m = /^Wait (\d+) min$/.exec(s); return m && ['Wait {0} min', [m[1]]]; },
    function (s) { var m = /^(\d+) min$/.exec(s); return m && ['{0} min', [m[1]]]; },
    function (s) { var m = /^([\d.,]+) reviews$/.exec(s); return m && ['{0} reviews', [m[1]]]; },
    function (s) { var m = /^(\d+) min walk$/.exec(s); return m && ['{0} min walk', [m[1]]]; },
    function (s) { var m = /^Line ([^.:;]+)$/.exec(s); return m && ['Line {0}', [m[1]]]; },
    function (s) { var m = /^To ([^.:;]+)$/.exec(s); return m && ['To {0}', [m[1]]]; },
    function (s) { var m = /^Recommended by (\d+) sources$/.exec(s); return m && ['Recommended by {0} sources', [m[1]]]; },
    function (s) { var m = /^Sunset is at (\d\d:\d\d)\. Be there by (\d\d:\d\d)\.$/.exec(s); return m && ['Sunset is at {0}. Be there by {1}.', [m[1], m[2]]]; },
    function (s) { var m = /^Nothing for “([\s\S]*)” yet\.$/.exec(s); return m && ['Nothing for “{0}” yet.', [m[1]]]; },
    function (s) { var m = /^Ranked from public guides, press and aggregate ratings, last checked (.*)\. Opening hours and prices change: please confirm before you go\.$/.exec(s); return m && ['Ranked from public guides, press and aggregate ratings, last checked {0}. Opening hours and prices change: please confirm before you go.', [m[1]]]; },
    function (s) { var m = /^(\d+) not on the map$/.exec(s); return m && ['{0} not on the map', [m[1]]]; },
    function (s) { var m = /^Top 10 · (.*) \(numbers = ranking\)( · .*)?$/.exec(s); return m && ['Top 10 · {0} (numbers = ranking)', [tcore(m[1]), m[2] ? ' · ' + tcore(m[2].slice(3)) : ''], m[2] ? true : false]; },
    function (s) { var m = /^Explore (.+)$/.exec(s); return m && ['Explore {0}', [tcore(m[1])]]; },
    function (s) { var m = /^(.+) \(original\)$/.exec(s); return m && ['{0} (original)', [m[1]]]; },
    // "follow my trip" sentences: one rule per template, built from the dictionary key
    function (s) {
      for (var i = 0; i < FOLLOW_KEYS.length; i++) {
        var k = FOLLOW_KEYS[i], re = new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d\}/g, '(.+?)') + '$'), m = re.exec(s);
        if (m) return [k, m.slice(1)];
      }
      return null;
    }
  ];
  var FOLLOW_KEYS = ["Board line {0} towards {1}", "You are at {0}. Departure {1}.", "Get off now: {0}", "Change here: {0}", "Take line {0} towards {1} at {2}.", "Get off at {0} at the next stop", "Get off at {0} in {1} stops", "Now at {0}.", "Next stop: {0}.", "Go to the station {0}", "You are {0} km from the route. Nearest station on it: {1}.", "Scheduled {0} min ago: may be delayed, check the live board", "Scheduled {0} min ago: may be delayed", "Delayed at least {0} min", "Delayed {0} min", "Expected {0}", "Platform {0}", "Train {0}", "Stops ({0})", "{0} steps"];

  // translate a trimmed English string; returns the same string when nothing is known
  function tcore(s) {
    if (!dict || !s) return s;
    var c = cache[s];
    if (c !== undefined) return c;
    var r = lookup(s);
    cache[s] = r;
    return r;
  }
  function lookup(s) {
    var v = own(dict, s), i, m;
    if (v !== undefined) return v;
    for (i = 0; i < RULES.length; i++) {
      m = RULES[i](s);
      if (m && own(dict, m[0]) !== undefined) {
        var out = fill(dict[m[0]], m[1]);
        // the "Top 10" rule appends an optional tail that the template does not contain
        if (m[2] && out.indexOf(m[1][1]) < 0) out += m[1][1];
        return out;
      }
    }
    if (s.indexOf(' · ') > 0) {
      var parts = s.split(' · '), changed = false;
      var res = parts.map(function (p) { var t = tcore(p.trim()); if (t !== p.trim()) changed = true; return t; });
      if (changed) return res.join(' · ');
    }
    m = /^([^\p{L}\p{N}€{]+)([\s\S]*\S[\s\S]*)$/u.exec(s);   // leading emoji / symbols
    if (m) { var t2 = tcore(m[2]); if (t2 !== m[2]) return m[1] + t2; }
    m = /^([\s\S]*[^\s])(\s*[›…:]+)$/.exec(s);          // trailing punctuation
    if (m) { var t3 = tcore(m[1]); if (t3 !== m[1]) return t3 + m[2]; }
    return s;
  }
  // translate any string, keeping leading / trailing whitespace
  function tr(s) {
    if (!dict || typeof s !== 'string') return s;
    var a = /^\s*/.exec(s)[0], b = /\s*$/.exec(s)[0], core = s.slice(a.length, s.length - b.length);
    if (!core || !/[A-Za-z]/.test(core)) return s;
    return a + tcore(core) + b;
  }
  window.tr = tr;
  // map a search phrase typed in the UI language back to the English word used by the search index
  window.untr = function (s) {
    if (!dict || !s) return s;
    var k = String(s).trim().toLowerCase();
    for (var i = 0; i < POP.length; i++) { if (tr(POP[i]).toLowerCase() === k) return POP[i]; }
    return s;
  };

  // ---------------------------------------------------------------- DOM walker
  var nodes = new WeakMap(), attrs = new WeakMap();
  function noTr(el) { return !!(el && el.closest && el.closest('[translate="no"],script,style')); }

  function doText(n) {
    var p = n.parentNode;
    if (!p || noTr(p)) return;
    var v = n.nodeValue, r = nodes.get(n);
    if (r) {
      if (v !== r.cur) { r.en = v; r.lang = null; }              // the app wrote a new English value
      if (r.lang === dictLang) return;
    } else {
      if (!dict) return;                                           // English mode: nothing to do
      r = { en: v, cur: v, lang: null };
      nodes.set(n, r);
    }
    var en = r.en, nv = en;
    if (dict && /[A-Za-z]/.test(en)) nv = tr(en);
    r.cur = nv; r.lang = dictLang;
    if (n.nodeValue !== nv) n.nodeValue = nv;
  }
  function doAttrs(el) {
    if (noTr(el)) return;
    var rec = attrs.get(el);
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a), r = rec && rec[a];
      if (r) {
        if (v !== r.cur) { r.en = v; r.lang = null; }
        if (r.lang === dictLang) continue;
      } else {
        if (!dict) continue;
        if (!rec) { rec = {}; attrs.set(el, rec); }
        r = rec[a] = { en: v, cur: v, lang: null };
      }
      var nv = dict ? tr(r.en) : r.en;
      r.cur = nv; r.lang = dictLang;
      if (v !== nv) el.setAttribute(a, nv);
    }
  }
  function walk(node) {
    if (node.nodeType === 3) { doText(node); return; }
    if (node.nodeType !== 1) return;
    if (node.matches && node.matches(ATTR_SEL)) doAttrs(node);
    var tw = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null), n;
    while ((n = tw.nextNode())) doText(n);
    var els = node.querySelectorAll(ATTR_SEL);
    for (var i = 0; i < els.length; i++) doAttrs(els[i]);
  }

  var mo = new MutationObserver(function (recs) {
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') doAttrs(r.target);
      else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
    }
    mo.takeRecords();   // drop the records caused by our own writes
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  // ---------------------------------------------------------------- language state + UI
  var cur = 'en', btn = null, menu = null;

  function applyAll() {
    cache = Object.create(null);
    walk(root);
    mo.takeRecords();
    updateUi();
  }
  function loadDict(code, cb) {
    if (window.I18N[code]) { cb(true); return; }
    var s = document.createElement('script');
    s.src = 'lang_' + code + '.js' + (window.APP_V ? '?v=' + window.APP_V : '');
    s.onload = function () { cb(!!window.I18N[code]); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }
  function setLang(code, save) {
    if (!byCode(code)) code = 'en';
    cur = code;
    if (save) { try { localStorage.setItem('lang', code); } catch (e) {} }
    document.documentElement.lang = code;
    updateUi();
    if (code === 'en') { dict = null; dictLang = 'en'; applyAll(); return; }
    loadDict(code, function (ok) {
      if (cur !== code) return;                        // user already picked another language
      dict = ok ? window.I18N[code] : null;            // missing dictionary -> English
      dictLang = ok ? code : 'en';
      applyAll();
    });
  }
  window.setLang = function (c) { setLang(c, true); };
  window.getLang = function () { return cur; };

  function updateUi() {
    if (!btn) return;
    var l = byCode(cur);
    btn.firstChild.style.backgroundImage = flagUri(cur);
    btn.setAttribute('aria-label', (dict ? tr('Language') : 'Language') + ': ' + l.n);
    var items = menu.querySelectorAll('button');
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute('data-c') === cur;
      items[i].className = 'lopt' + (on ? ' on' : '');
      items[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
  function openMenu(open) {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function buildUi() {
    var top = document.querySelector('#home .top');
    if (!top) return;
    btn = document.createElement('button');
    btn.id = 'langbtn'; btn.type = 'button'; btn.className = 'langbtn';
    btn.setAttribute('translate', 'no');
    btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="flag"></span><span class="caret" aria-hidden="true"></span>';
    menu = document.createElement('div');
    menu.id = 'langmenu'; menu.className = 'langmenu'; menu.hidden = true;
    menu.setAttribute('translate', 'no'); menu.setAttribute('role', 'menu');
    LANGS.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'lopt'; b.setAttribute('data-c', l.c);
      b.setAttribute('role', 'menuitemradio'); b.setAttribute('lang', l.c);
      b.innerHTML = '<span class="flag"></span><span class="lname"></span>';
      b.firstChild.style.backgroundImage = flagUri(l.c);
      b.lastChild.textContent = l.n;
      b.onclick = function (e) { e.stopPropagation(); openMenu(false); setLang(l.c, true); btn.focus(); };
      menu.appendChild(b);
    });
    btn.onclick = function (e) { e.stopPropagation(); openMenu(menu.hidden); };
    document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target)) openMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); btn.focus(); } });
    top.appendChild(btn); top.appendChild(menu);
    updateUi();
  }

  // ---------------------------------------------------------------- start
  var saved = null;
  try { saved = localStorage.getItem('lang'); } catch (e) {}
  if (!byCode(saved)) {
    var nav = ((navigator.languages && navigator.languages[0]) || navigator.language || 'en').slice(0, 2).toLowerCase();
    saved = (nav === 'it' || nav === 'fr' || nav === 'es' || nav === 'de') ? nav : 'en';
  }
  cur = saved;
  document.documentElement.lang = cur;
  buildUi();
  if (cur !== 'en') {
    if (window.I18N[cur]) { dict = window.I18N[cur]; dictLang = cur; applyAll(); }
    else if (document.readyState === 'loading') {
      // synchronous load: the dictionary runs before the app scripts, so the first paint is already translated
      window.__i18nLoaded = function (ok) {
        if (ok && window.I18N[cur]) { dict = window.I18N[cur]; dictLang = cur; }
        applyAll();
      };
      document.write('<script src="lang_' + cur + '.js' + (window.APP_V ? '?v=' + window.APP_V : '') + '" onload="__i18nLoaded(true)" onerror="__i18nLoaded(false)"><\/script>');
    } else setLang(cur, false);
  }

  // debugging helper: list texts that are still English in the current language
  window.i18nMissing = function () {
    var out = [], tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), n;
    function add(s) { s = s.trim(); if (s && /[A-Za-z]{3,}/.test(s) && out.indexOf(s) < 0) out.push(s); }
    while ((n = tw.nextNode())) {
      if (noTr(n.parentNode) || (n.parentNode.closest && n.parentNode.closest('#station'))) continue;
      var r = nodes.get(n), v = n.nodeValue;
      var k = v.trim();
      if (own(dict || {}, k) !== undefined) continue;   // known (possibly identical) entry
      if (r && r.cur === v && tr(r.en) === r.en) add(v);
      else if (!r && dict) add(v);
    }
    root.querySelectorAll(ATTR_SEL).forEach(function (el) {
      if (noTr(el)) return;
      ATTRS.forEach(function (a) { if (el.hasAttribute(a)) { var rr = attrs.get(el), en = rr && rr[a] ? rr[a].en : el.getAttribute(a); if (tr(en) === en) add(en); } });
    });
    return out;
  };
})();
