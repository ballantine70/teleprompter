'use strict';

// ============================================================
// State
// ============================================================
const state = {
  scripts: {},          // { [id]: { id, name, text, createdAt, updatedAt } }
  currentId: null,

  settings: {
    speedMode: 'wpm',   // 'wpm' | 'duration'
    wpm: 150,
    durationMin: 5,
    fontSize: 52,
    theme: 'wob',       // 'wob' (white-on-black) | 'bow' (black-on-white)
  },

  prompter: {
    isPlaying: false,
    speedMult: 1.0,
    progress: 0,        // 0..1
    lastTs: null,
    rafId: null,
    fadeTimer: null,
  },
};


// ============================================================
// Persistence
// ============================================================
function loadStorage() {
  try {
    const s = localStorage.getItem('tp_scripts');
    if (s) state.scripts = JSON.parse(s);
    const p = localStorage.getItem('tp_settings');
    if (p) Object.assign(state.settings, JSON.parse(p));
  } catch (_) {}
}

function saveScripts()  { localStorage.setItem('tp_scripts',  JSON.stringify(state.scripts));  }
function saveSettings() { localStorage.setItem('tp_settings', JSON.stringify(state.settings)); }


// ============================================================
// Helpers
// ============================================================
function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function baseDurationMs() {
  const words = countWords(document.getElementById('script-editor').value);
  if (state.settings.speedMode === 'wpm') {
    return (words / state.settings.wpm) * 60_000;
  }
  return state.settings.durationMin * 60_000;
}


// ============================================================
// Script library (sidebar)
// ============================================================
function renderList() {
  const list = document.getElementById('script-list');
  const msg  = document.getElementById('no-scripts-msg');
  const items = Object.values(state.scripts)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

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
  const id = 'sc_' + Date.now();
  state.scripts[id] = {
    id, name: 'Untitled Script', text: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.currentId = id;
  document.getElementById('script-name').value   = 'Untitled Script';
  document.getElementById('script-editor').value = '';
  saveScripts();
  renderList();
  updateWordCount();
  const nm = document.getElementById('script-name');
  nm.focus(); nm.select();
}

function saveScript() {
  const name = document.getElementById('script-name').value.trim() || 'Untitled Script';
  const text = document.getElementById('script-editor').value;

  if (!state.currentId) {
    const id = 'sc_' + Date.now();
    state.scripts[id] = { id, name, text, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.currentId = id;
  } else {
    Object.assign(state.scripts[state.currentId], { name, text, updatedAt: new Date().toISOString() });
  }

  saveScripts();
  renderList();

  // Brief visual confirmation
  const btn = document.getElementById('save-btn');
  btn.textContent = 'Saved ✓';
  btn.style.background = '#16a34a';
  setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 1600);
}

/** Silently persist current editor content without UI feedback. */
function flushCurrent() {
  if (!state.currentId) return;
  const name = document.getElementById('script-name').value.trim() || 'Untitled Script';
  const text = document.getElementById('script-editor').value;
  Object.assign(state.scripts[state.currentId], { name, text, updatedAt: new Date().toISOString() });
  saveScripts();
}

function removeScript(id) {
  if (!confirm('Delete this script? This cannot be undone.')) return;
  delete state.scripts[id];
  if (state.currentId === id) {
    state.currentId = null;
    document.getElementById('script-name').value   = '';
    document.getElementById('script-editor').value = '';
    updateWordCount();
  }
  saveScripts();
  renderList();
}


// ============================================================
// Word count & time estimate
// ============================================================
function updateWordCount() {
  const words = countWords(document.getElementById('script-editor').value);
  document.getElementById('word-count').textContent = `${words} word${words !== 1 ? 's' : ''}`;

  if (!words) { document.getElementById('est-time').textContent = ''; return; }

  let sec;
  if (state.settings.speedMode === 'wpm') {
    sec = (words / state.settings.wpm) * 60;
  } else {
    sec = state.settings.durationMin * 60;
  }
  document.getElementById('est-time').textContent = `Est. ${fmtTime(sec)}`;
}


// ============================================================
// Settings UI
// ============================================================
function applySettingsToUI() {
  const s = state.settings;

  // WPM
  document.getElementById('wpm-slider').value = s.wpm;
  document.getElementById('wpm-val').textContent = s.wpm;

  // Duration
  document.getElementById('dur-slider').value = s.durationMin;
  document.getElementById('dur-val').textContent = s.durationMin + ' min';

  // Font size
  document.getElementById('fs-slider').value = s.fontSize;
  document.getElementById('fs-val').textContent = s.fontSize;

  // Speed mode pills
  setPillActive('speed-mode-toggle', s.speedMode);
  document.getElementById('wpm-setting').classList.toggle('hidden', s.speedMode !== 'wpm');
  document.getElementById('dur-setting').classList.toggle('hidden', s.speedMode !== 'duration');

  // Theme pills
  setPillActive('theme-toggle', s.theme);
}

function setPillActive(groupId, val) {
  document.getElementById(groupId).querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.val === val);
  });
}


