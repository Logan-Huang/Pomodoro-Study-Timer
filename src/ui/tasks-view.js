// Tasks panel (#tasks-root) and the "current task" chip (#current-task).
import { bus } from '../core/bus.js';
import { icon } from './icons.js';
import { openPanel } from './panels.js';
import { toast } from './notify.js';
import {
  getTasks,
  getActiveTask,
  setActiveTask,
  addTask,
  updateTask,
  removeTask,
  toggleDone,
  clearDone,
  reorder,
  clampEstMin,
  EST_STEP_MIN,
} from '../features/tasks.js';
import { getLiveMs } from '../features/stats.js';

let wantFocusAdd = false;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Whole minutes focused on a task, including the running session when it's the active task. */
function doneMinutes(t, activeId) {
  let ms = Number(t.focusMs) || 0;
  if (t.id === activeId && !t.done) {
    try {
      ms += getLiveMs();
    } catch {
      /* stats not ready */
    }
  }
  return Math.floor(ms / 60000);
}

function celebrateDone(title) {
  toast(title, { title: 'Task complete', tone: 'success', icon: 'check', duration: 2600 });
}

function focusAddInput() {
  setTimeout(() => {
    const input = document.querySelector('#tasks-root .tk-add__input');
    if (input) input.focus();
  }, 420);
}

/* ============================================================ tasks panel */

