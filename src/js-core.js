ICON.sprout = '<svg viewBox="0 0 20 20" width="19" height="19" aria-hidden="true"><path d="M10 17.5V9.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 10.5C10 6.6 7.3 4.4 3.4 4.6 3.3 8.4 6 10.8 10 10.5Z" fill="currentColor"/><path d="M10 8.6c.2-3.3 2.6-5.3 6-5.1.1 3.3-2.3 5.4-6 5.1Z" fill="currentColor" opacity=".75"/></svg>';
ICON.bell = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1.4a3.3 3.3 0 0 0-3.3 3.3v2.2L1.6 8.6h8.8L9.3 6.9V4.7A3.3 3.3 0 0 0 6 1.4zM4.8 10a1.3 1.3 0 0 0 2.4 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
ICON.why = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.8l1.5 3.6 3.9.4-3 2.6.9 3.8L8 10.2l-3.3 2 .9-3.8-3-2.6 3.9-.4z" fill="currentColor"/></svg>';
ICON.play = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M6.5 4.6v10.8a.9.9 0 0 0 1.37.77l8.6-5.4a.9.9 0 0 0 0-1.54l-8.6-5.4A.9.9 0 0 0 6.5 4.6z" fill="currentColor"/></svg>';
ICON.stop = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="2.2" fill="currentColor"/></svg>';
ICON.chat = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 16 14H9.5L6 17v-3H4A1.5 1.5 0 0 1 2.5 12.5V6A1.5 1.5 0 0 1 4 4.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
ICON.plan = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
ICON.ext = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
ICON.down = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ---------- constants ---------- */
const SCALE = [1, 2, 3, 5, 8, 13];
const EST = { 1: 10, 2: 25, 3: 45, 5: 90, 8: 180, 13: 300 };
const GCAL = "Google Calendar";
const APP_LINK = "";
const DEFAULTS = { why: "", dailyTarget: 10, focusMin: 25, breakMin: 5, nudges: true, nudgeCap: 5, busy: [], checkin: null, lastCheckin: null, bsCalendarId: null, bsCalendarName: "", bsFeedUrl: "", lastSync: null, anchors: [], appUrl: "", digest: null, bank: null };
const ANCHORS = [
  { key: "wake", summary: "Up. Water, then shower.", h: 7, m: 0, len: 10, desc: "Alarm is across the room. Lights on, drink the water, straight into the shower. No snooze." },
  { key: "prep", summary: "Night prep", h: 21, m: 30, len: 15, desc: "Clothes out, bag packed, breakfast and coffee ready, tomorrow's first step written down." },
  { key: "down", summary: "Screens off. Bed by 11.", h: 22, m: 30, len: 15, desc: "Phone on the charger across the room, alarm set for 7:00." },
];
const CHECKIN_TIMES = ["08:00", "12:00", "17:00", "20:00", "21:00", "22:00"];
const COURSE_CODE = /\b([A-Za-z]{2,5})\s?-?\s?(\d{3}[A-Za-z]?)\b/;
const BS_NAME = /binghamton|brightspace|all courses|d2l/i;
const COURSE_COLORS = ["#5b6cff", "#10a99a", "#ff7a59", "#9b5cf6", "#e9a21b", "#ff5c9a", "#2ea8ff", "#5fb34a"];
const FIRST_TREE = 10, TREE_STEP = 20;
const TIERS = { red: "Urgent", yellow: "Start today", green: "Plenty of time" };
const VIEWS = ["today", "garden"];
const INSTANCE = rid("i");
const RING_C = 2 * Math.PI * 96;

/* ---------- state ---------- */
const S = {
  db: null, mcp: null, sample: null, noDb: false, notOwner: false,
  loaded: { tasks: false, settings: false, chat: false, habits: false },
  tasks: new Map(), settings: Object.assign({}, DEFAULTS), timer: null, chat: [], ver: 0, habits: { list: [], log: {}, opened: [] },
  habitAdd: false, progCourse: null, progAll: false, focusLink: false, askedFor: null, adjust: false, stopped: new Set(), helperBusy: {}, editLink: null, addLink: null, chatMin: store.get("gp.chatMin", true) !== false,
  settingsOpen: false, sheetTask: null, showAll: false, feedAll: false, skipIds: new Set(), confirmClear: false,
  busy: { send: false, sync: false, cals: false, anchors: false, checkin: false },
  undo: new Map(), hist: [], undoLabel: new Map(), sampleOff: false, calStatus: null, connecting: false,
  autoSynced: false, phaseBusy: false, calWarned: false,
  view: (() => { const v = store.get("gp.view", "today"); return VIEWS.indexOf(v) >= 0 ? v : "today"; })(),
  calMonth: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  calSel: dayKey(new Date()), gcal: {},
  folds: store.get("gp.folds", {}) || {}, focusOpen: true, flSig: null, autoFirst: {}, planTimer: 0, planning: false, planAgain: false, leader: false, lastPlan: 0,
};
const ready = () => S.loaded.tasks && S.loaded.settings && S.loaded.chat;
const openTasks = () => Array.from(S.tasks.values()).filter((t) => t.status === "open");
const minutesOf = (t) => (t.log || []).reduce((a, e) => a + (+e.m || 0), 0);
const focusLen = () => 25;
const soundOn = () => store.get("gp.sound", true) !== false;
function isWide() { try { return matchMedia("(min-width: 1000px)").matches; } catch (e) { return false; } }
function isDark() { const dt = document.documentElement.getAttribute("data-theme"); if (dt) return dt === "dark"; try { return matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; } }
