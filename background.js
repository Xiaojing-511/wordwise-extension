'use strict';

/* 后台 Service Worker：负责网络翻译请求（规避页面 CORS） */
const GOOGLE = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY = 'https://api.mymemory.translated.net/get';
const MAX = 2000;

/* Google 非官方免费接口：自动检测语言 */
function googleTranslate(text, tl) {
  const url = GOOGLE + '?client=gtx&sl=auto&tl=' + tl + '&dt=t&q=' + encodeURIComponent(text);
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('google http ' + r.status);
      return r.json();
    })
    .then(function (j) {
      if (!Array.isArray(j) || !Array.isArray(j[0])) throw new Error('google bad payload');
      let translated = '';
      const segs = j[0];
      for (let i = 0; i < segs.length; i++) {
        if (segs[i] && segs[i][0]) translated += segs[i][0];
      }
      const detected = typeof j[2] === 'string' ? j[2] : '';
      return { translated: translated, detected: detected };
    });
}

/* MyMemory 公开 API：网络翻译（第二来源） */
function mymemoryTranslate(text, pair) {
  const url = MYMEMORY + '?q=' + encodeURIComponent(text) + '&langpair=' + pair;
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('mymemory http ' + r.status);
      return r.json();
    })
    .then(function (j) {
      const t = j && j.responseData && j.responseData.translatedText;
      if (!t) throw new Error('mymemory empty');
      return { translated: t };
    });
}

function doTranslate(text) {
  const out = { en2zh: null, zh2en: null, network: null, detected: '', error: null };
  const clean = String(text || '').slice(0, MAX);

  const g1 = googleTranslate(clean, 'zh-CN')
    .then(function (r) { out.en2zh = r.translated; out.detected = r.detected || out.detected; })
    .catch(function () { out.error = out.error || '英→中 翻译失败'; });

  const g2 = googleTranslate(clean, 'en')
    .then(function (r) { out.zh2en = r.translated; })
    .catch(function () { out.error = out.error || '中→英 翻译失败'; });

  return Promise.all([g1, g2]).then(function () {
    const detected = out.detected || '';
    const isZh = detected.indexOf('zh') === 0;
    const pair = isZh ? 'zh-CN|en' : 'en|zh-CN';
    return mymemoryTranslate(clean, pair)
      .then(function (r) { out.network = r.translated; return out; })
      .catch(function () { out.network = null; return out; });
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'translate') {
    doTranslate(msg.text).then(sendResponse, function () {
      sendResponse({ error: '翻译服务异常' });
    });
    return true; // 异步响应
  }
});