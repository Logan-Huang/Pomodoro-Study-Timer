// Optional account: sign in (Google or an emailed link) to sync tasks, stats, settings and the
// running timer across devices. Without an account Aura works exactly as before and never loads
// Firebase. Account state is broadcast on the bus as 'account:changed'.
import { bus } from '../core/bus.js';
import { load, save, remove } from '../core/storage.js';
import { loadFirebase, firebaseIfReady } from './firebase.js';

const FLAG = 'cloud.signedIn'; // this device has an account session, so load Firebase at startup
const EMAIL_KEY = 'cloud.emailForSignIn'; // where a sign-in link was sent (to finish signing in)
const PENDING_DELETE = 'cloud.pendingDelete'; // uid awaiting a fresh sign-in to finish deletion

const state = {
  status: 'signed-out', // signed-out | loading | signed-in | error
  user: null, // { uid, email, name, photo, provider }
  error: null,
  linkSentTo: null, // email a sign-in link was just sent to
  needEmail: false, // a sign-in link was opened on a device that doesn't know the email
  pendingDelete: false, // waiting for the user to confirm deletion via email
};

let fb = null;
let wired = false;
let deleting = null; // the in-flight deletion, so it can't run twice

const RECENT_MS = 4 * 60 * 1000; // Firebase wants a sign-in within ~5 minutes before deleting an account
const signedInRecently = (user) => Date.now() - (Date.parse(user?.metadata?.lastSignInTime || '') || 0) < RECENT_MS;

function set(patch) {
  Object.assign(state, patch);
  bus.emit('account:changed', getAccount());
}

export function getAccount() {
  return { ...state, user: state.user ? { ...state.user } : null };
}

const publicUser = (u) => ({
  uid: u.uid,
  email: u.email || '',
  name: u.displayName || '',
  photo: u.photoURL || '',
  provider: u.providerData?.[0]?.providerId || 'password',
});

/** Human messages for the Firebase errors people can actually hit. */
export function friendlyError(err) {
  const code = err?.code || '';
  const map = {
    'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow popups for this site and try again.',
    'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
    'auth/cancelled-popup-request': 'The sign-in window was closed before finishing.',
    'auth/network-request-failed': 'Couldn’t reach the sign-in service. Check your connection.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-email': 'Enter your email address.',
    'auth/unauthorized-domain': 'This web address isn’t allowed to sign in yet (add it under Firebase Authentication → Settings → Authorized domains).',
    'auth/unauthorized-continue-uri': 'This web address isn’t allowed to sign in yet (add it under Firebase Authentication → Settings → Authorized domains).',
    'auth/operation-not-allowed': 'This sign-in method isn’t turned on in Firebase yet.',
    'auth/quota-exceeded': 'Too many sign-in emails were sent today. Try again tomorrow or use Google.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/invalid-action-code': 'That sign-in link has expired or was already used. Request a new one.',
    'auth/expired-action-code': 'That sign-in link has expired. Request a new one.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/account-exists-with-different-credential': 'This email already uses a different sign-in method. Try the other option.',
  };
  return map[code] || err?.message || 'Something went wrong.';
}

/* ---------- loading & auth state ---------- */

async function ensureFirebase() {
  if (!fb) {
    fb = await loadFirebase();
    wireAuth();
  }
  return fb;
}

/** Starts loading the SDK early (e.g. when the sign-in buttons appear) so popups open instantly. */
export function prepare() {
  ensureFirebase().catch(() => {});
}

