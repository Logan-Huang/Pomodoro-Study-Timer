// "Account & sync" card at the top of Settings: sign in (Google or emailed link), sync status,
// sign out, export, and permanent account deletion.
import { bus } from '../core/bus.js';
import { icon } from './icons.js';

const CLOUD_ICON = `<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/></svg>`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LEGAL = `
  <p class="acct-legal faint">By continuing, you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms of Use</a>
  and acknowledge the <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>. You must be 13 or older.</p>`;

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(ts).toLocaleDateString();
}

function syncLine(sync) {
  switch (sync.status) {
    case 'syncing':
      return `<span class="acct-dot acct-dot--busy" aria-hidden="true"></span><span>Syncing…</span>`;
    case 'synced':
      return `<span class="acct-dot acct-dot--ok" aria-hidden="true"></span><span>Synced${sync.lastSyncedAt ? ` · ${ago(sync.lastSyncedAt)}` : ''}</span>`;
    case 'offline':
      return `<span class="acct-dot acct-dot--warn" aria-hidden="true"></span><span>Offline. Changes will sync when you reconnect.</span>`;
    case 'error':
      return `<span class="acct-dot acct-dot--err" aria-hidden="true"></span><span>${esc(sync.error || 'Sync problem.')}</span>`;
    default:
      return `<span class="acct-dot" aria-hidden="true"></span><span>Connecting…</span>`;
  }
}

function view(a, sync, emailDraft) {
  const head = `<h3 class="section-title set-card__title">${CLOUD_ICON}<span>Account &amp; sync</span></h3>`;
  const err = a.error ? `<p class="acct-error" role="alert">${icon('warning', { size: 14 })}<span>${esc(a.error)}</span></p>` : '';

  if (a.status === 'loading') {
    return `${head}<p class="acct-busy"><span class="acct-spinner" aria-hidden="true"></span>Connecting to your account…</p>`;
  }

  if (a.pendingDelete) {
    return `${head}
      <div class="acct-sent">${icon('warning', { size: 18 })}<div><strong>Confirm deletion in your email</strong>
      <p>We sent a confirmation link to your email. Open it in this browser and your account will be deleted. Until then, nothing is deleted and syncing is paused.</p></div></div>
      <button class="btn btn--ghost btn--sm" type="button" data-act="cancel-delete"><span>Keep my account</span></button>${err}`;
  }

  if (a.status === 'signed-in' && a.user) {
    const u = a.user;
    const initial = esc((u.name || u.email || '?').trim().charAt(0).toUpperCase());
    const avatar = u.photo
      ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">`
      : `<span>${initial}</span>`;
    const provider = u.provider === 'google.com' ? 'Signed in with Google' : 'Signed in with email';
    return `${head}
      <div class="acct-user">
        <span class="acct-avatar">${avatar}</span>
        <div class="acct-id"><strong>${esc(u.name || u.email)}</strong><span class="faint">${esc(u.name ? u.email : provider)}</span></div>
      </div>
      <div class="acct-sync" data-sync aria-live="polite">${syncLine(sync)}</div>
      <div class="acct-actions">
        <button class="btn btn--sm" type="button" data-act="signout">${icon('logout', { size: 15 })}<span>Sign out</span></button>
        <button class="btn btn--sm" type="button" data-act="export">${icon('download', { size: 15 })}<span>Export my data</span></button>
      </div>
      <p class="acct-note faint">Signing out removes your tasks and stats from this browser. They stay safe in your account.</p>
      <details class="acct-danger">
        <summary>Delete account</summary>
        <p class="faint">Permanently deletes your account and everything synced to it: tasks, stats, settings and timer.
        This can’t be undone. Other devices signed in to this account are signed out and their copies are removed.</p>
        <button class="btn btn--sm" type="button" data-act="delete"><span>Delete my account</span></button>
      </details>${err}
      <p class="acct-legal faint"><a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a> · <a href="terms.html" target="_blank" rel="noopener">Terms of Use</a></p>`;
  }

  if (a.needEmail) {
    return `${head}
      <p class="acct-lede">Confirm your email address to finish signing in on this device.</p>
      <form class="acct-email" data-form="confirm">
        <input class="input" type="email" name="email" autocomplete="email" required placeholder="you@example.com" aria-label="Email address" value="${esc(emailDraft)}">
        <button class="btn btn--primary" type="submit"><span>Finish signing in</span></button>
      </form>${err}${LEGAL}`;
  }

  if (a.linkSentTo) {
    return `${head}
      <div class="acct-sent">${icon('check', { size: 18 })}<div><strong>Check your inbox</strong>
      <p>We sent a sign-in link to <b>${esc(a.linkSentTo)}</b>. Open it in this browser to finish. It can take a minute, so check spam too.</p></div></div>
      <button class="btn btn--ghost btn--sm" type="button" data-act="cancel-link"><span>Use a different email</span></button>${err}`;
  }

  // Signed out (or error): sign-in options.
  return `${head}
    <p class="acct-lede">Sign in to sync your tasks, stats, settings and running timer across your devices. It’s optional: Aura works fully without an account. Anything already on this device is added to your account.</p>
    <button class="btn btn--block acct-google" type="button" data-act="google">${icon('google', { size: 17 })}<span>Continue with Google</span></button>
    <div class="acct-or" aria-hidden="true"><span>or</span></div>
    <form class="acct-email" data-form="email">
      <input class="input" type="email" name="email" autocomplete="email" required placeholder="you@example.com" aria-label="Email address" value="${esc(emailDraft)}">
      <button class="btn btn--primary" type="submit"><span>Email me a link</span></button>
    </form>${err}${LEGAL}`;
}

