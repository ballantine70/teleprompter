'use strict';

// ============================================================
// Firebase — initialise once config.js has loaded
// ============================================================
let db, auth;

async function initFirebase() {
  if (!window.firebaseConfig || firebaseConfig.apiKey === 'YOUR_API_KEY') {
    throw new Error(
      'Firebase is not configured.\n\n' +
      'Open config.js and replace the placeholder values with your ' +
      'Firebase project credentials.\n\n' +
      'See the comments in config.js for step-by-step instructions.'
    );
  }

  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db   = firebase.firestore();

  // Offline persistence — data is cached locally and syncs when online
  try {
    await db.enablePersistence({ synchronizeTabs: true });
  } catch (err) {
    // 'failed-precondition' means multiple tabs open; 'unimplemented' means
    // the browser doesn't support it — both are non-fatal.
    if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
      console.warn('Firestore persistence error:', err);
    }
  }

  // Sign in anonymously.  Firebase persists the UID in IndexedDB so the
  // same user identity is restored across page refreshes automatically.
  const cred = await auth.signInAnonymously();
  return cred.user.uid;
}


// ============================================================
// Firestore path helpers
// ============================================================
const scriptsCol  = () => db.collection('users').doc(state.userId).collection('scripts');
const settingsDoc = () => db.collection('users').doc(state.userId)
                            .collection('settings').doc('preferences');


// ============================================================
// State
// ============================================================
const state = {
  userId: null,
  scripts:   {},      // { [id]: { id, name, text, createdAt, updatedAt } }
  currentId: null,

  settings: {
    speedMode:   'wpm',  // 'wpm' | 'duration'
    wpm:         150,
    durationMin: 5,
    fontSize:    52,
    theme:       'wob',  // 'wob' = white-on-black | 'bow' = black-on-white
  },

  prompter: {
    isPlaying: false,
    speedMult: 1.0,
    progress:  0,     // 0..1
    lastTs:    null,
    rafId:     null,
    fadeTimer: null,
  },
};


// ============================================================
// Firestore — load
// ============================================================
async function loadFromFirestore() {
  // Settings
  try {
    const snap = await settingsDoc().get();
    if (snap.exists) Object.assign(state.settings, snap.data());
  } catch (e) { console.warn('Settings load failed:', e); }

  // Scripts
  try {
    const snap = await scriptsCol().orderBy('updatedAt', 'desc').get();
    snap.forEach(doc => {
      state.scripts[doc.id] = { id: doc.id, ...doc.data() };
    });
  } catch (e) { console.warn('Scripts load failed:', e); }

  // Migrate any previously saved localStorage data into Firestore
  await migrateLocalStorage();
}

async function migrateLocalStorage() {
  const raw = localStorage.getItem('tp_scripts');
  if (!raw) return;
  try {
    const local   = JSON.parse(raw);
    const entries = Object.values(local).filter(sc => !state.scripts[sc.id]);
    if (!entries.length) { localStorage.removeItem('tp_scripts'); return; }

    const batch = db.batch();
    entries.forEach(sc => {
      batch.set(scriptsCol().doc(sc.id), {
        name: sc.name, text: sc.text,
        createdAt: sc.createdAt, updatedAt: sc.updatedAt,
      });
      state.scripts[sc.id] = sc;
    });
    await batch.commit();
    localStorage.removeItem('tp_scripts');
    console.log(`Migrated ${entries.length} script(s) from localStorage → Firestore.`);
  } catch (e) { console.warn('Migration failed:', e); }
}


// ============================================================
// Firestore — write helpers (fire-and-forget, errors are non-fatal)
// ============================================================
function persistScript(sc) {
  scriptsCol().doc(sc.id).set({
    name: sc.name, text: sc.text,
    createdAt: sc.createdAt, updatedAt: sc.updatedAt,
  }).catch(e => console.warn('Script save failed:', e));
}

function deleteScriptRemote(id) {
  scriptsCol().doc(id).delete()
    .catch(e => console.warn('Script delete failed:', e));
}

function persistSettings() {
  settingsDoc().set(state.settings)
    .catch(e => console.warn('Settings save failed:', e));
}


// ============================================================
// Debounced auto-save
// ============================================================
let autoSaveTimer = null;

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { if (state.currentId) flushCurrent(); }, 1500);
}


