// Google Calendar integration constants.
//
// GOOGLE_CLIENT_ID: an OAuth 2.0 "Web application" client ID from
// https://console.cloud.google.com/apis/credentials (enable the Google Calendar API,
// configure the OAuth consent screen, add yourself as a Test user, and add this app's
// origin — e.g. http://localhost:5173 — to "Authorized JavaScript origins").
// You can leave it empty: the Client ID field on the Schedule tab is stored in settings
// and takes precedence over this constant.
export const GOOGLE_CLIENT_ID = '';

export const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly';
export const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events';
export const API_BASE = 'https://www.googleapis.com/calendar/v3';