function wireAuth() {
  if (wired) return;
  wired = true;
  // Another device deleted this account (its data vanished from the server): sign out here too.
  bus.on('sync:account-gone', () => {
    if (state.status === 'signed-in' && !deleting) leaveDeletedAccount();
  });
  fb.A.onAuthStateChanged(fb.auth, async (user) => {
    if (!user) {
      const wasSignedIn = !!load(FLAG, false);
      remove(FLAG);
      if (wasSignedIn) {
        // Signed out from elsewhere (account deleted or session revoked): stop syncing and remove
        // this device's copy, the same as signing out here.
        const sync = await import('./sync.js');
        sync.stopSync();
        await clearDeviceData();
      }
      set({ status: 'signed-out', user: null });
      return;
    }
    save(FLAG, true);
    set({ status: 'signed-in', user: publicUser(user), error: null, linkSentTo: null, needEmail: false });
    if (load(PENDING_DELETE, null) === user.uid) {
      // Deletion is waiting for the emailed confirmation link. Don't sync an account that's being
      // deleted; finish only once the link has signed this user in again.
      if (signedInRecently(user)) await finishDeletionSafely(user);
      else set({ pendingDelete: true });
      return;
    }
    try {
      const sync = await import('./sync.js');
      await sync.startSync({ db: fb.db, F: fb.F, uid: user.uid });
    } catch (err) {
      console.warn('[aura] sync could not start', err);
    }
  });
}

const hasLinkParams = () => /[?&]mode=signIn\b/.test(location.search) && /[?&]oobCode=/.test(location.search);

/** Boot: only touches Firebase if this device is signed in or a sign-in link was just opened. */
export async function initAccount() {
  if (!load(FLAG, false) && !hasLinkParams() && !load(PENDING_DELETE, null)) return;
  set({ status: 'loading' });
  try {
    await ensureFirebase();
  } catch (err) {
    console.warn('[aura] Firebase failed to load', err);
    set({ status: 'error', error: 'Couldn’t reach the sync service. Your data is safe on this device; try again later.' });
    return;
  }
  if (fb.A.isSignInWithEmailLink(fb.auth, location.href)) await completeEmailLink();
}

/* ---------- sign in ---------- */

