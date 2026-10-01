// Google Identity Services (token model) + plain-fetch Calendar REST client.
import { load, save, remove } from '../core/storage.js';
import { API_BASE, SCOPE_READ, SCOPE_WRITE } from './config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'gcal.token';

// Classic Google Calendar event colour palette (colorId -> hex).
const EVENT_COLORS = {
  1: '#a4bdfc', 2: '#7ae7bf', 3: '#dbadff', 4: '#ff887c', 5: '#fbd75b', 6: '#ffb878',
  7: '#46d6db', 8: '#e1e1e1', 9: '#5484ed', 10: '#51b749', 11: '#dc2127',
};
const FALLBACK_COLOR = '#a78bfa';

export class GcalError extends Error {
  constructor(message, code = 'unknown') {
    super(message);
    this.name = 'GcalError';
    this.code = code;
  }
}

const gisReady = () => !!window.google?.accounts?.oauth2;
export const isGisReady = gisReady;

let gisPromise = null;

/** Inject the GIS client script once; resolves when google.accounts.oauth2 exists. */
export function loadGis() {
  if (gisReady()) return Promise.resolve(window.google);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    let settled = false;
    const message = "Couldn't load Google sign-in. Check your internet connection, or disable any ad/privacy extension that blocks accounts.google.com.";
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      gisPromise = null;
      document.querySelector(`script[src="${GIS_SRC}"]`)?.remove();
      reject(new GcalError(message, 'gis_load'));
    };
    const timeout = setTimeout(fail, 10000);
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onerror = fail;
    script.onload = () => {
      const poll = () => {
        if (settled) return;
        if (gisReady()) {
          settled = true;
          clearTimeout(timeout);
          resolve(window.google);
        } else setTimeout(poll, 50);
      };
      poll();
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

/**
 * Request an access token. MUST be called from a user gesture (click handler): when GIS is
 * already loaded, requestAccessToken runs synchronously so the popup is not blocked — call
 * loadGis() ahead of time to guarantee that.
 */
export function connect({ clientId, write = false, prompt = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (!clientId || !String(clientId).trim()) {
      reject(new GcalError('Add your Google OAuth Client ID first.', 'no_client_id'));
      return;
    }
    const start = () => {
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: String(clientId).trim(),
          scope: write ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ,
          include_granted_scopes: true,
          callback: (resp) => {
            if (!resp || resp.error) {
              reject(new GcalError(resp?.error_description || resp?.error || 'Google sign-in failed.', resp?.error || 'unknown'));
              return;
            }
            const token = {
              access_token: resp.access_token,
              expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
              scope: resp.scope || (write ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ),
            };
            save(TOKEN_KEY, token);
            resolve(token);
          },
          error_callback: (err) => {
            const type = err?.type || 'popup_failed_to_open';
            reject(new GcalError(err?.message || 'Google sign-in was interrupted.', type));
          },
        });
        client.requestAccessToken({ prompt });
      } catch (e) {
        reject(new GcalError(e?.message || 'Google sign-in failed.', 'client'));
      }
    };
    if (gisReady()) start();
    else loadGis().then(start, reject);
  });
}

/** Stored token record (may be expired or blanked after a 401), or null. */
export function getStoredToken() {
  const tok = load(TOKEN_KEY, null);
  return tok && typeof tok === 'object' ? tok : null;
}

/** True if a token was ever stored (used for the "session expired" state). */
export const hadToken = () => !!getStoredToken();

/** Valid token record ({access_token, expires_at, scope}) or null. */
export function getToken() {
  const tok = getStoredToken();
  return tok?.access_token && tok.expires_at - 60000 > Date.now() ? tok : null;
}

export function hasScope(scope) {
  const tok = getToken();
  return !!tok && String(tok.scope || '').split(/\s+/).includes(scope);
}

export function disconnect() {
  const tok = getStoredToken();
  try {
    if (tok?.access_token && gisReady()) window.google.accounts.oauth2.revoke(tok.access_token, () => {});
  } catch { /* revoke is best effort */ }
  remove(TOKEN_KEY);
}

function expireToken() {
  const tok = getStoredToken();
  save(TOKEN_KEY, { expires_at: 0, scope: tok?.scope || '' });
}

