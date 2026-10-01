// A realistic student day in local time, used when no Google account is connected.
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { classifyEvent } from './planner.js';

const MIN = 60000;
const STEP = 5 * MIN;

const C = {
  violet: '#a78bfa', cyan: '#22d3ee', pink: '#f472b6', green: '#34d399',
  amber: '#fbbf24', blue: '#60a5fa', rose: '#fb7185', teal: '#2dd4bf',
};

export function buildDemoDay(now = Date.now(), keywords) {
  const kw = keywords || DEFAULT_SETTINGS.calendar.studyKeywords;
  const base = new Date(now);
  const at = (dayOffset, h, m = 0) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h, m).getTime();

  const template = [
    [0, 8, 0, 8, 45, 'Morning review · Flashcards', C.violet, '', 'Anki deck: Organic reactions'],
    [0, 9, 30, 10, 45, 'Calculus II — Lecture', C.blue, 'Hall B, Room 204', ''],
    [0, 11, 0, 12, 30, 'Study: Organic Chemistry', C.cyan, 'Library, 3rd floor', 'Chapters 9–11, practice mechanisms'],
    [0, 12, 30, 13, 15, 'Lunch with Maya', C.amber, 'Campus café', ''],
    [0, 14, 0, 15, 30, 'Physics Lab', C.rose, 'Science Building, Lab 2', ''],
    [0, 16, 0, 17, 30, 'Deep work: History essay', C.pink, '', 'Outline and first two body paragraphs'],
    [0, 19, 0, 20, 30, 'Exam prep — Biology', C.green, '', 'Past papers, timed'],
    [0, 21, 0, 21, 45, 'Gym', C.teal, 'Rec Center', ''],
    [1, 9, 0, 10, 0, 'Statistics — Lecture', C.blue, 'Hall A, Room 110', ''],
    [1, 10, 30, 12, 0, 'Study: Reading group notes', C.violet, 'Library, quiet room', ''],
  ];

  // The live block: guaranteed around "now" so the demo always shows the running experience.
  const liveStart = Math.floor((now - 25 * MIN) / STEP) * STEP;
  const liveEnd = Math.ceil((now + 65 * MIN) / STEP) * STEP;

  const events = template
    .map(([d, sh, sm, eh, em, title, color, location, description], i) => ({
      id: `demo-${i}`,
      calendarId: 'demo',
      title,
      start: at(d, sh, sm),
      end: at(d, eh, em),
      allDay: false,
      color,
      location,
      htmlLink: '',
      description,
      kind: 'busy',
    }))
    .filter((e) => !(e.start < liveEnd && e.end > liveStart));

  events.push({
    id: 'demo-live',
    calendarId: 'demo',
    title: 'Focus sprint: Problem set 4',
    start: liveStart,
    end: liveEnd,
    allDay: false,
    color: C.violet,
    location: '',
    htmlLink: '',
    description: 'Linear algebra, problem set 4',
    kind: 'study',
  });

  events.push({
    id: 'demo-allday',
    calendarId: 'demo',
    title: "Maya's birthday",
    start: at(0, 0),
    end: at(1, 0),
    allDay: true,
    color: C.pink,
    location: '',
    htmlLink: '',
    description: '',
    kind: 'busy',
  });

  return events
    .map((e) => ({ ...e, kind: classifyEvent(e, kw) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}
