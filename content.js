
(() => {
  'use strict';

  /* ================= 配置 ================= */
  const WORDS_KEY = 'wordwise.words';
  const SETTINGS_KEY = 'wordwise.settings';
  const MAX_TEXT = 2000;
  const MAX_WORDS = 3000;
  const DEFAULT_SETTINGS = { autoSpeak: false, showNetwork: true, markLearned: true, rate: 1 };

  const ext = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

  /* ================= 工具 ================= */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function normalize(s) {
    return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function storeGet(key, fallback) {
    return ext.storage.local.get(key).then(function (d) {
      return d && d[key] !== undefined ? d[key] : fallback;
    }).catch(function () { return fallback; });
  }
  function storeSet(key, value) {
    const obj = {};
    obj[key] = value;
    return ext.storage.local.set(obj).catch(function () {});
  }

  /* ================= 调试 / 显隐辅助 ================= */
  const DEBUG = true;
  function dbg() {
    if (!DEBUG) return;
    try {
      const args = Array.prototype.slice.call(arguments);
      args.unshift('[WordWise]');
      console.log.apply(console, args);
    } catch (e) { /* ignore */ }
  }
  /* 显隐统一走 style.display，不依赖 hidden 属性（避免被页面/自身样式覆盖） */
  function show(el) { el.hidden = false; el.style.display = ''; }
  function hide(el) { el.hidden = true; el.style.display = 'none'; }

  /* ================= 样式（Shadow DOM 内注入，不受页面样式干扰） ================= */
  const STYLE_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
/* 修复：作者样式 display:flex 会覆盖 UA 的 [hidden] 规则，这里强制让 hidden 生效 */
.ww-logo[hidden], .ww-card[hidden], .ww-toast[hidden], .ww-logo-badge[hidden] { display: none !important; }
.ww-logo {
  position: fixed; z-index: 2147483647; pointer-events: auto;
  left: -9999px; top: -9999px; /* 默认移出屏幕，未定位前绝不显示在页面角落 */
  width: 34px; height: 34px; border-radius: 50%;
  background: linear-gradient(135deg, #5b8cff 0%, #3b5bdb 100%);
  border: 2px solid #ffffff;
  box-shadow: 0 3px 10px rgba(20, 40, 120, 0.35);
  cursor: pointer; padding: 0; outline: none;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 15px; font-weight: 700; line-height: 1;
  font-family: "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  user-select: none; -webkit-user-select: none;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.ww-logo:hover { transform: scale(1.1); box-shadow: 0 4px 14px rgba(20, 40, 120, 0.45); }
.ww-logo:active { transform: scale(0.94); }
.ww-logo.ww-busy { animation: ww-pulse 0.9s ease-in-out infinite; }
@keyframes ww-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.14); } }
.ww-logo-badge {
  position: absolute; top: -8px; right: -16px;
  background: #16a34a; color: #fff;
  font-size: 9px; font-weight: 700; line-height: 1;
  padding: 3px 6px; border-radius: 9px;
  white-space: nowrap; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  pointer-events: none;
}
.ww-card {
  position: fixed; z-index: 2147483647; pointer-events: auto;
  left: -9999px; top: -9999px; /* 默认移出屏幕，未定位前不显示 */
  width: 360px; max-height: 75vh; overflow-y: auto;
  background: #ffffff; color: #1f2937;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(10, 20, 60, 0.28), 0 2px 8px rgba(10, 20, 60, 0.12);
  border: 1px solid rgba(59, 91, 219, 0.18);
  padding: 12px 14px;
  font-family: "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  font-size: 13px; line-height: 1.55;
}
.ww-head { display: flex; gap: 8px; align-items: flex-start; }
.ww-source-wrap { flex: 1; min-width: 0; }
.ww-source { font-size: 14px; font-weight: 600; color: #111827; word-break: break-word; max-height: 72px; overflow: hidden; }
.ww-meta { margin-top: 4px; font-size: 11px; color: #6b7280; }
.ww-meta .ww-dot { color: #3b5bdb; margin-right: 3px; }
.ww-learned { color: #16a34a; font-weight: 600; }
.ww-new { color: #3b5bdb; font-weight: 600; }
.ww-spk {
  flex: none; width: 30px; height: 30px; border-radius: 50%;
  border: 1px solid #e5e7eb; background: #f9fafb; cursor: pointer;
  font-size: 14px; line-height: 1; padding: 0;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.12s ease;
}
.ww-spk:hover { background: #eef2ff; }
.ww-sec { margin-top: 10px; padding-top: 10px; border-top: 1px solid #f0f1f4; }
.ww-sec-title { font-size: 11px; color: #9ca3af; font-weight: 600; margin-bottom: 6px; }
.ww-sec-title .ww-src { color: #6b7280; font-weight: 400; margin-left: 4px; }
.ww-row { display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px; border-radius: 8px; background: #f8fafc; margin-bottom: 6px; }
.ww-row-label { flex: none; font-size: 11px; color: #3b5bdb; font-weight: 700; background: #eef2ff; border-radius: 5px; padding: 1px 6px; margin-top: 1px; }
.ww-row-val { flex: 1; min-width: 0; word-break: break-word; cursor: pointer; }
.ww-row-val:hover { color: #3b5bdb; }
.ww-row-empty { flex: 1; color: #9ca3af; }
.ww-spk-sm { flex: none; border: none; background: transparent; cursor: pointer; font-size: 13px; padding: 0 2px; opacity: 0.75; }
.ww-spk-sm:hover { opacity: 1; }
.ww-net-empty { font-size: 12px; color: #9ca3af; padding: 4px 2px; }
.ww-error { margin-top: 8px; font-size: 12px; color: #dc2626; background: #fef2f2; border-radius: 8px; padding: 6px 8px; }
.ww-foot { margin-top: 8px; font-size: 10px; color: #c0c4cc; text-align: center; }
.ww-toast {
  position: fixed; z-index: 2147483647; pointer-events: none;
  background: rgba(17, 24, 39, 0.9); color: #fff;
  font-size: 12px; padding: 5px 12px; border-radius: 8px;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  white-space: nowrap;
}
.ww-card::-webkit-scrollbar { width: 6px; }
.ww-card::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
`;

  /* ================= 状态 ================= */
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let selText = '';
  let selInfo = null;
  let cardOpen = false;
  let busy = false;
  let lastSelection = null;
  let dismissed = false; // 用户主动取消（点击外部/Esc/滚动）后，同一选区不再自动弹出
  let toastTimer = null;

  storeGet(SETTINGS_KEY, {}).then(function (s) {
    settings = Object.assign({}, DEFAULT_SETTINGS, s);
  });

  try {
  ext.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) {
      settings = Object.assign({}, DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
    }
    if (changes[WORDS_KEY] && cardOpen && selText) {
      const words = changes[WORDS_KEY].newValue || {};
      selInfo = words[normalize(selText)] || null;
      updateBadge();
    }
  });
  } catch (e) { dbg('storage.onChanged 注册失败', e); }

  /* ================= Shadow UI ================= */
  const host = document.createElement('div');
  host.id = 'wordwise-host';
  host.setAttribute('data-wordwise', '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE_CSS;
  shadow.appendChild(styleEl);

  const logo = document.createElement('button');
  logo.className = 'ww-logo';
  logo.type = 'button';
  logo.title = '划词翻译';
  logo.setAttribute('aria-label', '划词翻译');
  logo.innerHTML = '<span class="ww-logo-glyph">译</span><span class="ww-logo-badge" hidden></span>';
  hide(logo);
  logo.addEventListener('mousedown', function (e) { e.preventDefault(); });
  logo.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleCard(); });

  const card = document.createElement('div');
  card.className = 'ww-card';
  hide(card);

  const toast = document.createElement('div');
  toast.className = 'ww-toast';
  hide(toast);

  shadow.appendChild(logo);
  shadow.appendChild(card);
  shadow.appendChild(toast);
  (document.body || document.documentElement).appendChild(host);

  /* ================= 选区检测 ================= */
  function currentSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    let rect = null;
    try {
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      if (rects && rects.length > 0) {
        rect = rects[rects.length - 1];
      } else {
        // 回退：getClientRects 为空时使用选区整体包围盒
        const br = range.getBoundingClientRect();
        if (br && (br.width || br.height)) rect = br;
      }
      if (!rect) return null;
    } catch (e) { return null; }
    let node = sel.anchorNode;
    if (node && node.nodeType === 3) node = node.parentNode;
    if (node && (host.contains(node) || card.contains(node))) return null;
    const text = sel.toString().trim();
    if (!text) return null;
    return { text: text, rect: rect };
  }

  function onSelection() {
    if (cardOpen || busy) return;
    const cur = currentSelection();
    if (!cur) { hideLogo(); lastSelection = null; dismissed = false; return; }
    // 选区不可见（零尺寸或完全在视口外）时不显示 Logo，避免其被钳制到左上角
    const r = cur.rect;
    if (!r || (r.width === 0 && r.height === 0) || r.bottom <= 0 || r.right <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) {
      hideLogo();
      return;
    }
    if (dismissed) {
      // 用户已取消：同一选区不再自动弹出，直到选区内容变化
      if (lastSelection && lastSelection.text === cur.text) return;
      dismissed = false;
    }
    lastSelection = cur;
    selText = cur.text.length > MAX_TEXT ? cur.text.slice(0, MAX_TEXT) : cur.text;
    positionLogo(cur.rect);
    show(logo);
    dbg('划词显示 Logo:', JSON.stringify(selText.slice(0, 40)), 'rect:', JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height }));
    checkLearned(selText).then(function (info) {
      if (lastSelection && lastSelection.text === cur.text) {
        selInfo = info;
        updateBadge();
      }
    });
  }

  let selTimer = null;
  document.addEventListener('selectionchange', function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(onSelection, 60);
  });
  document.addEventListener('mouseup', function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(onSelection, 0);
  }, true);
  document.addEventListener('scroll', function () {
    if (!cardOpen) { hideLogo(); dismissed = true; }
  }, true);
  window.addEventListener('resize', hideAll);
  document.addEventListener('mousedown', function (e) {
    if (host.contains(e.target)) return;
    if (cardOpen) {
      hideAll();
    } else if (!logo.hidden) {
      // 点击页面其它位置（未打开卡片）也隐藏 Logo，并抑制同一选区弹回
      hideLogo();
      dismissed = true;
      dbg('隐藏 Logo（点击外部取消）');
    }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideAll();
  }, true);

  /* ================= 定位 ================= */
  function positionLogo(rect) {
    const size = 34;
    let x = rect.right + 6;
    let y = rect.top - size / 2;
    if (x + size > window.innerWidth - 6) x = Math.max(6, rect.left - size - 6);
    x = Math.max(6, Math.min(x, window.innerWidth - size - 6));
    y = Math.max(6, y);
    logo.style.left = x + 'px';
    logo.style.top = y + 'px';
  }

  function positionCard() {
    card.style.visibility = 'hidden';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = Math.min(360, vw - 16);
    card.style.width = cw + 'px';
    const ch = card.offsetHeight;
    const r = logo.getBoundingClientRect();
    let x = r.right + 10;
    if (x + cw > vw - 8) x = Math.max(8, r.left - cw - 10);
    x = Math.max(8, x);
    let y = r.top;
    if (y + ch > vh - 8) y = Math.max(8, vh - ch - 8);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
    card.style.visibility = 'visible';
  }

  function hideLogo() { hide(logo); }

  function hideAll() {
    hideLogo();
    hide(card);
    cardOpen = false;
    dismissed = true;
  }

  function updateBadge() {
    const badge = logo.querySelector('.ww-logo-badge');
    if (!settings.markLearned || !selInfo) {
      hide(badge);
      badge.textContent = '';
      return;
    }
    show(badge);
    badge.textContent = '已学 ' + selInfo.count;
  }

  /* ================= 学习记录 ================= */
  function checkLearned(text) {
    if (!settings.markLearned) return Promise.resolve(null);
    const key = normalize(text);
    if (!key) return Promise.resolve(null);
    return storeGet(WORDS_KEY, {}).then(function (words) {
      return words[key] || null;
    });
  }

  function recordLearned(text) {
    const key = normalize(text);
    if (!key) return Promise.resolve(null);
    return storeGet(WORDS_KEY, {}).then(function (words) {
      const now = Date.now();
      const prev = words[key];
      const info = {
        key: key,
        display: text.slice(0, 200),
        count: (prev && prev.count ? prev.count : 0) + 1,
        firstSeen: (prev && prev.firstSeen) || now,
        lastSeen: now
      };
      words[key] = info;
      const keys = Object.keys(words);
      if (keys.length > MAX_WORDS) {
        keys.sort(function (a, b) { return (words[a].lastSeen || 0) - (words[b].lastSeen || 0); });
        keys.slice(0, keys.length - MAX_WORDS).forEach(function (k) { delete words[k]; });
      }
      return storeSet(WORDS_KEY, words).then(function () { return info; });
    });
  }

  /* ================= 朗读（Web Speech API） ================= */
  function langForDetected(d) {
    if (!d) return 'en-US';
    const s = String(d).toLowerCase();
    if (s.indexOf('zh') === 0) return 'zh-CN';
    if (s.indexOf('en') === 0) return 'en-US';
    if (s.indexOf('ja') === 0) return 'ja-JP';
    if (s.indexOf('ko') === 0) return 'ko-KR';
    if (s.indexOf('fr') === 0) return 'fr-FR';
    if (s.indexOf('de') === 0) return 'de-DE';
    if (s.indexOf('es') === 0) return 'es-ES';
    if (s.indexOf('ru') === 0) return 'ru-RU';
    return 'en-US';
  }

  function speak(text, lang) {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = lang;
      u.rate = settings.rate || 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  /* ================= 翻译卡片 ================= */
  function toggleCard() {
    if (!selText) return;
    if (cardOpen) { hideAll(); return; }
    openCard();
  }

  function openCard() {
    if (busy) return;
    const text = selText;
    if (!text) return;
    busy = true;
    logo.classList.add('ww-busy');
    recordLearned(text)
      .then(function (info) {
        selInfo = info;
        updateBadge();
        return ext.runtime.sendMessage({ type: 'translate', text: text });
      })
      .then(function (res) {
        renderCard(text, selInfo, res || {});
        positionCard();
        show(card);
        cardOpen = true;
        if (settings.autoSpeak && res && !res.error) speak(text, langForDetected(res.detected));
      })
      .catch(function () {
        renderCard(text, selInfo, { error: '翻译服务连接失败，请检查网络后重试' });
        positionCard();
        show(card);
        cardOpen = true;
      })
      .then(function () {
        busy = false;
        logo.classList.remove('ww-busy');
      });
  }

  function transRow(label, lang, value, emptyText) {
    if (!value) {
      return '<div class="ww-row"><span class="ww-row-label">' + label + '</span><span class="ww-row-empty">' + esc(emptyText) + '</span></div>';
    }
    return '<div class="ww-row"><span class="ww-row-label">' + label + '</span><span class="ww-row-val" data-copy="' + esc(value) + '">' + esc(value) + '</span><button class="ww-spk-sm" type="button" data-lang="' + lang + '" data-text="' + esc(value) + '" title="朗读">🔊</button></div>';
  }

  function renderCard(text, info, res) {
    const detected = res.detected || '';
    const langSrc = langForDetected(detected);
    const srcLabel = detected
      ? (detected.indexOf('zh') === 0 ? '中文' : detected.indexOf('en') === 0 ? '英文' : detected)
      : '自动检测';
    const parts = [];

    parts.push('<div class="ww-head">');
    parts.push('<div class="ww-source-wrap">');
    parts.push('<div class="ww-source">' + esc(text) + '</div>');
    parts.push('<div class="ww-meta"><span class="ww-dot">●</span>' + esc(srcLabel));
    if (info) parts.push(' · <span class="ww-learned">已学习 ' + info.count + ' 次</span>');
    else parts.push(' · <span class="ww-new">首次学习</span>');
    parts.push('</div></div>');
    parts.push('<button class="ww-spk" type="button" data-lang="' + langSrc + '" data-text="' + esc(text) + '" title="朗读源文本">🔊</button>');
    parts.push('</div>');

    parts.push('<div class="ww-sec">');
    parts.push('<div class="ww-sec-title">中英互译 <span class="ww-src">Google</span></div>');
    parts.push(transRow('英 → 中', 'zh-CN', res.en2zh || '', '翻译失败或不可用'));
    parts.push(transRow('中 → 英', 'en-US', res.zh2en || '', '翻译失败或不可用'));
    parts.push('</div>');

    if (settings.showNetwork) {
      parts.push('<div class="ww-sec">');
      parts.push('<div class="ww-sec-title">网络翻译 <span class="ww-src">MyMemory</span></div>');
      if (res.network) parts.push(transRow('网络译文', langSrc, res.network, ''));
      else parts.push('<div class="ww-net-empty">网络翻译暂不可用（服务限流或网络异常）</div>');
      parts.push('</div>');
    }

    if (res.error) parts.push('<div class="ww-error">⚠ ' + esc(res.error) + '</div>');
    parts.push('<div class="ww-foot">点击译文可复制 · 点击 🔊 朗读</div>');
    card.innerHTML = parts.join('');

    const spks = card.querySelectorAll('.ww-spk, .ww-spk-sm');
    for (let i = 0; i < spks.length; i++) {
      (function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          speak(b.getAttribute('data-text'), b.getAttribute('data-lang'));
        });
      })(spks[i]);
    }
    const cops = card.querySelectorAll('[data-copy]');
    for (let j = 0; j < cops.length; j++) {
      (function (el) {
        el.addEventListener('click', function () {
          copyText(el.getAttribute('data-copy'));
        });
      })(cops[j]);
    }
  }

  /* ================= 复制 ================= */
  function copyText(t) {
    const done = function () { toastShow('已复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t, done); });
    } else {
      fallbackCopy(t, done);
    }
  }
  function fallbackCopy(t, done) {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;top:-999px;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function toastShow(msg) {
    const r = card.getBoundingClientRect();
    toast.textContent = msg;
    toast.style.left = Math.round(r.left + r.width / 2 - 30) + 'px';
    toast.style.top = Math.round(r.top - 32) + 'px';
    show(toast);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { hide(toast); }, 1200);
  }

  dbg('content script loaded');
})();