export function initTasksView(root) {
  if (!root) {
    console.warn('[aura] #tasks-root missing; tasks view skipped');
    return;
  }
  root.innerHTML = `
    <div class="tk">
      <form class="tk-add" autocomplete="off">
        <input class="input tk-add__input" type="text" maxlength="140" placeholder="What will you focus on?" aria-label="Task title">
        <div class="stepper tk-add__est" title="Estimated minutes (type any amount)">
          <button type="button" class="stepper__btn" data-step="-1" aria-label="${EST_STEP_MIN} minutes less">−</button>
          <label class="tk-add__field">
            <input class="stepper__input input" type="number" min="1" max="1440" step="1" value="${EST_STEP_MIN}" inputmode="numeric" aria-label="Estimated minutes">
            <span class="tk-add__unit" aria-hidden="true">min</span>
          </label>
          <button type="button" class="stepper__btn" data-step="1" aria-label="${EST_STEP_MIN} minutes more">+</button>
        </div>
        <button type="submit" class="btn-icon tk-add__btn" aria-label="Add task">${icon('plus', { size: 20, stroke: 2 })}</button>
      </form>
      <ul class="tk-list tk-list--open" aria-label="Open tasks"></ul>
      <div class="tk-empty empty-state">
        ${icon('target', { size: 28, stroke: 1.5 })}
        <p class="serif tk-empty__text">Name one thing worth your focus.</p>
        <span class="faint tk-empty__hint">Every minute you focus on a task counts toward its estimate.</span>
      </div>
      <section class="tk-done" hidden>
        <div class="tk-done__head">
          <button type="button" class="tk-done__toggle" aria-expanded="false">
            ${icon('chevron-right', { size: 16 })}<span>Completed (<b class="tk-done__count">0</b>)</span>
          </button>
          <button type="button" class="btn btn--ghost btn--sm tk-done__clear">Clear completed</button>
        </div>
        <ul class="tk-list tk-list--done" aria-label="Completed tasks" hidden></ul>
      </section>
    </div>`;

  const form = root.querySelector('.tk-add');
  const input = root.querySelector('.tk-add__input');
  const est = root.querySelector('.stepper__input');
  const openList = root.querySelector('.tk-list--open');
  const doneList = root.querySelector('.tk-list--done');
  const empty = root.querySelector('.tk-empty');
  const emptyText = root.querySelector('.tk-empty__text');
  const doneSection = root.querySelector('.tk-done');
  const doneToggle = root.querySelector('.tk-done__toggle');
  const doneCount = root.querySelector('.tk-done__count');

  const items = new Map();
  let firstRender = true;

  /* ---- add row: type any number of minutes; the buttons move between multiples of 25 ---- */
  const readEst = () => clampEstMin(est.value);
  root.querySelectorAll('.tk-add .stepper__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = readEst();
      const S = EST_STEP_MIN;
      est.value = Number(btn.dataset.step) > 0
        ? clampEstMin(Math.floor(v / S) * S + S)
        : v <= S ? v : Math.max(S, Math.ceil(v / S) * S - S);
    });
  });
  est.addEventListener('focus', () => est.select());
  est.addEventListener('change', () => {
    est.value = readEst();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const task = addTask(input.value, readEst());
    if (task) {
      input.value = '';
      input.focus();
    } else {
      input.focus();
    }
  });

  /* ---- item DOM ---- */
  function createItem(t) {
    const li = document.createElement('li');
    li.className = 'tk-item';
    li.dataset.id = t.id;
    li.innerHTML = `
      <button type="button" class="tk-drag" aria-label="Reorder task. Use arrow keys or drag.">${icon('drag', { size: 16 })}</button>
      <button type="button" class="tk-check" data-act="check" role="checkbox" aria-checked="false">
        <svg class="tk-check__svg" viewBox="0 0 24 24" aria-hidden="true">
          <circle class="tk-check__ring" cx="12" cy="12" r="10"/>
          <path class="tk-check__tick" d="M7.6 12.6l3 3 5.9-6.6" pathLength="1"/>
        </svg>
      </button>
      <div class="tk-item__main">
        <span class="tk-item__title"></span>
        <span class="tk-item__meta">
          <span class="tk-bar" aria-hidden="true"><i class="tk-bar__fill"></i></span>
          <span class="tk-count tabular"></span>
          <span class="badge badge--accent tk-now" hidden>Now</span>
        </span>
      </div>
      <div class="tk-item__actions">
        <button type="button" class="btn-icon btn-icon--sm tk-target" data-act="target" aria-pressed="false">${icon('target', { size: 16 })}</button>
        <button type="button" class="btn-icon btn-icon--sm" data-act="edit" aria-label="Edit task">${icon('edit', { size: 16 })}</button>
        <button type="button" class="btn-icon btn-icon--sm tk-trash" data-act="trash" aria-label="Delete task">${icon('trash', { size: 16 })}</button>
      </div>`;
    li.addEventListener('animationend', (e) => {
      if (e.target === li) li.classList.remove('is-new');
    });
    return li;
  }

  function updateItem(li, t, activeId) {
    const isActive = t.id === activeId && !t.done;
    li.classList.toggle('is-done', t.done);
    li.classList.toggle('is-active', isActive);
    const check = li.querySelector('.tk-check');
    check.classList.toggle('is-done', t.done);
    check.setAttribute('aria-checked', String(t.done));
    check.setAttribute('aria-label', `${t.done ? 'Mark not done' : 'Mark done'}: ${t.title}`);
    li.querySelector('.tk-item__title').textContent = t.title;

    const done = doneMinutes(t, activeId);
    const prog = `${done}/${t.estMin}`;
    if (li.dataset.prog !== prog) {
      li.dataset.prog = prog;
      const pct = t.estMin > 0 ? Math.min(100, (done / t.estMin) * 100) : 0;
      const bar = li.querySelector('.tk-bar');
      bar.style.setProperty('--w', `${pct.toFixed(1)}%`);
      bar.classList.toggle('is-over', done > t.estMin);
      const count = li.querySelector('.tk-count');
      count.textContent = `${prog} min`;
      count.setAttribute('aria-label', `${done} of ${t.estMin} minutes`);
    }
    li.querySelector('.tk-now').hidden = !isActive;
    const target = li.querySelector('.tk-target');
    target.hidden = t.done;
    target.classList.toggle('is-active', isActive);
    target.setAttribute('aria-pressed', String(isActive));
    target.setAttribute('aria-label', isActive ? 'Stop focusing on this task' : 'Focus on this task');
  }

  function removeItem(li) {
    li.style.setProperty('--h', `${li.offsetHeight}px`);
    li.classList.add('is-leaving');
    setTimeout(() => li.remove(), 260);
  }

  const nextKept = (el) => {
    while (el && el.classList.contains('is-leaving')) el = el.nextElementSibling;
    return el;
  };

  function syncList(list, arr, activeId) {
    let ref = nextKept(list.firstElementChild);
    for (const t of arr) {
      let li = items.get(t.id);
      if (!li) {
        li = createItem(t);
        items.set(t.id, li);
        if (!firstRender) li.classList.add('is-new');
      }
      updateItem(li, t, activeId);
      if (li === ref) ref = nextKept(ref.nextElementSibling);
      else list.insertBefore(li, ref);
    }
  }

  function render() {
    const tasks = getTasks();
    const active = getActiveTask();
    const activeId = active ? active.id : null;
    const open = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

    const alive = new Set(tasks.map((t) => t.id));
    for (const [id, li] of items) {
      if (!alive.has(id)) {
        items.delete(id);
        removeItem(li);
      }
    }
    syncList(openList, open, activeId);
    syncList(doneList, done, activeId);

    empty.hidden = open.length > 0;
    emptyText.textContent = done.length ? 'Everything is done. Nicely done.' : 'Name one thing worth your focus.';
    doneSection.hidden = done.length === 0;
    doneCount.textContent = String(done.length);
    firstRender = false;
  }

  /* ---- delegated clicks ---- */
  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const li = act.closest('.tk-item');
    if (!li) return;
    const id = li.dataset.id;
    const t = getTasks().find((x) => x.id === id);
    if (!t) return;
    switch (act.dataset.act) {
      case 'check':
        if (t.done) {
          toggleDone(id);
        } else {
          li.classList.add('is-done');
          act.classList.add('is-done');
          setTimeout(() => {
            toggleDone(id);
            celebrateDone(t.title);
          }, 460);
        }
        break;
      case 'target':
        setActiveTask(getActiveTask()?.id === id ? null : id);
        break;
      case 'edit':
        beginEdit(li);
        break;
      case 'trash':
        removeTask(id);
        break;
    }
  });

  root.addEventListener('dblclick', (e) => {
    const target = e.target.closest('.tk-item__title, .tk-item__meta');
    if (target) beginEdit(target.closest('.tk-item'));
  });

  doneToggle.addEventListener('click', () => {
    const expanded = doneToggle.getAttribute('aria-expanded') === 'true';
    doneToggle.setAttribute('aria-expanded', String(!expanded));
    doneList.hidden = expanded;
    doneSection.classList.toggle('is-open', !expanded);
  });
  root.querySelector('.tk-done__clear').addEventListener('click', () => clearDone());

  /* ---- inline edit: title, minutes spent, minutes allocated ---- */
  function beginEdit(li) {
    if (!li || li.classList.contains('is-editing')) return;
    const id = li.dataset.id;
    const t = getTasks().find((x) => x.id === id);
    if (!t) return;
    const activeId = getActiveTask()?.id ?? null;
    // "Spent" includes the running session for the active task, like the progress shown.
    let live = 0;
    if (t.id === activeId && !t.done) {
      try {
        live = getLiveMs();
      } catch {
        live = 0;
      }
    }
    const spentShown = Math.floor(((Number(t.focusMs) || 0) + live) / 60000);

    const form = document.createElement('form');
    form.className = 'tk-editform';
    form.noValidate = true;
    form.innerHTML = `
      <input class="input tk-edit" type="text" maxlength="140" aria-label="Task title">
      <div class="tk-editform__row">
        <label class="tk-editform__field">
          <span class="tk-editform__label">Spent</span>
          <input class="input tk-editform__num" type="number" min="0" max="100000" step="1" inputmode="numeric" data-f="spent" aria-label="Minutes spent">
          <span class="tk-editform__unit" aria-hidden="true">min</span>
        </label>
        <label class="tk-editform__field">
          <span class="tk-editform__label">Allocated</span>
          <input class="input tk-editform__num" type="number" min="1" max="1440" step="1" inputmode="numeric" data-f="est" aria-label="Minutes allocated">
          <span class="tk-editform__unit" aria-hidden="true">min</span>
        </label>
      </div>
      <div class="tk-editform__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-edit="cancel">Cancel</button>
        <button type="submit" class="btn btn--primary btn--sm">Save</button>
      </div>`;
    const title = form.querySelector('.tk-edit');
    const spent = form.querySelector('[data-f="spent"]');
    const est = form.querySelector('[data-f="est"]');
    title.value = t.title;
    spent.value = String(spentShown);
    est.value = String(t.estMin);
    li.querySelector('.tk-item__main').append(form);
    li.classList.add('is-editing');
    title.focus();
    title.select();
    [spent, est].forEach((inp) => inp.addEventListener('focus', () => inp.select()));

    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      li.classList.remove('is-editing');
      form.remove();
      if (!save) return;
      const patch = {};
      const v = title.value.trim();
      if (v && v !== t.title) patch.title = v;
      const e = clampEstMin(est.value);
      if (e !== t.estMin) patch.estMin = e;
      const s = Math.round(Number(spent.value));
      // Only rewrite the stored time if the minutes were actually changed (keeps seconds otherwise).
      if (Number.isFinite(s) && s >= 0 && s !== spentShown) patch.focusMs = Math.max(0, s * 60000 - live);
      if (Object.keys(patch).length) updateTask(id, patch);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(true);
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    });
    form.querySelector('[data-edit="cancel"]').addEventListener('click', () => finish(false));
    // Clicking away saves, like the title-only editor did.
    form.addEventListener('focusout', (e) => {
      if (!form.contains(e.relatedTarget)) finish(true);
    });
  }

  /* ---- drag to reorder ---- */
  function commitMove(ids, from, to) {
    const all = getTasks();
    const fi = all.findIndex((t) => t.id === ids[from]);
    const ti = all.findIndex((t) => t.id === ids[to]);
    if (fi >= 0 && ti >= 0) reorder(fi, ti);
  }

  root.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.tk-drag');
    if (!handle || e.button > 0) return;
    const li = handle.closest('.tk-item');
    if (!li || li.parentElement !== openList) return;
    const els = [...openList.children].filter((c) => !c.classList.contains('is-leaving'));
    if (els.length < 2) return;
    e.preventDefault();

    const rects = els.map((el) => el.getBoundingClientRect());
    const from = els.indexOf(li);
    const gap = Math.max(0, rects[1].top - rects[0].bottom);
    const shift = rects[from].height + gap;
    const startY = e.clientY;
    let idx = from;
    let finalDy = 0;

    handle.setPointerCapture(e.pointerId);
    li.classList.add('is-dragging');
    openList.classList.add('is-sorting');

    const onMove = (ev) => {
      const lo = rects[0].top - rects[from].top;
      const hi = rects[rects.length - 1].bottom - rects[from].bottom;
      const dy = clamp(ev.clientY - startY, lo, hi);
      li.style.transform = `translateY(${dy}px)`;
      const center = rects[from].top + rects[from].height / 2 + dy;
      let n = 0;
      rects.forEach((r, i) => {
        if (i !== from && r.top + r.height / 2 < center) n++;
      });
      idx = n;
      els.forEach((el, i) => {
        if (i === from) return;
        let s = 0;
        if (from < idx && i > from && i <= idx) s = -shift;
        else if (from > idx && i >= idx && i < from) s = shift;
        el.style.transform = s ? `translateY(${s}px)` : '';
      });
    };

    const end = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (idx < from) finalDy = rects[idx].top - rects[from].top;
      else if (idx > from) finalDy = rects[idx].bottom - rects[from].bottom;
      li.classList.add('is-dropping');
      li.style.transform = `translateY(${finalDy}px)`;
      setTimeout(() => {
        openList.classList.remove('is-sorting');
        li.classList.remove('is-dragging', 'is-dropping');
        els.forEach((el) => (el.style.transform = ''));
        if (idx !== from) commitMove(els.map((el) => el.dataset.id), from, idx);
      }, 200);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });

  root.addEventListener('keydown', (e) => {
    const handle = e.target.closest?.('.tk-drag');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const li = handle.closest('.tk-item');
    if (!li || li.parentElement !== openList) return;
    e.preventDefault();
    const els = [...openList.children].filter((c) => !c.classList.contains('is-leaving'));
    const from = els.indexOf(li);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= els.length) return;
    commitMove(els.map((el) => el.dataset.id), from, to);
    requestAnimationFrame(() => li.querySelector('.tk-drag')?.focus());
  });

  /* ---- wiring ---- */
  bus.on('tasks:changed', render);
  bus.on('stats:updated', render); // live minutes for the active task
  bus.on('panel:open', ({ name } = {}) => {
    if (name !== 'tasks') return;
    render();
    if (wantFocusAdd) {
      wantFocusAdd = false;
      focusAddInput();
    }
  });
  render();
}