// ============================================================
// Helpers
// ============================================================
function esc(str) {
  return str
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function baseDurationMs() {
  const words = countWords(document.getElementById('script-editor').value);
  if (state.settings.speedMode === 'wpm') return (words / state.settings.wpm) * 60_000;
  return state.settings.durationMin * 60_000;
}


// ============================================================
// Script library — sidebar
// ============================================================
function renderList() {
  const list = document.getElementById('script-list');
  const msg  = document.getElementById('no-scripts-msg');
  const items = Object.values(state.scripts)
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));

  list.innerHTML = '';
  if (!items.length) { msg.style.display = ''; return; }
  msg.style.display = 'none';

  items.forEach(sc => {
    const li = document.createElement('li');
    li.className = 's-item' + (sc.id === state.currentId ? ' active' : '');
    li.innerHTML = `
      <span class="s-item-name" title="${esc(sc.name)}">${esc(sc.name)}</span>
      <button class="s-item-del" data-id="${sc.id}" title="Delete script">&times;</button>`;
    li.addEventListener('click', e => {
      if (!e.target.classList.contains('s-item-del')) openScript(sc.id);
    });
    li.querySelector('.s-item-del').addEventListener('click', e => {
      e.stopPropagation();
      removeScript(sc.id);
    });
    list.appendChild(li);
  });
}

function openScript(id) {
  flushCurrent();
  const sc = state.scripts[id];
  if (!sc) return;
  state.currentId = id;
  document.getElementById('script-name').value   = sc.name;
  document.getElementById('script-editor').value = sc.text;
  updateWordCount();
  renderList();
}

function newScript() {
  flushCurrent();
  const id  = 'sc_' + Date.now();
  const now = new Date().toISOString();
  const sc  = { id, name: 'Untitled Script', text: '', createdAt: now, updatedAt: now };
  state.scripts[id] = sc;
  state.currentId   = id;
  document.getElementById('script-name').value   = sc.name;
  document.getElementById('script-editor').value = '';
  persistScript(sc);
  renderList();
  updateWordCount();
  const nm = document.getElementById('script-name');
  nm.focus(); nm.select();
}

function saveScript() {
  const name = document.getElementById('script-name').value.trim() || 'Untitled Script';
  const text = document.getElementById('script-editor').value;

  if (!state.currentId) {
    const id  = 'sc_' + Date.now();
    const now = new Date().toISOString();
    const sc  = { id, name, text, createdAt: now, updatedAt: now };
    state.scripts[id] = sc;
    state.currentId   = id;
    persistScript(sc);
  } else {
    const sc = state.scripts[state.currentId];
    sc.name = name; sc.text = text; sc.updatedAt = new Date().toISOString();
    persistScript(sc);
  }

  renderList();

  const btn = document.getElementById('save-btn');
  btn.textContent = 'Saved ✓';
  btn.style.background = '#16a34a';
  setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 1600);
}

function flushCurrent() {
  if (!state.currentId) return;
  const sc = state.scripts[state.currentId];
  sc.name = document.getElementById('script-name').value.trim() || 'Untitled Script';
  sc.text = document.getElementById('script-editor').value;
  sc.updatedAt = new Date().toISOString();
  persistScript(sc);
}

function removeScript(id) {
  if (!confirm('Delete this script? This cannot be undone.')) return;
  delete state.scripts[id];
  deleteScriptRemote(id);
  if (state.currentId === id) {
    state.currentId = null;
    document.getElementById('script-name').value   = '';
    document.getElementById('script-editor').value = '';
    updateWordCount();
  }
  renderList();
}


// ============================================================
// Word count & time estimate
// ============================================================
function updateWordCount() {
  const words = countWords(document.getElementById('script-editor').value);
  document.getElementById('word-count').textContent =
    `${words} word${words !== 1 ? 's' : ''}`;

  if (!words) { document.getElementById('est-time').textContent = ''; return; }
  const sec = state.settings.speedMode === 'wpm'
    ? (words / state.settings.wpm) * 60
    : state.settings.durationMin * 60;
  document.getElementById('est-time').textContent = `Est. ${fmtTime(sec)}`;
}


// ============================================================
// Settings UI
// ============================================================
function applySettingsToUI() {
  const s = state.settings;
  document.getElementById('wpm-slider').value  = s.wpm;
  document.getElementById('wpm-val').textContent = s.wpm;
  document.getElementById('dur-slider').value  = s.durationMin;
  document.getElementById('dur-val').textContent = s.durationMin + ' min';
  document.getElementById('fs-slider').value   = s.fontSize;
  document.getElementById('fs-val').textContent  = s.fontSize;
  setPillActive('speed-mode-toggle', s.speedMode);
  document.getElementById('wpm-setting').classList.toggle('hidden', s.speedMode !== 'wpm');
  document.getElementById('dur-setting').classList.toggle('hidden', s.speedMode !== 'duration');
  setPillActive('theme-toggle', s.theme);
}

function setPillActive(groupId, val) {
  document.getElementById(groupId).querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.val === val);
  });
}


