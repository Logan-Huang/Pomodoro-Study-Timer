// Lazy Firebase loader: fetches the modular SDK (app, auth, firestore) from the CDN on first use and
// initialises it once.
//
// Firestore's cache is in memory only. Aura's own local storage already keeps this device's copy
// (and is cleared on sign-out), so nothing extra is left behind in the browser, and each tab talks
// to the server on its own instead of coordinating through IndexedDB (which can stall).
import { FIREBASE_CONFIG, SDK_BASE } from './config.js';

let loading = null;
let ready = null;

/** @returns {Promise<{ app, auth, db, A: object, F: object }>} A = auth module, F = firestore module */
export function loadFirebase() {
  if (!loading) {
    loading = (async () => {
      const [appMod, A, F] = await Promise.all([
        import(`${SDK_BASE}/firebase-app.js`),
        import(`${SDK_BASE}/firebase-auth.js`),
        import(`${SDK_BASE}/firebase-firestore.js`),
      ]);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      const auth = A.getAuth(app);
      const db = F.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: F.memoryLocalCache() });
      removeOldCache();
      ready = { app, auth, db, A, F };
      return ready;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

// Earlier versions kept Firestore's cache in IndexedDB ("firestore/…" databases); remove it. If an
// old tab still has it open, the browser finishes deleting once that tab closes.
function removeOldCache() {
  try {
    indexedDB
      .databases?.()
      .then((list) => list.forEach((d) => d.name?.startsWith('firestore/') && indexedDB.deleteDatabase(d.name)))
      .catch(() => {});
  } catch {
    /* IndexedDB unavailable */
  }
}

/**
 * The loaded SDK, or null if it hasn't finished loading. Sign-in popups must open straight from a
 * click (browsers block popups after a slow await), so the UI preloads and then uses this.
 */
export function firebaseIfReady() {
  return ready;
}