// ============================================================
// Teleprompter – launch / exit
// ============================================================
function launchPrompter() {
  const text = document.getElementById('script-editor').value.trim();
  if (!text) { alert('Please add some text to the script first.'); return; }

  flushCurrent();

  // Populate text
  const el = document.getElementById('prompter-text');
  el.textContent = text;
  el.style.fontSize = state.settings.fontSize + 'px';

  // Apply theme
  applyPrompterTheme();

  // Reset state
  const p = state.prompter;
  p.isPlaying = false;
  p.speedMult = 1.0;
  p.progress  = 0;
  p.lastTs    = null;
  if (p.rafId) { cancelAnimationFrame(p.rafId); p.rafId = null; }

  // Reset scroll
  document.getElementById('prompter-scroll').scrollTop = 0;

  // Reset UI
  document.getElementById('pp-btn').textContent = '▶ Play';
  document.getElementById('pp-btn').classList.remove('playing');
  document.getElementById('speed-label').textContent = '1.0×';
  document.getElementById('prog-fill').style.width = '0%';

  // Show views
  document.getElementById('editor-view').classList.add('hidden');
  document.getElementById('prompter-view').classList.remove('hidden');

  showControls();

  // Request fullscreen (best-effort)
  document.documentElement.requestFullscreen().catch(() => {});
}

function applyPrompterTheme() {
  const view = document.getElementById('prompter-view');
  const isWob = state.settings.theme === 'wob';
  view.classList.toggle('t-wob', isWob);
  view.classList.toggle('t-bow', !isWob);

  // Fade overlays use CSS custom property --pb via the theme class,
  // but we set inline background here for the JS-controlled fade divs.
  const bg = isWob ? '#000' : '#fff';
  document.querySelector('.p-fade-top').style.background =
    `linear-gradient(to bottom, ${bg} 35%, transparent)`;
  document.querySelector('.p-fade-bottom').style.background =
    `linear-gradient(to top, ${bg} 25%, transparent)`;

  // Reading line colour: a subtle tint contrasting with background
  document.getElementById('reading-line').style.background =
    isWob ? 'rgba(59,130,246,0.35)' : 'rgba(59,130,246,0.40)';
}

