'use strict';

var WORDS_KEY = 'wordwise.words';
var SETTINGS_KEY = 'wordwise.settings';
var ext = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
var allWords = {};

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmt(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); } catch (e) { return ''; }
}

function loadSettings() {
  ext.storage.local.get(SETTINGS_KEY).then(function (d) {
    var s = d[SETTINGS_KEY] || {};
    $('autoSpeak').checked = !!s.autoSpeak;
    $('showNetwork').checked = s.showNetwork !== false;
    $('markLearned').checked = s.markLearned !== false;
    $('rate').value = s.rate == null ? 1 : s.rate;
    $('rateVal').textContent = Number($('rate').value).toFixed(1);
  });
}

function saveSettings() {
  var obj = {};
  obj[SETTINGS_KEY] = {
    autoSpeak: $('autoSpeak').checked,
    showNetwork: $('showNetwork').checked,
    markLearned: $('markLearned').checked,
    rate: parseFloat($('rate').value) || 1
  };
  ext.storage.local.set(obj).then(function () {
    $('saveHint').style.opacity = 1;
    setTimeout(function () { $('saveHint').style.opacity = 0; }, 900);
  });
}

function loadWords() {
  ext.storage.local.get(WORDS_KEY).then(function (d) {
    allWords = d[WORDS_KEY] || {};
    renderStats();
    renderList();
  });
}

function renderStats() {
  var keys = Object.keys(allWords);
  var total = 0;
  for (var i = 0; i < keys.length; i++) total += allWords[keys[i]].count || 0;
  $('stats').textContent = keys.length ? keys.length + ' 词 · 学习 ' + total + ' 次' : '';
}

function renderList() {
  var q = $('search').value.trim().toLowerCase();
  var ul = $('wordList');
  var items = Object.keys(allWords).map(function (k) { return allWords[k]; });
  items = items.filter(function (w) {
    if (!q) return true;
    return (w.display || '').toLowerCase().indexOf(q) >= 0 || (w.key || '').indexOf(q) >= 0;
  });
  items.sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });
  ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = '<li class="empty">暂无记录，去网页上划词试试吧～</li>';
    return;
  }
  var shown = items.slice(0, 200);
  for (var i = 0; i < shown.length; i++) {
    (function (w) {
      var li = document.createElement('li');
      li.innerHTML =
        '<div class="w-main">' +
        '<div class="w-text">' + esc(w.display || w.key) + '</div>' +
        '<div class="w-sub">学习 ' + (w.count || 0) + ' 次 · 最近 ' + esc(fmt(w.lastSeen)) + '</div>' +
        '</div>' +
        '<button class="del" type="button" title="删除">✕</button>';
      li.querySelector('.del').addEventListener('click', function () {
        delete allWords[w.key];
        var obj = {};
        obj[WORDS_KEY] = allWords;
        ext.storage.local.set(obj).then(loadWords);
      });
      ul.appendChild(li);
    })(shown[i]);
  }
}

$('search').addEventListener('input', renderList);
$('clearAll').addEventListener('click', function () {
  if (!window.confirm('确定清空全部学习记录？')) return;
  var obj = {};
  obj[WORDS_KEY] = {};
  ext.storage.local.set(obj).then(loadWords);
});
['autoSpeak', 'showNetwork', 'markLearned'].forEach(function (id) {
  $(id).addEventListener('change', saveSettings);
});
$('rate').addEventListener('input', function () {
  $('rateVal').textContent = Number($('rate').value).toFixed(1);
  saveSettings();
});

loadSettings();
loadWords();