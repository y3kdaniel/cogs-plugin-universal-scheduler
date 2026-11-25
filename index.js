const fs = require("fs");
const path = require("path");
const http = require("http");
const { CogsConnection } = require("@clockworkdog/cogs-client");
const manifest = require("./cogs-plugin-manifest.json");

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DATA_FILE = path.join(__dirname, "schedules.json");
const UI_PORT = 18945;

const cogs = new CogsConnection(manifest);

let activeIds = new Set();
let hasInitialized = false;
let hasAppliedStartupVariables = false;
let lastMinuteKey = "";

const DEFAULT_DATA = {
  settings: {
    resetOverridesOnStartup: true
  },
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

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (Array.isArray(parsed)) {
        return {
          settings: { resetOverridesOnStartup: true },
          schedules: parsed.map(normalizeSchedule)
        };
      }
      return {
        settings: {
          resetOverridesOnStartup:
            parsed.settings && typeof parsed.settings.resetOverridesOnStartup === "boolean"
              ? parsed.settings.resetOverridesOnStartup
              : true
        },
        schedules: Array.isArray(parsed.schedules)
          ? parsed.schedules.map(normalizeSchedule)
          : []
      };
    }
  } catch (err) {
    console.error("Failed to read schedules.json:", err);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function normalizeSchedule(s) {
  return {
    id: s.id || "sched-" + Date.now(),
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
    activeValue: s.activeValue !== undefined ? s.activeValue : "",
    restoreOnEnd: s.restoreOnEnd !== false,
    inactiveValue: s.inactiveValue !== undefined ? s.inactiveValue : ""
  };
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

let store = loadData();

if (store.settings.resetOverridesOnStartup) {
  let changed = false;
  for (const s of store.schedules) {
    if (s.override && s.override !== "auto") {
      s.override = "auto";
      changed = true;
    }
  }
  if (changed) saveData();
}

function coerceValueForVariable(varName, rawValue) {
  const varDef = cogs.showVariables && cogs.showVariables[varName];
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

function applyVariable(varName, rawValue) {
  if (!varName || rawValue === undefined || rawValue === "") return;
  try {
    const typedValue = coerceValueForVariable(varName, rawValue);
    cogs.setShowVariable(varName, typedValue);
  } catch (err) {
    console.error(`Failed to set Show Variable "${varName}":`, err);
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === "/api/state" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        settings: store.settings,
        schedules: store.schedules,
        activeIds: Array.from(activeIds),
        showVariables: cogs.showVariables || {}
      })
    );
  }

  if (req.url === "/api/save" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        if (payload.settings) {
          store.settings = {
            ...store.settings,
            ...payload.settings
          };
        }
        if (Array.isArray(payload.schedules)) {
          store.schedules = payload.schedules.map(normalizeSchedule);
        }
        saveData();
        tick();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(UI_PORT, "127.0.0.1");

function pad(n) {
  return String(n).padStart(2, "0");
}

function parseTimeToMinutes(hhmm) {
  if (!hhmm || !hhmm.includes(":")) return -1;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isWithinWindow(nowMinutes, startMinutes, hasEndTime, endMinutes) {
  if (startMinutes < 0) return false;
  if (!hasEndTime) {
    return nowMinutes === startMinutes;
  }
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
  if (rule.mode === "days") {
    return Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.includes(dayName);
  }
  if (rule.mode === "dates") {
    return Array.isArray(rule.dates) && rule.dates.includes(dateISO);
  }
  return false;
}

function tick() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const dayOfMonth = now.getDate();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const dayName = DAYS[now.getDay()];
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  const dateISO = `${year}-${pad(month)}-${pad(dayOfMonth)}`;
  const timeStr = `${pad(hours)}:${pad(minutes)}`;
  const nowMinutes = hours * 60 + minutes;

  const currentActiveRules = store.schedules.filter((r) =>
    isRuleActiveNow(r, dateISO, dayName, nowMinutes)
  );
  const nextIds = new Set(currentActiveRules.map((r) => r.id));

  const activeNames = currentActiveRules.map((r) => r.name.trim()).filter(Boolean);
  const activeFormatted = activeNames.map((n) => `|${n}|`).join("");

  cogs.setState({
    activeSchedules: activeFormatted,
    activeCount: currentActiveRules.length,
    timeHHMM: hours * 100 + minutes,
    minutesSinceMidnight: nowMinutes,
    dayOfWeek: dayName,
    isWeekend,
    month,
    dayOfMonth,
    dateISO
  });

  const minuteKey = `${dateISO} ${timeStr}`;
  if (minuteKey !== lastMinuteKey) {
    lastMinuteKey = minuteKey;
    cogs.sendEvent("clockStrikes", timeStr);
  }

  if (!hasInitialized) {
    hasInitialized = true;
    activeIds = nextIds;

    for (const rule of currentActiveRules) {
      if (rule.autoRecover) {
        if (rule.name) cogs.sendEvent("scheduleStarted", rule.name.trim());
        applyVariable(rule.targetVariable, rule.activeValue);
      }
    }
    return;
  }

  for (const rule of store.schedules) {
    const wasActive = activeIds.has(rule.id);
    const isNowActive = nextIds.has(rule.id);

    if (wasActive && !isNowActive) {
      if (rule.name) cogs.sendEvent("scheduleEnded", rule.name.trim());
      if (rule.hasEndTime && rule.restoreOnEnd) {
        applyVariable(rule.targetVariable, rule.inactiveValue);
      }
    }
  }

  for (const rule of store.schedules) {
    const wasActive = activeIds.has(rule.id);
    const isNowActive = nextIds.has(rule.id);

    if (!wasActive && isNowActive) {
      if (rule.name) cogs.sendEvent("scheduleStarted", rule.name.trim());
      applyVariable(rule.targetVariable, rule.activeValue);
    }
  }

  activeIds = nextIds;
}

cogs.addEventListener("open", () => {
  hasInitialized = false;
  hasAppliedStartupVariables = false;
  tick();
});

cogs.addEventListener("showVariables", () => {
  if (hasInitialized && !hasAppliedStartupVariables) {
    hasAppliedStartupVariables = true;
    for (const rule of store.schedules) {
      if (activeIds.has(rule.id) && rule.autoRecover) {
        applyVariable(rule.targetVariable, rule.activeValue);
      }
    }
  }
});

setInterval(tick, 1000);
