# Aura

Aura is a calm, beautiful study timer. It has three modes, a living aurora background behind frosted glass, synthesized soundscapes, and an optional Google Calendar connection that plans Pomodoro cycles inside the study blocks you already scheduled.

It is plain JavaScript (ES modules) with no build step and no npm dependencies.

## Features

**Pomodoro**
- Focus, short break and long break cycles, all configurable.
- Optional auto-start for breaks and for the next focus session.
- "Session N of M" tracking and a long break every N sessions.
- Accurate in background tabs: timing uses absolute timestamps and a worker ticker.

**Timer**
- A regular countdown with presets and a custom duration.
- Add or remove a minute on the fly.
- A Stopwatch sub-mode with laps.

**Schedule**
- Connect Google Calendar (read-only by default) and see today's timeline.
- Study blocks and free windows are detected automatically.
- Aura plans Pomodoro cycles that fit exactly inside a calendar block.
- A countdown to your next event.
- A demo day works with zero Google setup.
- You can ignore the calendar entirely and just use Pomodoro or Timer.

**Everywhere**
- Tasks with minute estimates: time from any timer (Pomodoro, countdown, stopwatch, calendar plan) counts toward the task you're working on.
- Stats and streaks, plus a daily goal that fills live, one minute at a time, while a session runs.
- Ambient soundscapes (rain, ocean, wind, brown/pink noise, fire) and chimes, all synthesized with the Web Audio API.
- Desktop notifications, a countdown in the tab title, and progress on the favicon.
- Zen mode, fullscreen, and keyboard shortcuts.
- A clock in the top bar whose icon follows the time of day: sun, sunrise/sunset or moon. Click it to switch between 12- and 24-hour time; hovering shows the next sunrise or sunset. Configure it in Settings → Appearance.
- Six themes, each with its own hand-tuned nature scene and weather, painted live in WebGL:
  - Aurora: alpine lake under the northern lights (snow)
  - Midnight: moonlit glacier peaks (snow)
  - Forest: misty pine ridges with a lit cabin (fireflies)
  - Ocean: moonlit sea with a lighthouse (sea glints)
  - Sunset: desert mesas at dusk (warm dust)
  - Sakura: cherry-blossom valley with a pagoda and pond (petals)
  - Turn scenery off in Settings → Appearance → Nature scenery.
  - **Time of day:** by default the scenes follow your clock, using seasonal sunrise and sunset times. You get dawn light, a sunny daytime sky with clouds, golden hour, then night with its moon and aurora. Pin a look with Settings → Appearance → Time of day (Auto / Dawn / Day / Dusk / Night).
  - Add `?tod=dusk` or `?hour=18.5` to the URL to preview a time without saving it.
  - Add `?theme=forest` (or any theme) to the URL to preview a theme without saving it.
  - The first time you open a theme, its scene takes a few seconds to prepare and then fades in. After that it appears instantly.

## Quick start

You need Node.js 18 or newer.

```bash
npm start
```

Then open http://localhost:5173.

Aura must be served over http. ES modules and Google sign-in do not work from a `file://` URL.

## Google Calendar setup

Aura talks to Google directly from your browser using Google Identity Services. You create your own OAuth client, which takes about five minutes.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a **new project**.
2. Go to **APIs & Services > Library**, search for **Google Calendar API** and click **Enable**.
3. Go to **APIs & Services > OAuth consent screen**.
   - User type: **External**.
   - Fill in an app name and your email address.
   - Scopes: add `https://www.googleapis.com/auth/calendar.readonly`. Add `https://www.googleapis.com/auth/calendar.events` only if you want session logging (Aura writes finished focus sessions to your calendar).
   - Under **Test users**, add your own Google account.
4. Go to **APIs & Services > Credentials > Create credentials > OAuth client ID**.
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: `http://localhost:5173`
   - No redirect URI is needed.
5. Copy the **Client ID**.
6. Paste it into the Client ID field in Aura's **Schedule** tab, or set `GOOGLE_CLIENT_ID` in `src/calendar/config.js`.
7. Click **Connect Google Calendar** and approve access.

### How study blocks are detected

Every event is checked against a list of study keywords such as `study`, `focus`, `homework`, `review`, `exam`, `reading` and `deep work`. A matching event becomes a study block. You can edit the keyword list from the Schedule menu.

For a study block, Aura fills the exact time span with Pomodoro cycles using your focus and break lengths, adjusting the last segments so the plan ends when the block ends. Gaps between events are shown as free windows that you can plan the same way.

### Privacy

- Everything stays in your browser. Settings, tasks, stats and calendar data are stored in `localStorage` and never sent to any server of ours (there is none).
- Access tokens are short-lived (about an hour) and are not refreshed silently in the background.
- Aura is read-only unless you turn on session logging.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Start / pause |
| R | Reset |
| S | Skip segment |
| L | Lap (stopwatch) |
| Up / Down | Add / remove one minute |
| 1 / 2 / 3 | Pomodoro / Timer / Schedule |
| T | Tasks |
| I | Insights |
| M | Soundscapes |
| , | Settings |
| Z | Zen mode |
| F | Fullscreen |
| ? | Show shortcuts |
| Esc | Close overlay, then panel, then zen |

Shortcuts are ignored while you type in a field, and when Ctrl, Cmd or Alt is held.

## Project structure

```
index.html            App shell and DOM skeleton
server.js             Zero-dependency static server
styles/               base (design system), layout, fx, timer, schedule, panels, settings
src/main.js           Boot sequence and wiring
src/core/             bus, storage, settings, state
src/ui/               icons, panels, mode switch, shortcuts, settings panel, views
src/timer/            Timer engine and entry point
src/fx/               WebGL aurora, particles, themes, spotlight
src/calendar/         Google auth, events, planner, demo day
src/features/         Tasks and stats
src/audio/            Web Audio synthesis
```

## Troubleshooting

- **`origin_mismatch` or a redirect error:** the address in your browser must exactly match an Authorized JavaScript origin, including the port. `http://localhost:5173` and `http://127.0.0.1:5173` are different origins.
- **The sign-in popup does nothing:** your browser blocked it. Allow popups for localhost and try again.
- **`access_denied`:** your Google account is not listed under **Test users** on the OAuth consent screen. Add it and retry.
- **A blank page, or module errors in the console:** you opened `index.html` from `file://`. Run `npm start` and use http://localhost:5173.
- **Port 5173 is in use:** start on another port with `PORT=5174 npm start` (PowerShell: `$env:PORT=5174; npm start`), then add that new origin, for example `http://localhost:5174`, to the Authorized JavaScript origins.
- **Calendar shows nothing after a while:** the token expired. Click Connect again.
