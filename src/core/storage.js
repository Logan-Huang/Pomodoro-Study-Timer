// localStorage wrapper: JSON values, "aura:" key prefix, never throws.
const PREFIX = 'aura:';

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function load(key, fallback = null) {
  try {
    const s = store();
    if (!s) return fallback;
    const raw = s.getItem(PREFIX + key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    const s = store();
    if (s) s.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