function exitPrompter() {
  stopPrompter();
  document.getElementById('prompter-view').classList.add('hidden');
  document.getElementById('editor-view').classList.remove('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}


// ============================================================
// Teleprompter – playback
// ============================================================
function playPause() {
  state.prompter.isPlaying ? pause() : play();
}

function play() {
  const p = state.prompter;
  if (p.progress >= 1) { p.progress = 0; }   // restart if at end
  p.isPlaying = true;
  p.lastTs    = null;
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
  const p = state.prompter;
  p.progress = 0;
  document.getElementById('prompter-scroll').scrollTop = 0;
  document.getElementById('prog-fill').style.width = '0%';
}

function tick(ts) {
  const p = state.prompter;
  if (!p.isPlaying) return;

  if (p.lastTs !== null) {
    const delta    = ts - p.lastTs;
    const duration = baseDurationMs();
    if (duration > 0) {
      p.progress = Math.min(1, p.progress + (delta * p.speedMult) / duration);
    }

    const scroll = document.getElementById('prompter-scroll');
    const maxY   = scroll.scrollHeight - scroll.clientHeight;
    scroll.scrollTop = p.progress * maxY;

    document.getElementById('prog-fill').style.width = (p.progress * 100) + '%';

    if (p.progress >= 1) {
      pause();
      return;
    }
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
// Controls overlay (auto-hide)
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
// Initialise
// ============================================================
function init() {
  loadStorage();
  applySettingsToUI();
  renderList();

  // Load most-recent script into editor
  const recent = Object.values(state.scripts)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
  if (recent) {
    state.currentId = recent.id;
    document.getElementById('script-name').value   = recent.name;
    document.getElementById('script-editor').value = recent.text;
  }
  updateWordCount();

  // ── Editor header buttons ──────────────────────────────────
  document.getElementById('new-btn').addEventListener('click', newScript);
  document.getElementById('save-btn').addEventListener('click', saveScript);
  document.getElementById('launch-btn').addEventListener('click', launchPrompter);

  // ── Script editor changes ──────────────────────────────────
  document.getElementById('script-editor').addEventListener('input', updateWordCount);
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
    saveSettings();
    updateWordCount();
  });

  // ── Settings: WPM slider ───────────────────────────────────
  document.getElementById('wpm-slider').addEventListener('input', e => {
    state.settings.wpm = +e.target.value;
    document.getElementById('wpm-val').textContent = state.settings.wpm;
    saveSettings();
    updateWordCount();
  });

  // ── Settings: duration slider ──────────────────────────────
  document.getElementById('dur-slider').addEventListener('input', e => {
    state.settings.durationMin = +e.target.value;
    document.getElementById('dur-val').textContent = state.settings.durationMin + ' min';
    saveSettings();
    updateWordCount();
  });

  // ── Settings: font size slider ─────────────────────────────
  document.getElementById('fs-slider').addEventListener('input', e => {
    state.settings.fontSize = +e.target.value;
    document.getElementById('fs-val').textContent = state.settings.fontSize;
    saveSettings();
  });

  // ── Settings: theme ────────────────────────────────────────
  document.getElementById('theme-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    state.settings.theme = btn.dataset.val;
    setPillActive('theme-toggle', state.settings.theme);
    saveSettings();
  });

  // ── Teleprompter controls ──────────────────────────────────
  document.getElementById('pp-btn').addEventListener('click', playPause);
  document.getElementById('stop-btn2').addEventListener('click', stopPrompter);
  document.getElementById('sd-btn').addEventListener('click', () => adjustSpeed(-0.1));
  document.getElementById('su-btn').addEventListener('click', () => adjustSpeed(+0.1));
  document.getElementById('exit-btn').addEventListener('click', exitPrompter);

  // Click on prompter text area toggles play/pause
  document.getElementById('prompter-scroll').addEventListener('click', () => {
    playPause();
    showControls();
  });

  // Mouse move shows controls
  document.getElementById('prompter-view').addEventListener('mousemove', showControls);

  // ── Keyboard shortcuts (teleprompter only) ─────────────────
  document.addEventListener('keydown', e => {
    if (document.getElementById('prompter-view').classList.contains('hidden')) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        playPause();
        showControls();
        break;
      case 'Escape':
        e.preventDefault();
        exitPrompter();
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustSpeed(+0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustSpeed(-0.1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        skipBy(-0.05);
        break;
      case 'ArrowRight':
        e.preventDefault();
        skipBy(+0.05);
        break;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