// ============================================================
// Teleprompter — launch / exit
// ============================================================
function launchPrompter() {
  const text = document.getElementById('script-editor').value.trim();
  if (!text) { alert('Please add some text to the script first.'); return; }
  flushCurrent();

  const el = document.getElementById('prompter-text');
  el.textContent = text;
  el.style.fontSize = state.settings.fontSize + 'px';

  applyPrompterTheme();

  const p = state.prompter;
  p.isPlaying = false; p.speedMult = 1.0; p.progress = 0; p.lastTs = null;
  if (p.rafId) { cancelAnimationFrame(p.rafId); p.rafId = null; }

  document.getElementById('prompter-scroll').scrollTop = 0;
  document.getElementById('pp-btn').textContent = '▶ Play';
  document.getElementById('pp-btn').classList.remove('playing');
  document.getElementById('speed-label').textContent = '1.0×';
  document.getElementById('prog-fill').style.width = '0%';

  document.getElementById('editor-view').classList.add('hidden');
  document.getElementById('prompter-view').classList.remove('hidden');
  showControls();
  document.documentElement.requestFullscreen().catch(() => {});
}

function applyPrompterTheme() {
  const view  = document.getElementById('prompter-view');
  const isWob = state.settings.theme === 'wob';
  view.classList.toggle('t-wob', isWob);
  view.classList.toggle('t-bow', !isWob);
  const bg = isWob ? '#000' : '#fff';
  document.querySelector('.p-fade-top').style.background =
    `linear-gradient(to bottom, ${bg} 35%, transparent)`;
  document.querySelector('.p-fade-bottom').style.background =
    `linear-gradient(to top, ${bg} 25%, transparent)`;
  document.getElementById('reading-line').style.background =
    isWob ? 'rgba(59,130,246,0.35)' : 'rgba(59,130,246,0.4)';
}

