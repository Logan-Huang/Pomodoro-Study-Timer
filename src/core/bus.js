// Tiny synchronous pub/sub. Handler errors are isolated so one bad listener never breaks emit().
const handlers = new Map();

function off(event, fn) {
  const set = handlers.get(event);
  if (!set) return;
  set.delete(fn);
  if (!set.size) handlers.delete(event);
}

function on(event, fn) {
  if (typeof fn !== 'function') return () => {};
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(fn);
  return () => off(event, fn);
}

function once(event, fn) {
  const unsub = on(event, (payload) => {
    unsub();
    return fn(payload);
  });
  return unsub;
}

function emit(event, payload) {
  const set = handlers.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[aura] handler for "${event}" failed`, err);
    }
  }
}

export const bus = { on, once, off, emit };