async function errorFromResponse(res) {
  let reason = '';
  let message = '';
  try {
    const data = await res.json();
    reason = data?.error?.errors?.[0]?.reason || data?.error?.status || '';
    message = data?.error?.message || '';
  } catch { /* non-JSON body */ }
  if (res.status === 429 || /rateLimit|quotaExceeded|userRateLimit/i.test(reason)) {
    return new GcalError('Google is rate-limiting requests right now. Give it a minute and refresh.', 'rate');
  }
  if (res.status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + message)) {
      return new GcalError('The Google Calendar API is not enabled for your Cloud project. Enable it in APIs & Services → Library.', 'api_disabled');
    }
    return new GcalError('Google denied access to that calendar. Try reconnecting and granting calendar access.', 'forbidden');
  }
  if (res.status === 404) return new GcalError('That calendar could not be found.', 'not_found');
  return new GcalError(message || `Google Calendar returned an error (${res.status}).`, 'http');
}

/** Authenticated REST call. Throws GcalError with code auth | network | rate | forbidden | http. */
export async function api(path, { method = 'GET', params, body } = {}) {
  const tok = getToken();
  if (!tok) throw new GcalError('Session expired — reconnect Google Calendar.', 'auth');
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    (Array.isArray(value) ? value : [value]).forEach((v) => url.searchParams.append(key, v));
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${tok.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GcalError("Can't reach Google Calendar. Check your connection.", 'network');
  }
  if (res.status === 401) {
    expireToken();
    throw new GcalError('Session expired — reconnect Google Calendar.', 'auth');
  }
  if (!res.ok) throw await errorFromResponse(res);
  return res.status === 204 ? null : res.json();
}

export async function listCalendars() {
  const data = await api('/users/me/calendarList', { params: { minAccessRole: 'reader', maxResults: 100 } });
  return (data?.items || []).map((c) => ({
    id: c.id,
    summary: c.summaryOverride || c.summary || c.id,
    color: c.backgroundColor || FALLBACK_COLOR,
    primary: !!c.primary,
    accessRole: c.accessRole || 'reader',
  }));
}

function parseWhen(when) {
  if (when?.dateTime) return { ms: Date.parse(when.dateTime), allDay: false };
  if (when?.date) {
    const [y, m, d] = when.date.split('-').map(Number);
    return { ms: new Date(y, m - 1, d).getTime(), allDay: true }; // local midnight
  }
  return { ms: NaN, allDay: false };
}

function normalizeEvent(item, calendarId, calendarColor) {
  const start = parseWhen(item.start);
  const end = parseWhen(item.end);
  if (Number.isNaN(start.ms) || Number.isNaN(end.ms)) return null;
  return {
    id: `${calendarId}:${item.id}`,
    calendarId,
    title: item.summary || '(No title)',
    start: start.ms,
    end: Math.max(end.ms, start.ms),
    allDay: start.allDay,
    color: (item.colorId && EVENT_COLORS[item.colorId]) || calendarColor || FALLBACK_COLOR,
    location: item.location || '',
    htmlLink: item.htmlLink || '',
    description: item.description || '',
    kind: 'busy', // re-classified by the calendar service
  };
}

const isDeclined = (item) => (item.attendees || []).some((a) => a.self && a.responseStatus === 'declined');

/** Fetch + normalize events for several calendars in parallel. `calendars` (optional) supplies colours. */
export async function listEvents({ calendarIds = ['primary'], timeMin, timeMax, calendars = [] } = {}) {
  const colorFor = (id) => {
    const cal = calendars.find((c) => c.id === id || (id === 'primary' && c.primary));
    return cal?.color || FALLBACK_COLOR;
  };
  const results = await Promise.allSettled(calendarIds.map(async (id) => {
    const data = await api(`/calendars/${encodeURIComponent(id)}/events`, {
      params: {
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: 250,
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
      },
    });
    const color = colorFor(id);
    return (data?.items || [])
      .filter((item) => item.status !== 'cancelled' && !isDeclined(item))
      .map((item) => normalizeEvent(item, id, color))
      .filter(Boolean);
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  const auth = failed.find((r) => r.reason?.code === 'auth');
  if (auth) throw auth.reason;
  if (failed.length && failed.length === results.length) throw failed[0].reason;
  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Create an event (session logging). Needs the calendar.events scope. */
export function createEvent({ calendarId = 'primary', title, start, end, description = '', colorId } = {}) {
  return api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: {
      summary: title,
      description,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
      ...(colorId ? { colorId: String(colorId) } : {}),
    },
  });
}
