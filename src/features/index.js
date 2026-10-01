// Entry point for audio, notifications, tasks and stats.
import { initAudio } from '../audio/audio.js';
import { initNotify } from '../ui/notify.js';
import { initTasks } from './tasks.js';
import { initStats } from './stats.js';
import { initTasksView, initCurrentTask } from '../ui/tasks-view.js';
import { initStatsView } from '../ui/stats-view.js';
import { initSoundView } from '../ui/sound-view.js';

function guard(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[aura] ${name} failed to initialise`, e);
  }
}

const el = (id) => document.getElementById(id);

export function initFeatures() {
  guard('audio', initAudio);
  guard('notify', initNotify);
  guard('tasks', initTasks);
  guard('stats', initStats);
  guard('tasks view', () => initTasksView(el('tasks-root')));
  guard('stats view', () => initStatsView(el('stats-root')));
  guard('sound view', () => initSoundView(el('sound-root')));
  guard('current task', () => initCurrentTask(el('current-task')));
}
