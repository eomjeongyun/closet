'use strict';

import { removeBackground } from './onnx/background-removal.min.mjs';

const ONNX_PUBLIC_PATH = new URL('./onnx/', import.meta.url).href;
const DB_NAME = 'closet';
const DB_VERSION = 1;
const CATEGORIES = ['상의', '하의', '치마', '바지', '신발'];

const $ = s => document.querySelector(s);
let db;
let items = new Map();
let canvasState = { id: 'home', placements: [] };
let activeCategory = '전체';
let pendingImage = null;
let pendingCategory = CATEGORIES[0];
let selectedPlacementId = null;
let armedDeleteId = null;
let canvasSaveTimer = null;
let toastTimer = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains('items')) database.createObjectStore('items', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('canvas')) database.createObjectStore('canvas', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = tx(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbPut(store, value) {
  return new Promise((resolve, reject) => {
    const req = tx(store, 'readwrite').put(value);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
}
function idbDelete(store, id) {
  return new Promise((resolve, reject) => {
    const req = tx(store, 'readwrite').delete(id);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

function switchScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `${name}-screen`));
  $('#home-screen').hidden = name !== 'home';
  $('#wardrobe-screen').hidden = name !== 'wardrobe';
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.screen === name));
  if (name === 'wardrobe') renderWardrobe();
}
function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

async function loadAll() {
  const list = await idbGetAll('items');
  items = new Map(list.map(i => [i.id, i]));
  const canvasRows = await idbGetAll('canvas');
  const home = canvasRows.find(r => r.id === 'home');
  if (home) canvasState = home;
}

function queueSaveCanvas() {
  clearTimeout(canvasSaveTimer);
  canvasSaveTimer = setTimeout(() => {
    idbPut('canvas', { ...canvasState, updatedAt: new Date().toISOString() }).catch(() => {});
  }, 400);
}

function renderCanvas() {
  const canvas = $('#canvas');
  canvas.querySelectorAll('.canvas-item').forEach(el => el.remove());
  $('#canvasEmpty').hidden = canvasState.placements.length > 0;
  canvasState.placements.forEach(p => {
    const item = items.get(p.itemId);
    if (!item) return;
    const el = document.createElement('div');
    el.className = 'canvas-item' + (p.id === selectedPlacementId ? ' selected' : '');
    el.dataset.id = p.id;
    const h = p.w * (item.h / item.w);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${p.w}px`;
    el.style.height = `${h}px`;
    el.innerHTML = `<img src="${item.image}" alt="${item.category}" draggable="false"><button class="item-remove" type="button" aria-label="빼기">×</button><div class="item-resize"></div>`;
    canvas.appendChild(el);
  });
}

function bindCanvasEvents() {
  const canvas = $('#canvas');
  canvas.addEventListener('pointerdown', e => {
    const itemEl = e.target.closest('.canvas-item');
    if (!itemEl) { selectedPlacementId = null; renderCanvas(); return; }
    const id = itemEl.dataset.id;
    if (e.target.closest('.item-remove')) {
      canvasState.placements = canvasState.placements.filter(p => p.id !== id);
      selectedPlacementId = null;
      queueSaveCanvas();
      renderCanvas();
      return;
    }
    selectedPlacementId = id;
    const placement = canvasState.placements.find(p => p.id === id);
    canvasState.placements = canvasState.placements.filter(p => p.id !== id);
    canvasState.placements.push(placement);
    renderCanvas();

    const canvasRect = canvas.getBoundingClientRect();
    if (e.target.closest('.item-resize')) {
      const startX = e.clientX;
      const startW = placement.w;
      const onMove = ev => {
        const dx = ev.clientX - startX;
        placement.w = Math.max(40, Math.min(canvasRect.width, startW + dx));
        renderCanvas();
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        queueSaveCanvas();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      return;
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = placement.x;
    const startTop = placement.y;
    const onMove = ev => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      placement.x = Math.max(-placement.w * 0.3, Math.min(canvasRect.width - placement.w * 0.7, startLeft + dx));
      placement.y = Math.max(-placement.w * 0.3, Math.min(canvasRect.height - placement.w * 0.3, startTop + dy));
      renderCanvas();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      queueSaveCanvas();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });

  $('#clearCanvas').addEventListener('click', () => {
    canvasState.placements = [];
    selectedPlacementId = null;
    queueSaveCanvas();
    renderCanvas();
  });
}

function addItemToCanvas(itemId) {
  const canvas = $('#canvas');
  const rect = canvas.getBoundingClientRect();
  const count = canvasState.placements.length;
  const w = Math.min(150, rect.width * 0.4);
  const placement = {
    id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    itemId,
    x: Math.max(10, rect.width / 2 - w / 2 + (count % 5) * 14),
    y: Math.max(10, rect.height / 2 - w / 2 + (count % 5) * 14),
    w,
  };
  canvasState.placements.push(placement);
  queueSaveCanvas();
}

function renderCategoryTabs() {
  const wrap = $('#categoryTabs');
  const tabs = ['전체', ...CATEGORIES];
  wrap.innerHTML = tabs.map(c => `<button class="category-tab${c === activeCategory ? ' active' : ''}" data-category="${c}" type="button">${c}</button>`).join('');
}

function renderWardrobe() {
  renderCategoryTabs();
  const grid = $('#wardrobeGrid');
  const list = Array.from(items.values())
    .filter(i => activeCategory === '전체' || i.category === activeCategory)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!list.length) {
    grid.innerHTML = '<p class="wardrobe-empty">아직 담긴 옷이 없어요<br>+ 버튼으로 옷 사진을 추가해보세요</p>';
    return;
  }
  grid.innerHTML = list.map(i => `
    <div class="wardrobe-item${armedDeleteId === i.id ? ' armed' : ''}" data-id="${i.id}">
      <img src="${i.image}" alt="${i.category}" draggable="false">
      <div class="delete-mark">한 번 더 탭하면<br>삭제돼요</div>
    </div>
  `).join('');
}

function bindWardrobeEvents() {
  $('#categoryTabs').addEventListener('click', e => {
    const btn = e.target.closest('.category-tab');
    if (!btn) return;
    activeCategory = btn.dataset.category;
    renderWardrobe();
  });
  $('#wardrobeGrid').addEventListener('click', async e => {
    const el = e.target.closest('.wardrobe-item');
    if (!el) return;
    const id = el.dataset.id;
    if (armedDeleteId === id) {
      await idbDelete('items', id);
      items.delete(id);
      canvasState.placements = canvasState.placements.filter(p => p.itemId !== id);
      queueSaveCanvas();
      armedDeleteId = null;
      renderWardrobe();
      renderCanvas();
      toast('옷을 지웠어요.');
      return;
    }
    if (e.target.closest('.delete-mark')) {
      armedDeleteId = id;
      renderWardrobe();
      setTimeout(() => { if (armedDeleteId === id) { armedDeleteId = null; renderWardrobe(); } }, 3000);
      return;
    }
    addItemToCanvas(id);
    renderCanvas();
    switchScreen('home');
    toast('홈에 추가했어요.');
  });
}

function fileToBitmap(file) {
  return createImageBitmap(file);
}
async function resizeToBlob(source, maxDim, mime, quality) {
  const bitmap = source instanceof ImageBitmap ? source : await createImageBitmap(source);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function imageSize(dataURL) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = dataURL;
  });
}

function setProgress(pct, text) {
  $('#progressFill').style.width = `${Math.max(4, Math.min(100, pct))}%`;
  if (text) $('#progressText').textContent = text;
}

async function handlePhoto(file) {
  $('#progressSheet').hidden = false;
  setProgress(4, '배경 지우는 중...');
  try {
    const inputBlob = await resizeToBlob(file, 1280, 'image/jpeg', 0.88);
    let resultBlob;
    try {
      resultBlob = await removeBackground(inputBlob, {
        publicPath: ONNX_PUBLIC_PATH,
        model: 'isnet_quint8',
        device: 'cpu',
        output: { format: 'image/png' },
        progress: (key, current, total) => {
          const pct = total ? (current / total) * 100 : 4;
          const label = key.includes('models') ? 'AI 모델을 불러오는 중...' : key.includes('onnxruntime') ? '엔진을 불러오는 중...' : '배경 지우는 중...';
          setProgress(pct, label);
        },
      });
      setProgress(100, '마무리하는 중...');
    } catch (err) {
      resultBlob = inputBlob;
      toast('배경 지우기에 실패해서 원본으로 저장했어요.');
    }
    const finalBlob = await resizeToBlob(resultBlob, 900, 'image/png', 1);
    const dataURL = await blobToDataURL(finalBlob);
    const size = await imageSize(dataURL);
    pendingImage = { dataURL, w: size.w, h: size.h };
    pendingCategory = CATEGORIES[0];
    $('#previewImage').src = dataURL;
    renderCategoryPicker();
    $('#progressSheet').hidden = true;
    $('#categorySheet').hidden = false;
  } catch (err) {
    $('#progressSheet').hidden = true;
    toast('사진을 처리하지 못했어요. 다시 시도해주세요.');
  }
}

function renderCategoryPicker() {
  $('#categoryPicker').innerHTML = CATEGORIES.map(c => `<button type="button" data-category="${c}" class="${c === pendingCategory ? 'active' : ''}">${c}</button>`).join('');
}

function bindAddFlow() {
  $('#addButton').addEventListener('click', () => $('#photoInput').click());
  $('#photoInput').addEventListener('change', () => {
    const file = $('#photoInput').files[0];
    $('#photoInput').value = '';
    if (file) handlePhoto(file);
  });
  $('#categoryPicker').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    pendingCategory = btn.dataset.category;
    renderCategoryPicker();
  });
  $('#cancelSave').addEventListener('click', () => {
    pendingImage = null;
    $('#categorySheet').hidden = true;
  });
  $('#confirmSave').addEventListener('click', async () => {
    if (!pendingImage) return;
    const item = {
      id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
      category: pendingCategory,
      image: pendingImage.dataURL,
      w: pendingImage.w,
      h: pendingImage.h,
      createdAt: new Date().toISOString(),
    };
    await idbPut('items', item);
    items.set(item.id, item);
    addItemToCanvas(item.id);
    pendingImage = null;
    $('#categorySheet').hidden = true;
    switchScreen('home');
    renderCanvas();
    toast('옷장에 담았어요.');
  });
}

function bindTabBar() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchScreen(t.dataset.screen)));
}

async function dailyBackup() {
  try {
    const todayKey = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('closet-backup-date') === todayKey) return;
    const meta = Array.from(items.values()).map(i => ({ id: i.id, category: i.category, createdAt: i.createdAt }));
    const res = await fetch('https://appointee-unnoticed-donated.ngrok-free.dev/api/app-backup/closet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    if (res.ok) localStorage.setItem('closet-backup-date', todayKey);
  } catch (e) { /* offline or PC off: skip silently */ }
}

async function init() {
  bindCanvasEvents();
  bindWardrobeEvents();
  bindAddFlow();
  bindTabBar();
  try {
    db = await openDB();
    await loadAll();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) { /* IndexedDB unavailable */ }
  renderCanvas();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
  }
  setTimeout(dailyBackup, 3000);
}

init();