/* ========================================================= current chip */

export function initCurrentTask(el) {
  if (!el) {
    console.warn('[aura] #current-task missing; current task chip skipped');
    return;
  }
  let sig = null;

  function render() {
    const t = getActiveTask();
    const done = t ? doneMinutes(t, t.id) : 0;
    const next = t ? `${t.id}|${t.title}|${done}|${t.estMin}` : '';
    if (next === sig) return;
    sig = next;
    if (!t) {
      el.innerHTML = `
        <button type="button" class="ct-chip ct-chip--ghost">
          ${icon('plus', { size: 16, stroke: 2 })}<span>Set a focus intention</span>
        </button>`;
      return;
    }
    el.innerHTML = `
      <div class="ct-chip ct-chip--active glass">
        <button type="button" class="ct-main" aria-label="Open tasks. Working on ${esc(t.title)}">
          <span class="ct-icon">${icon('target', { size: 16 })}</span>
          <span class="ct-label">Working on</span>
          <span class="ct-title">${esc(t.title)}</span>
          <span class="ct-progress tabular" aria-label="${done} of ${t.estMin} minutes">${done}/${t.estMin}m</span>
        </button>
        <button type="button" class="ct-done" aria-label="Mark task done">${icon('check', { size: 14, stroke: 2.4 })}</button>
      </div>`;
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('.ct-done')) {
      const t = getActiveTask();
      if (t) {
        toggleDone(t.id);
        celebrateDone(t.title);
      }
      return;
    }
    if (e.target.closest('.ct-chip--ghost')) {
      wantFocusAdd = true;
      openPanel('tasks');
      focusAddInput();
      return;
    }
    if (e.target.closest('.ct-main')) openPanel('tasks');
  });

  bus.on('tasks:changed', render);
  bus.on('stats:updated', render);
  render();
}