/** Arms a button so the action needs a second click within a few seconds. */
function confirmClick(btn, label, run) {
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    run();
    return;
  }
  btn.dataset.armed = '1';
  btn.classList.add('btn--danger');
  const span = btn.querySelector('span');
  const original = span.textContent;
  span.textContent = label;
  setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.armed;
    btn.classList.remove('btn--danger');
    span.textContent = original;
  }, 4000);
}

export async function mountAccountCard(el) {
  if (!el) return;
  const acct = await import('../cloud/account.js');
  let sync = { status: 'off', lastSyncedAt: 0, error: null };
  let emailDraft = '';
  let busy = false;

  try {
    const s = await import('../cloud/sync.js');
    sync = s.getSyncState();
  } catch {
    /* sync not loaded yet */
  }

  const render = () => {
    el.innerHTML = view(acct.getAccount(), sync, emailDraft);
  };
  const renderSync = () => {
    const line = el.querySelector('[data-sync]');
    if (line) line.innerHTML = syncLine(sync);
  };

  // Load the SDK as soon as someone shows interest, so the Google popup can open instantly.
  const warm = () => {
    if (acct.getAccount().status !== 'signed-in') acct.prepare();
  };
  el.addEventListener('pointerenter', warm, { once: true });
  el.addEventListener('focusin', warm, { once: true });

  el.addEventListener('input', (e) => {
    if (e.target.name === 'email') emailDraft = e.target.value;
  });
  el.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') e.stopPropagation(); // don't trigger global shortcuts while typing
  });

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const form = e.target;
    const email = form.querySelector('input[name="email"]')?.value || '';
    busy = true;
    form.querySelector('button[type="submit"]')?.setAttribute('disabled', '');
    if (form.dataset.form === 'email') await acct.sendEmailLink(email);
    else if (form.dataset.form === 'confirm') await acct.completeEmailLink(email);
    busy = false;
    render();
  });

  el.addEventListener('click', async (e) => {
    const btn = e.target instanceof Element ? e.target.closest('[data-act]') : null;
    if (!btn || busy) return;
    const act = btn.dataset.act;
    if (act === 'google') {
      acct.signInWithGoogle();
    } else if (act === 'cancel-link') {
      acct.cancelEmailLink();
    } else if (act === 'cancel-delete') {
      busy = true;
      await acct.cancelDeletion();
      busy = false;
    } else if (act === 'signout') {
      busy = true;
      await acct.signOut();
      busy = false;
    } else if (act === 'export') {
      const panel = await import('./settings-panel.js');
      panel.exportAll();
    } else if (act === 'delete') {
      confirmClick(btn, 'Click again to delete forever', async () => {
        busy = true;
        btn.setAttribute('disabled', '');
        await acct.deleteAccount(); // errors surface in the card via account state
        busy = false;
        render();
      });
    }
  });

  bus.on('account:changed', render);
  bus.on('sync:status', (s) => {
    sync = s;
    renderSync();
  });
  setInterval(renderSync, 30000);
  render();
}