const googleProvider = () => {
  const p = new fb.A.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

export async function signInWithGoogle() {
  set({ error: null });
  // Open the popup in the same tick as the click when the SDK is ready (browsers block late popups).
  const ready = firebaseIfReady();
  try {
    if (ready) {
      if (!fb) {
        fb = ready;
        wireAuth();
      }
      await fb.A.signInWithPopup(fb.auth, googleProvider());
    } else {
      await ensureFirebase();
      await fb.A.signInWithPopup(fb.auth, googleProvider());
    }
  } catch (err) {
    set({ error: friendlyError(err) });
  }
}

/** Emails a one-time sign-in link that comes back to this exact page. */
export async function sendEmailLink(email) {
  set({ error: null });
  const clean = String(email || '').trim();
  try {
    await ensureFirebase();
    const url = location.origin + location.pathname;
    await fb.A.sendSignInLinkToEmail(fb.auth, clean, { url, handleCodeInApp: true });
    save(EMAIL_KEY, clean);
    set({ linkSentTo: clean });
    return true;
  } catch (err) {
    set({ error: friendlyError(err) });
    return false;
  }
}

/** Finishes signing in from an emailed link (asks for the email if this device doesn't know it). */
export async function completeEmailLink(emailInput) {
  const email = String(emailInput || load(EMAIL_KEY, '') || '').trim();
  if (!email) {
    set({ status: 'signed-out', needEmail: true });
    return false;
  }
  try {
    await ensureFirebase();
    const cred = await fb.A.signInWithEmailLink(fb.auth, email, location.href);
    remove(EMAIL_KEY);
    // Signing in again as the same user doesn't fire onAuthStateChanged, so a pending deletion
    // (confirmed by this link) finishes here.
    if (cred?.user && load(PENDING_DELETE, null) === cred.user.uid) await finishDeletionSafely(cred.user);
    return true;
  } catch (err) {
    set({ status: fb?.auth?.currentUser ? 'signed-in' : 'signed-out', error: friendlyError(err), needEmail: false });
    return false;
  } finally {
    // The link's one-time code shouldn't linger in the address bar or history.
    history.replaceState(null, '', location.origin + location.pathname);
  }
}

export function cancelEmailLink() {
  remove(EMAIL_KEY);
  set({ linkSentTo: null, needEmail: false, error: null });
}

/* ---------- sign out / delete ---------- */

// This device's copy of account data, removed on sign-out or deletion so the next person using
// this browser doesn't see it. Settings (appearance, timer lengths) stay.
async function clearDeviceData() {
  const [tasks, stats] = await Promise.all([import('../features/tasks.js'), import('../features/stats.js')]);
  tasks.clearLocal();
  stats.clearLocal();
}

export async function signOut() {
  set({ error: null });
  const sync = await import('./sync.js');
  sync.stopSync();
  try {
    if (fb) await fb.A.signOut(fb.auth);
  } catch (err) {
    console.warn('[aura] sign out failed', err);
  }
  remove(FLAG);
  await clearDeviceData();
  set({ status: 'signed-out', user: null, linkSentTo: null });
}

/**
 * Permanently deletes the account and all its synced data. Firebase requires a recent sign-in for
 * this, so a stale session first re-verifies (Google popup, or a confirmation email link).
 * @returns {'deleted' | 'confirm-email'}
 */
export async function deleteAccount() {
  set({ error: null });
  const user = fb?.auth?.currentUser;
  if (!user) return 'error';
  try {
    const isGoogle = user.providerData?.some((p) => p.providerId === 'google.com');
    if (!signedInRecently(user)) {
      if (isGoogle) {
        await fb.A.reauthenticateWithPopup(user, googleProvider());
      } else {
        // Email accounts confirm by clicking a fresh sign-in link; deletion finishes on return.
        // Nothing is deleted until then, and it can be cancelled (cancelDeletion).
        save(PENDING_DELETE, user.uid);
        const ok = await sendEmailLink(user.email);
        if (!ok) {
          remove(PENDING_DELETE);
          return 'error';
        }
        (await import('./sync.js')).stopSync();
        set({ pendingDelete: true });
        return 'confirm-email';
      }
    }
    await finishDeletionSafely(user);
    return state.status === 'signed-out' ? 'deleted' : 'error';
  } catch (err) {
    set({ error: friendlyError(err) });
    return 'error';
  }
}

/** Keeps the account: drops the pending deletion and resumes syncing. */
export async function cancelDeletion() {
  remove(PENDING_DELETE);
  set({ pendingDelete: false, linkSentTo: null, error: null });
  const user = fb?.auth?.currentUser;
  if (!user) return;
  try {
    const sync = await import('./sync.js');
    await sync.startSync({ db: fb.db, F: fb.F, uid: user.uid });
  } catch (err) {
    console.warn('[aura] sync could not start', err);
  }
}

async function finishDeletionSafely(user) {
  if (!deleting) {
    deleting = finishDeletion(user)
      .catch((err) => set({ error: friendlyError(err) }))
      .finally(() => {
        deleting = null;
      });
  }
  return deleting;
}

// The account was deleted on another device: stop syncing, end the session and remove this copy.
async function leaveDeletedAccount() {
  const sync = await import('./sync.js');
  sync.stopSync();
  remove(FLAG);
  try {
    await fb?.A.signOut(fb.auth);
  } catch {
    /* already gone */
  }
  await clearDeviceData();
  set({ status: 'signed-out', user: null, pendingDelete: false, linkSentTo: null });
  try {
    const { toast } = await import('../ui/notify.js');
    toast('This account was deleted on another device, so it was signed out here.', { title: 'Signed out', icon: 'logout' });
  } catch {
    /* toast is optional */
  }
}

async function finishDeletion(user) {
  const sync = await import('./sync.js');
  sync.stopSync();
  await sync.deleteCloudData({ db: fb.db, F: fb.F, uid: user.uid });
  await fb.A.deleteUser(user);
  remove(PENDING_DELETE);
  remove(FLAG);
  await clearDeviceData();
  set({ status: 'signed-out', user: null, pendingDelete: false, linkSentTo: null });
  try {
    const { toast } = await import('../ui/notify.js');
    toast('Your account and all synced data were deleted.', { title: 'Account deleted', tone: 'success', icon: 'check' });
  } catch {
    /* toast is optional */
  }
}
