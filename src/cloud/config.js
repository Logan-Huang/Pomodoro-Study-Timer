// Firebase web configuration for the "aura-b9845" project.
//
// These values only identify the project; they are public by design and safe to commit. Access to
// data is enforced by the Firestore security rules in /firestore.rules (each signed-in user can read
// and write only their own documents). Google Analytics is intentionally not used.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBkIl2A4Rc8ZPzybpSR3eL7iCS7-pqCRs8',
  authDomain: 'aura-b9845.firebaseapp.com',
  projectId: 'aura-b9845',
  storageBucket: 'aura-b9845.firebasestorage.app',
  messagingSenderId: '37161364621',
  appId: '1:37161364621:web:9aa1d9c2a51b878059c6c4',
};

// The Firebase JS SDK is loaded from Google's CDN only when someone signs in (or is signed in), so
// people who never use an account never contact Firebase.
export const SDK_VERSION = '12.19.0';
export const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