function exitPrompter() {
  stopPrompter();
  document.getElementById('prompter-view').classList.add('hidden');
  document.getElementById('editor-view').classList.remove('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}


// ============================================================
// Teleprompter — playback
// ============================================================
function playPause() { state.prompter.isPlaying ? pause() : play(); }

function play() {
  const p = state.prompter;
  if (p.progress >= 1) p.progress = 0;
  p.isPlaying = true; p.lastTs = null;
  document.getElementById('pp-btn').textContent = '⏸ Pause';
  document.getElementById('pp-btn').classList.add('playing');
  p.rafId = requestAnimationFrame(tick);
}

function pause() {
  const p = state.prompter;
  p.isPlaying = false;
  if (p.rafId) { cancelAnimationFrame(p.rafId); p.rafId = null; }
  document.getElementById('pp-btn').textContent = '▶ Play';
  document.getElementById('pp-btn').classList.remove('playing');
}

function stopPrompter() {
  pause();
  state.prompter.progress = 0;
  document.getElementById('prompter-scroll').scrollTop = 0;
  document.getElementById('prog-fill').style.width = '0%';
}

function tick(ts) {
  const p = state.prompter;
  if (!p.isPlaying) return;
  if (p.lastTs !== null) {
    const duration = baseDurationMs();
    if (duration > 0) p.progress = Math.min(1, p.progress + ((ts - p.lastTs) * p.speedMult) / duration);
    const scroll = document.getElementById('prompter-scroll');
    scroll.scrollTop = p.progress * (scroll.scrollHeight - scroll.clientHeight);
    document.getElementById('prog-fill').style.width = (p.progress * 100) + '%';
    if (p.progress >= 1) { pause(); return; }
  }
  p.lastTs = ts;
  p.rafId  = requestAnimationFrame(tick);
}

function adjustSpeed(delta) {
  const p = state.prompter;
  p.speedMult = Math.max(0.1, Math.min(5.0, Math.round((p.speedMult + delta) * 10) / 10));
  document.getElementById('speed-label').textContent = p.speedMult.toFixed(1) + '×';
  showControls();
}

function skipBy(fraction) {
  const p = state.prompter;
  p.progress = Math.max(0, Math.min(1, p.progress + fraction));
  const scroll = document.getElementById('prompter-scroll');
  scroll.scrollTop = p.progress * (scroll.scrollHeight - scroll.clientHeight);
  document.getElementById('prog-fill').style.width = (p.progress * 100) + '%';
  showControls();
}


// ============================================================
// Controls overlay (auto-hide after 3 s while playing)
// ============================================================
function showControls() {
  const bar = document.getElementById('ctrl-bar');
  bar.classList.remove('fade-out');
  clearTimeout(state.prompter.fadeTimer);
  state.prompter.fadeTimer = setTimeout(() => {
    if (state.prompter.isPlaying) bar.classList.add('fade-out');
  }, 3000);
}


// ============================================================
// Loading screen
// ============================================================
function hideLoadingScreen() {
  const el = document.getElementById('loading-screen');
  el.classList.add('done');
  setTimeout(() => el.remove(), 350);
}

function showLoadingError(msg) {
  document.querySelector('.loader-spinner').style.display = 'none';
  document.querySelector('.loader-msg').textContent = '';

  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#ef4444;white-space:pre-wrap;max-width:480px;text-align:left;font-size:13px;line-height:1.6;';
  pre.textContent = '⚠ ' + msg;
  document.getElementById('loading-screen').appendChild(pre);
}


// ============================================================
// Initialise
// ============================================================
async function init() {
  // Boot Firebase
  try {
    state.userId = await initFirebase();
  } catch (err) {
    showLoadingError(err.message);
    return;
  }

  // Load cloud data
  await loadFromFirestore();

  // Populate editor with most-recently-updated script
  const recent = Object.values(state.scripts)
    .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))[0];
  if (recent) {
    state.currentId = recent.id;
    document.getElementById('script-name').value   = recent.name;
    document.getElementById('script-editor').value = recent.text;
  }

  applySettingsToUI();
  renderList();
  updateWordCount();
  hideLoadingScreen();

  // ── Editor header ──────────────────────────────────────────
  document.getElementById('new-btn').addEventListener('click', newScript);
  document.getElementById('save-btn').addEventListener('click', saveScript);
  document.getElementById('launch-btn').addEventListener('click', launchPrompter);

  // ── Script editor ──────────────────────────────────────────
  document.getElementById('script-editor').addEventListener('input', () => {
    updateWordCount();
    scheduleAutoSave();
  });
  document.getElementById('script-name').addEventListener('blur', () => {
    if (state.currentId) flushCurrent();
  });

  // ── Settings: speed mode ───────────────────────────────────
  document.getElementById('speed-mode-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.settings.speedMode = btn.dataset.val;
    setPillActive('speed-mode-toggle', state.settings.speedMode);
    document.getElementById('wpm-setting').classList.toggle('hidden', state.settings.speedMode !== 'wpm');
    document.getElementById('dur-setting').classList.toggle('hidden', state.settings.speedMode !== 'duration');
    persistSettings();
    updateWordCount();
  });

  // ── Settings: WPM ─────────────────────────────────────────
  document.getElementById('wpm-slider').addEventListener('input', e => {
    state.settings.wpm = +e.target.value;
    document.getElementById('wpm-val').textContent = state.settings.wpm;
    persistSettings();
    updateWordCount();
  });

  // ── Settings: duration ────────────────────────────────────
  document.getElementById('dur-slider').addEventListener('input', e => {
    state.settings.durationMin = +e.target.value;
    document.getElementById('dur-val').textContent = state.settings.durationMin + ' min';
    persistSettings();
    updateWordCount();
  });

  // ── Settings: font size ───────────────────────────────────
  document.getElementById('fs-slider').addEventListener('input', e => {
    state.settings.fontSize = +e.target.value;
    document.getElementById('fs-val').textContent = state.settings.fontSize;
    persistSettings();
  });

  // ── Settings: theme ───────────────────────────────────────
  document.getElementById('theme-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.settings.theme = btn.dataset.val;
    setPillActive('theme-toggle', state.settings.theme);
    persistSettings();
  });

  // ── Teleprompter controls ──────────────────────────────────
  document.getElementById('pp-btn').addEventListener('click', playPause);
  document.getElementById('stop-btn2').addEventListener('click', stopPrompter);
  document.getElementById('sd-btn').addEventListener('click', () => adjustSpeed(-0.1));
  document.getElementById('su-btn').addEventListener('click', () => adjustSpeed(+0.1));
  document.getElementById('exit-btn').addEventListener('click', exitPrompter);
  document.getElementById('prompter-scroll').addEventListener('click', () => { playPause(); showControls(); });
  document.getElementById('prompter-view').addEventListener('mousemove', showControls);

  // ── Keyboard shortcuts (teleprompter only) ─────────────────
  document.addEventListener('keydown', e => {
    if (document.getElementById('prompter-view').classList.contains('hidden')) return;
    switch (e.key) {
      case ' ':          e.preventDefault(); playPause();        showControls(); break;
      case 'Escape':     e.preventDefault(); exitPrompter();                     break;
      case 'ArrowUp':    e.preventDefault(); adjustSpeed(+0.1);                 break;
      case 'ArrowDown':  e.preventDefault(); adjustSpeed(-0.1);                 break;
      case 'ArrowLeft':  e.preventDefault(); skipBy(-0.05);                     break;
      case 'ArrowRight': e.preventDefault(); skipBy(+0.05);                     break;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
