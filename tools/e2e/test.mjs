import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import CDP from 'chrome-remote-interface';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, '..', '..');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8931;
const CDP_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('FATAL: test watchdog timeout'); process.exit(2); }, 90000).unref();

const CONTENT_JS = readFileSync(path.join(extPath, 'content.js'), 'utf8');

const PAGE = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>e2e test</title></head><body>'
  + '<h1>测试页面</h1>'
  + '<p id="text1">Hello world, this is a test paragraph in English for selection.</p>'
  + '<p id="text2">这是一段中文测试文字，用来验证划词翻译功能是否正常工作。</p>'
  + '<p id="text3">Lorem ipsum dolor sit amet consectetur adipiscing elit.</p>'
  + '<script>'
  + 'window.__WW_CHROME_SHIM__ = {'
  + '  storage: {'
  + '    _data: {},'
  + '    local: {'
  + '      get: function (key) {'
  + '        var out = {};'
  + '        if (typeof key === "string") { if (window.__WW_CHROME_SHIM__.storage._data[key] !== undefined) out[key] = window.__WW_CHROME_SHIM__.storage._data[key]; }'
  + '        else if (Array.isArray(key)) { key.forEach(function (k) { if (window.__WW_CHROME_SHIM__.storage._data[k] !== undefined) out[k] = window.__WW_CHROME_SHIM__.storage._data[k]; }); }'
  + '        return Promise.resolve(out);'
  + '      },'
  + '      set: function (obj) { Object.assign(window.__WW_CHROME_SHIM__.storage._data, obj); return Promise.resolve(); }'
  + '    },'
  + '    onChanged: { addListener: function () {} }'
  + '  },'
  + '  runtime: {'
  + '    sendMessage: function (msg) {'
  + '      return Promise.resolve({ en2zh: "你好世界（译）", zh2en: "Hello world (translated)", network: "你好世界（网络译）", detected: "en", error: null });'
  + '    }'
  + '  }'
  + '};'
  + '(function () {'
  + '  var chrome = window.__WW_CHROME_SHIM__;'
  + '  var browser = undefined;'
  + '  try { eval(document.getElementById("contentjs").textContent); window.__WW_ERR = null; }'
  + '  catch (e) { window.__WW_ERR = String(e && e.stack || e); }'
  + '})();'
  + '</script>'
  + '<script type="text/plain" id="contentjs">' + CONTENT_JS + '</script>'
  + '</body></html>';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(PORT, r));

const userDataDir = path.join(os.tmpdir(), 'ww-e2e-' + Date.now());
const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + userDataDir,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,900',
  '--remote-allow-origins=*',
  '--disable-gpu',
  '--disable-gpu-compositing',
  '--in-process-gpu'
], { stdio: 'ignore' });

let ok = false;
for (let i = 0; i < 40 && !ok; i++) {
  try {
    const list = await CDP.List({ port: CDP_PORT });
    ok = list.length > 0;
  } catch { /* not ready */ }
  if (!ok) await sleep(500);
}
if (!ok) {
  console.log(JSON.stringify({ error: 'cdp not ready' }, null, 2));
  chrome.kill(); server.close(); process.exit(1);
}

let client = null;
let report = {};
try {
  const created = await CDP.New({ port: CDP_PORT, url: 'http://localhost:' + PORT + '/' });
  console.log('[diag] created page target:', created.id);
  client = await CDP({ port: CDP_PORT, target: created });
  console.log('[diag] connected to page');

  const { Page, Runtime } = client;
  client.on('Inspector.targetCrashed', (p) => console.log('[diag] TARGET CRASHED:', JSON.stringify(p)));
  client.on('Page.loadEventFired', () => console.log('[diag] loadEventFired'));
  const withTimeout = (p, label, ms) => Promise.race([p, sleep(ms || 8000).then(() => { throw new Error('hang: ' + label); })]);
  await withTimeout(Page.enable(), 'Page.enable');
  console.log('[diag] Page.enable ok');
  await withTimeout(Runtime.enable(), 'Runtime.enable');
  console.log('[diag] Runtime.enable ok');
  await sleep(500);

  const evaluate = async (expression) => {
    const r = await withTimeout(Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true }), 'evaluate:' + String(expression).slice(0, 40));
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result && r.result.value;
  };
  const waitFor = async (expression, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return true;
      await sleep(150);
    }
    return false;
  };

  await waitFor('document.readyState === "complete"', 15000);
  await sleep(400);

  report.contentScriptError = await evaluate('window.__WW_ERR || null');
  report.hostExists = await waitFor('!!document.querySelector("#wordwise-host")', 8000);
  console.log('[step] hostExists =', report.hostExists, '| contentScriptError =', report.contentScriptError);

  report.logoInitial = await evaluate(`(() => {
    const logo = document.querySelector('#wordwise-host').shadowRoot.querySelector('.ww-logo');
    return { display: getComputedStyle(logo).display, hiddenAttr: logo.hidden };
  })()`);

  await evaluate(`(() => {
    const p = document.querySelector('#text1');
    const tn = p.firstChild;
    const range = document.createRange();
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  })()`);
  await sleep(600);
  console.log('[step] selected, reading logo state');

  report.logoAfterSelect = await evaluate(`(() => {
    const logo = document.querySelector('#wordwise-host').shadowRoot.querySelector('.ww-logo');
    const cs = getComputedStyle(logo);
    const r = logo.getBoundingClientRect();
    const pRect = document.querySelector('#text1').getBoundingClientRect();
    return {
      display: cs.display,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height },
      nearSelection: Math.abs(r.x - pRect.right) < 160 && Math.abs(r.y - pRect.top) < 100
    };
  })()`);

  await evaluate(`(() => {
    document.querySelector('#wordwise-host').shadowRoot.querySelector('.ww-logo').click();
  })()`);
  await sleep(700);

  report.card = await evaluate(`(() => {
    const root = document.querySelector('#wordwise-host').shadowRoot;
    const card = root.querySelector('.ww-card');
    const src = card.querySelector('.ww-source');
    return {
      display: getComputedStyle(card).display,
      hasHead: !!src,
      sourceText: src ? src.textContent : '',
      rowLabelCount: card.querySelectorAll('.ww-row-label').length,
      hasNetworkSection: card.textContent.indexOf('网络翻译') >= 0,
      hasLearnedText: card.textContent.indexOf('已学习') >= 0 || card.textContent.indexOf('首次学习') >= 0,
      snippet: card.textContent.slice(0, 200).replace(/\n/g, ' ')
    };
  })()`);

  await evaluate(`(() => {
    document.querySelector('#wordwise-host').shadowRoot.querySelector('.ww-logo').click();
  })()`);
  await sleep(400);

  await evaluate(`(() => {
    const p = document.querySelector('#text1');
    const tn = p.firstChild;
    const range = document.createRange();
    range.setStart(tn, 0); range.setEnd(tn, 5);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  })()`);
  await sleep(800);

  report.badge = await evaluate(`(() => {
    const badge = document.querySelector('#wordwise-host').shadowRoot.querySelector('.ww-logo-badge');
    return { hidden: badge.hidden, text: badge.textContent, display: getComputedStyle(badge).display };
  })()`);
} catch (e) {
  report.error = String((e && e.message) || e);
} finally {
  try { if (client) await client.close(); } catch {}
  chrome.kill();
  server.close();
}

console.log('=== E2E REPORT ===');
console.log(JSON.stringify(report, null, 2));
