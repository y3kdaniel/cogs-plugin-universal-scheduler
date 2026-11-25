window.onerror = function (msg, src, line) {
  const tel = document.getElementById("telemetry");
  if (tel) {
    tel.style.color = "#f87171";
    tel.textContent = "JS Error (line " + line + "): " + msg;
  }
};

const PLUGIN_VERSION = "3.2.0";
const GITHUB_REPO = "y3kdaniel/cogs-plugin-universal-scheduler";
const STORAGE_KEY = "cogs_universal_scheduler_v3";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const JS_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const INLINE_MANIFEST = {
  name: "Universal Scheduler",
  version: "3.2.0",
  minCogsVersion: "4.10.0",
  config: [
    {
      name: "openScheduleEditor",
      value: { type: "boolean", default: true }
    }
  ],
  store: {
    items: {
      schedulerData: { persistValue: true }
    }
  },
  state: [
    { name: "activeSchedules", value: { type: "string", default: "" } },
    { name: "activeCount", value: { type: "number", default: 0, min: 0, integer: true } },
    {
      "name": "targetVariable",
      "value": {
        "type": "string",
        "default": ""
      }
    },
    {
      "name": "targetValue",
      "value": {
        "type": "string",
        "default": ""
      }
    },
    { name: "timeHHMM", value: { type: "number", default: 0, min: 0, max: 2359, integer: true } },
    { name: "minutesSinceMidnight", value: { type: "number", default: 0, min: 0, max: 1439, integer: true } },
    {
      name: "dayOfWeek",
      value: {
        type: "option",
        default: "Sunday",
        options: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
      }
    },
    { name: "isWeekend", value: { type: "boolean", default: false } },
    { name: "month", value: { type: "number", default: 1, min: 1, max: 12, integer: true } },
    { name: "dayOfMonth", value: { type: "number", default: 1, min: 1, max: 31, integer: true } },
    { name: "dateISO", value: { type: "string", default: "" } }
  ],
  events: {
    toCogs: [
      { name: "scheduleStarted", value: { type: "string", default: "" } },
      { name: "scheduleEnded", value: { type: "string", default: "" } },
      { name: "clockStrikes", value: { type: "string", default: "" } }
    ]
  }
};

window.AppState = {
  cogs: null,
  isConnected: false,
  activeIds: new Set(),
  hasInitialized: false,
  lastMinuteKey: "",
  openBulkHelper: {},
  showVariables: {},
  store: null
};

const DEFAULT_STORE = {
  settings: { resetOverridesOnStartup: true },
  schedules: [
    {
      id: "default-1",
      name: "Night Show",
      enabled: true,
      override: "auto",
      autoRecover: true,
      mode: "dates",
      dates: ["2026-10-30", "2026-10-31"],
      daysOfWeek: [],
      startTime: "17:00",
      hasEndTime: true,
      endTime: "23:00",
      targetVariable: "",
      activeValue: "",
      restoreOnEnd: true,
      inactiveValue: ""
    }
  ]
};

function normalizeSchedule(s) {
  return {
    id: s.id || "sched-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    name: s.name || "",
    enabled: s.enabled !== false,
    override: s.override || "auto",
    autoRecover: s.autoRecover !== false,
    mode: s.mode || "dates",
    dates: Array.isArray(s.dates) ? s.dates : [],
    daysOfWeek: Array.isArray(s.daysOfWeek) ? s.daysOfWeek : [],
    startTime: s.startTime || "17:00",
    hasEndTime: s.hasEndTime !== false,
    endTime: s.endTime || "23:00",
    targetVariable: s.targetVariable || "",
    activeValue: s.activeValue !== undefined ? String(s.activeValue) : "",
    restoreOnEnd: s.restoreOnEnd !== false,
    inactiveValue: s.inactiveValue !== undefined ? String(s.inactiveValue) : ""
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        settings: {
          resetOverridesOnStartup:
            parsed.settings && typeof parsed.settings.resetOverridesOnStartup === "boolean"
              ? parsed.settings.resetOverridesOnStartup
              : true
        },
        schedules: Array.isArray(parsed.schedules) ? parsed.schedules.map(normalizeSchedule) : []
      };
    }
  } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

function persistStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.store));
  } catch (e) {}
}

AppState.store = loadStore();

if (AppState.store.settings.resetOverridesOnStartup) {
  let changed = false;
  for (const s of AppState.store.schedules) {
    if (s.override && s.override !== "auto") {
      s.override = "auto";
      changed = true;
    }
  }
  if (changed) persistStore();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function parseTimeToMinutes(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return -1;
  const parts = hhmm.split(":");
  const h = Number(parts.at(0));
  const m = Number(parts.at(1));
  return Number.isNaN(h) || Number.isNaN(m) ? -1 : h * 60 + m;
}

function isWithinWindow(nowMinutes, startMinutes, hasEndTime, endMinutes) {
  if (startMinutes < 0) return false;
  if (!hasEndTime) return nowMinutes === startMinutes;
  if (endMinutes < 0) return false;
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function isRuleActiveNow(rule, dateISO, dayName, nowMinutes) {
  if (!rule.enabled) return false;
  if (rule.override === "force_on") return true;
  if (rule.override === "force_off") return false;

  const startMin = parseTimeToMinutes(rule.startTime);
  const endMin = parseTimeToMinutes(rule.endTime);
  if (!isWithinWindow(nowMinutes, startMin, rule.hasEndTime, endMin)) return false;

  if (rule.mode === "daily") return true;
  if (rule.mode === "days") return Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.includes(dayName);
  if (rule.mode === "dates") return Array.isArray(rule.dates) && rule.dates.includes(dateISO);
  return false;
}

function coerceValueForVariable(varName, rawValue) {
  const varDef = AppState.showVariables[varName];
  if (!varDef) return rawValue;
  if (varDef.type === "boolean") {
    return rawValue === true || String(rawValue).toLowerCase() === "true";
  }
  if (varDef.type === "number") {
    const num = Number(rawValue);
    return Number.isNaN(num) ? 0 : num;
  }
  return String(rawValue);
}

function applyShowVariable(varName, rawValue) {
  if (!varName || rawValue === undefined || rawValue === "") return;
  if (!AppState.cogs || !AppState.isConnected) return;
  try {
    const typedValue = coerceValueForVariable(varName, rawValue);
    if (typeof AppState.cogs.setShowVariable === "function") {
      AppState.cogs.setShowVariable(varName, typedValue);
    }
  } catch (err) {
    const tel = document.getElementById("telemetry");
    if (tel) {
      tel.style.color = "#f87171";
      tel.textContent = "setShowVariable(" + varName + ") error: " + err.message;
    }
  }
}

function sendCogsState(payload) {
  const tel = document.getElementById("telemetry");
  if (!AppState.cogs || !AppState.isConnected) {
    if (tel) {
      tel.textContent = "Local clock: " + payload.dateISO + " | " + payload.dayOfWeek + " | timeHHMM=" + payload.timeHHMM + " (Not connected)";
    }
    return;
  }
  try {
    if (typeof AppState.cogs.setState === "function") {
      AppState.cogs.setState(payload);
    } else if (typeof AppState.cogs.sendState === "function") {
      AppState.cogs.sendState(payload);
    }
    if (tel) {
      tel.style.color = "#60a5fa";
      tel.textContent = "Sent setState -> dateISO=" + payload.dateISO + " | " + payload.dayOfWeek + " | timeHHMM=" + payload.timeHHMM + " | activeCount=" + payload.activeCount;
    }
  } catch (err) {
    if (tel) {
      tel.style.color = "#f87171";
      tel.textContent = "setState error: " + err.message;
    }
  }
}

function sendCogsEvent(name, value) {
  if (AppState.cogs && AppState.isConnected && typeof AppState.cogs.sendEvent === "function") {
    try {
      AppState.cogs.sendEvent(name, value);
    } catch (e) {}
  }
}

function tick() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const dayOfMonth = now.getDate();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const dayName = JS_DAY_NAMES.at(now.getDay());
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  const dateISO = year + "-" + pad(month) + "-" + pad(dayOfMonth);
  const timeStr = pad(hours) + ":" + pad(minutes);
  const nowMinutes = hours * 60 + minutes;

  const currentActiveRules = AppState.store.schedules.filter(function (r) {
    return isRuleActiveNow(r, dateISO, dayName, nowMinutes);
  });
  const nextIds = new Set(currentActiveRules.map(function (r) { return r.id; }));
  const activeNames = currentActiveRules.map(function (r) { return r.name.trim(); }).filter(Boolean);
  const activeFormatted = activeNames.map(function (n) { return "|" + n + "|"; }).join("");

  sendCogsState({
    activeSchedules: activeFormatted,
    activeCount: currentActiveRules.length,
    timeHHMM: hours * 100 + minutes,
    minutesSinceMidnight: nowMinutes,
    dayOfWeek: dayName,
    isWeekend: isWeekend,
    month: month,
    dayOfMonth: dayOfMonth,
    dateISO: dateISO
  });

  const minuteKey = dateISO + " " + timeStr;
  if (minuteKey !== AppState.lastMinuteKey) {
    AppState.lastMinuteKey = minuteKey;
    sendCogsEvent("clockStrikes", timeStr);
  }

  let uiChanged =
    nextIds.size !== AppState.activeIds.size ||
    Array.from(nextIds).some(function (id) { return !AppState.activeIds.has(id); });

  if (!AppState.hasInitialized) {
    AppState.hasInitialized = true;
    AppState.activeIds = nextIds;
    for (const rule of currentActiveRules) {
      if (rule.autoRecover) {
        if (rule.name) sendCogsEvent("scheduleStarted", rule.name.trim());
        applyShowVariable(rule.targetVariable, rule.activeValue);
      }
    }
    if (typeof updateStatusBar === "function") updateStatusBar();
    if (uiChanged && typeof render === "function") render();
    return;
  }

Use code with caution.
for (const rule of AppState.store.schedules) {
const wasActive = AppState.activeIds.has(rule.id);
const isNowActive = nextIds.has(rule.id);
if (wasActive && !isNowActive) {
if (rule.name) sendCogsEvent("scheduleEnded", rule.name.trim());
if (rule.hasEndTime && rule.restoreOnEnd) {
applyShowVariable(rule.targetVariable, rule.inactiveValue);
}
}
}
for (const rule of AppState.store.schedules) {
const wasActive = AppState.activeIds.has(rule.id);
const isNowActive = nextIds.has(rule.id);
if (!wasActive && isNowActive) {
if (rule.name) sendCogsEvent("scheduleStarted", rule.name.trim());
applyShowVariable(rule.targetVariable, rule.activeValue);
}
}
AppState.activeIds = nextIds;
if (uiChanged) {
if (typeof updateStatusBar === "function") updateStatusBar();
if (typeof render === "function") render();
}
}
function initCogs() {
const tel = document.getElementById("telemetry");
if (typeof window.COGS === "undefined") {
document.getElementById("conn-pill").textContent = "Standalone (cogs-client.js missing)";
if (tel) tel.textContent = "Error: window.COGS is undefined - check cogs-client.js";
return;
}
try {
const CogsConnection = window.COGS.CogsConnection;
const conn = new CogsConnection(INLINE_MANIFEST);
AppState.cogs = conn;
conn.addEventListener("open", function () {
AppState.isConnected = true;
AppState.hasInitialized = false;
if (conn.showVariables) {
AppState.showVariables = conn.showVariables;
}
const pill = document.getElementById("conn-pill");
pill.textContent = "Connected to COGS";
pill.classList.add("ok");
tick();
if (typeof render === "function") render();
});
conn.addEventListener("showVariables", function () {
if (conn.showVariables) {
AppState.showVariables = conn.showVariables;
}
for (const rule of AppState.store.schedules) {
if (AppState.activeIds.has(rule.id) && rule.autoRecover) {
applyShowVariable(rule.targetVariable, rule.activeValue);
}
}
if (typeof render === "function") render();
});
conn.addEventListener("close", function () {
AppState.isConnected = false;
const pill = document.getElementById("conn-pill");
pill.textContent = "Disconnected";
pill.classList.remove("ok");
});
} catch (err) {
if (tel) {
tel.style.color = "#f87171";
tel.textContent = "CogsConnection init error: " + err.message;
}
}
}
