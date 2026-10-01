import { bus } from '../core/bus.js';
import { load } from '../core/storage.js';
import { timer, initEngine } from './engine.js';
import { initTimerView } from '../ui/timer-view.js';

let started = false;

function syncEngineToMode({ mode, initial } = {}) {
  const s = timer.getState();
  // A restored, in-progress session always wins on boot.
  if (initial && (s.status === 'running' || s.status === 'paused')) return;
  if (mode === 'pomodoro') {
    if (s.engineMode !== 'pomodoro' && s.engineMode !== 'sequence') timer.setEngineMode('pomodoro');
  } else if (mode === 'timer') {
    if (s.engineMode !== 'countdown' && s.engineMode !== 'stopwatch') {
      const sub = load('timerSub', 'countdown');
      timer.setEngineMode(sub === 'stopwatch' ? 'stopwatch' : 'countdown');
    }
  }
  // 'schedule' leaves the engine untouched.
}

export function initTimer() {
  if (started) return;
  started = true;
  try { initEngine(); } catch (err) { console.error('[aura] timer engine init failed', err); }

  const root = document.getElementById('timer-root');
  if (root) {
    try { initTimerView(root); } catch (err) { console.error('[aura] timer view init failed', err); }
  } else {
    console.warn('[aura] #timer-root not found; timer view not rendered');
  }
  bus.on('mode:change', syncEngineToMode);
}
