// Lazy Firebase loader: fetches the modular SDK (app, auth, firestore) from the CDN on first use and
// initialises it once. Firestore keeps an offline cache in IndexedDB, so the app works offline and
// queued writes sync when the connection returns.
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
      let db;
      try {
        db = F.initializeFirestore(app, {
          ignoreUndefinedProperties: true,
          localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
        });
      } catch (err) {
        // Private windows or blocked IndexedDB: fall back to an in-memory cache.
        console.warn('[aura] Firestore offline cache unavailable', err);
        db = F.initializeFirestore(app, { ignoreUndefinedProperties: true });
      }
      ready = { app, auth, db, A, F };
      return ready;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/**
 * The loaded SDK, or null if it hasn't finished loading. Sign-in popups must open straight from a
 * click (browsers block popups after a slow await), so the UI preloads and then uses this.
 */
export function firebaseIfReady() {
  return ready;
}
