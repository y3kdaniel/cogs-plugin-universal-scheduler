function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (key) {
      const val = attrs[key];
      if (key === "className") {
        node.className = val;
      } else if (key === "text") {
        node.textContent = val;
      } else if (key === "checked" || key === "value" || key === "disabled") {
        node[key] = val;
      } else if (key.startsWith("on") && typeof val === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else {
        node.setAttribute(key, val);
      }
    });
  }
  if (Array.isArray(children)) {
    children.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (typeof child === "string") {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    });
  }
  return node;
}

function updateStatusBar(prefix) {
  const activeNames = AppState.store.schedules
    .filter(function (s) { return AppState.activeIds.has(s.id); })
    .map(function (s) { return s.name || "Unnamed"; });

  const msg = activeNames.length
    ? "Active right now: " + activeNames.join(", ")
    : "No schedule active right now";

  document.getElementById("status").textContent = prefix ? prefix + " " + msg : msg;

  const hasOverrides = AppState.store.schedules.some(function (s) {
    return s.override && s.override !== "auto";
  });
  document.getElementById("reset-overrides-btn").style.display = hasOverrides ? "inline-block" : "none";
}

function markDirty() {
  document.getElementById("status").textContent = "Unsaved changes — click Save Changes";
}

function saveAll(prefix) {
  persistStore();
  AppState.hasInitialized = false;
  tick();
  updateStatusBar(prefix || "Saved!");
}

async function checkForUpdates() {
  const statusEl = document.getElementById("update-status");
  statusEl.textContent = "Checking...";
  try {
    const res = await fetch("https://github.com" + GITHUB_REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!res.ok) {
      statusEl.textContent = "No releases published yet.";
      return;
    }
    const data = await res.json();
    const latest = (data.tag_name || "").replace(/^v/i, "");
    if (!latest || latest === PLUGIN_VERSION) {
      statusEl.textContent = "Up to date!";
    } else {
      statusEl.textContent = "";
      statusEl.appendChild(document.createTextNode("Update available: "));
      statusEl.appendChild(el("a", { href: data.html_url, target: "_blank", text: "v" + latest }));
    }
  } catch (e) {
    statusEl.textContent = "Offline / Local mode";
  }
}

function exportSchedules() {
  const payload = {
    pluginVersion: PLUGIN_VERSION,
    exportedAt: new Date().toISOString(),
    settings: AppState.store.settings,
    schedules: AppState.store.schedules
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cogs-schedules-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleImportFile(event) {
  const files = event.target.files;
  const file = files && files.length ? files.item(0) : null;
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const parsed = JSON.parse(e.target.result);
      const importedSchedules = Array.isArray(parsed) ? parsed : parsed.schedules;
      if (!Array.isArray(importedSchedules)) {
        alert("Invalid schedule JSON file: could not find a schedules list.");
        return;
      }
      if (parsed.settings && typeof parsed.settings === "object") {
        AppState.store.settings = Object.assign({}, AppState.store.settings, parsed.settings);
      }
      AppState.store.schedules = importedSchedules.map(normalizeSchedule);
      document.getElementById("reset-on-startup").checked = !!AppState.store.settings.resetOverridesOnStartup;
      saveAll("Imported " + AppState.store.schedules.length + " schedule(s)!");
      render();
    } catch (err) {
      alert("Failed to parse JSON file: " + err.message);
    }
  };
  reader.readAsText(file);
}

function setOverride(idx, mode) {
  AppState.store.schedules.at(idx).override = mode;
  saveAll("Override updated!");
  render();
}

function duplicateSchedule(idx) {
  const copy = normalizeSchedule(JSON.parse(JSON.stringify(AppState.store.schedules.at(idx))));
  copy.id = "sched-" + Date.now();
  copy.name = (copy.name || "Schedule") + " (Copy)";
  copy.override = "auto";
  AppState.store.schedules.splice(idx + 1, 0, copy);
  markDirty();
  render();
}

function removeSchedule(idx) {
  AppState.store.schedules.splice(idx, 1);
  markDirty();
  render();
}

function addDate(idx, pickerEl) {
  if (!pickerEl || !pickerEl.value) return;
  const sched = AppState.store.schedules.at(idx);
  if (!sched.dates.includes(pickerEl.value)) {
    sched.dates.push(pickerEl.value);
    sched.dates.sort();
  }
  pickerEl.value = "";
  markDirty();
  render();
}

function removeDate(idx, dateStr) {
  const sched = AppState.store.schedules.at(idx);
  sched.dates = sched.dates.filter(function (d) { return d !== dateStr; });
  markDirty();
  render();
}

function addDateRange(idx, fromEl, toEl, dayCheckboxes) {
  if (!fromEl.value || !toEl.value) return;
  const allowedDays = new Set();
  Object.keys(dayCheckboxes).forEach(function (day) {
    if (dayCheckboxes[day].checked) allowedDays.add(day);
  });
  if (allowedDays.size === 0) return;

  const fParts = fromEl.value.split("-").map(Number);
  const tParts = toEl.value.split("-").map(Number);
  const start = new Date(Date.UTC(fParts.at(0), fParts.at(1) - 1, fParts.at(2)));
  const end = new Date(Date.UTC(tParts.at(0), tParts.at(1) - 1, tParts.at(2)));
  if (start > end) return;

  const sched = AppState.store.schedules.at(idx);
  const existing = new Set(sched.dates);
  const cursor = new Date(start);
  let safety = 0;

  while (cursor <= end && safety < 730) {
    const dayName = JS_DAY_NAMES.at(cursor.getUTCDay());
    if (allowedDays.has(dayName)) {
      existing.add(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety++;
  }

  sched.dates = Array.from(existing).sort();
  markDirty();
  render();
}

function buildValueControl(idx, field, varName, currentVal) {
  const varDef = AppState.showVariables ? AppState.showVariables[varName] : null;
  const safeVal = currentVal === undefined ? "" : String(currentVal);

  if (varDef && varDef.type === "option" && Array.isArray(varDef.options)) {
    const opts = [el("option", { value: "", text: "-- Select --" })];
    varDef.options.forEach(function (o) {
      const opt = el("option", { value: String(o), text: String(o) });
      if (safeVal === String(o)) opt.selected = true;
      opts.push(opt);
    });
    return el("select", {
      onChange: function (e) {
        AppState.store.schedules.at(idx)[field] = e.target.value;
        markDirty();
      }
    }, opts);
  }

  if (varDef && varDef.type === "boolean") {
    const optEmpty = el("option", { value: "", text: "-- Select --" });
    const optTrue = el("option", { value: "true", text: "True" });
    const optFalse = el("option", { value: "false", text: "False" });
    if (safeVal === "true") optTrue.selected = true;
    if (safeVal === "false") optFalse.selected = true;
    return el("select", {
      onChange: function (e) {
        AppState.store.schedules.at(idx)[field] = e.target.value;
        markDirty();
      }
    }, [optEmpty, optTrue, optFalse]);
  }

  return el("input", {
    type: "text",
    style: "width:120px;",
    value: safeVal,
    placeholder: "Value",
    onInput: function (e) {
      AppState.store.schedules.at(idx)[field] = e.target.value;
      markDirty();
    }
  });
}

function render() {
  const container = document.getElementById("list");
  container.innerHTML = "";
  const varNames = AppState.showVariables ? Object.keys(AppState.showVariables).sort() : [];

  AppState.store.schedules.forEach(function (s, idx) {
    const isActive = AppState.activeIds.has(s.id);
    const ov = s.override || "auto";
    const isForced = ov !== "auto";
    const hasEnd = s.hasEndTime !== false;
    const bulkOpen = !!AppState.openBulkHelper[s.id];

    // Row 1: Header & Overrides
    const leftGroup = el("div", { className: "row", style: "margin:0;" }, [
      el("input", {
        type: "checkbox",
        checked: !!s.enabled,
        onChange: function (e) { s.enabled = e.target.checked; markDirty(); }
      }),
      el("input", {
        type: "text",
        value: s.name,
        placeholder: "Schedule Name",
        onInput: function (e) { s.name = e.target.value; markDirty(); }
      }),
      isActive ? el("span", { className: "badge", text: "Active Now" }) : null,
      isForced ? el("span", { className: "badge warn", text: ov === "force_on" ? "Forced ON" : "Forced OFF" }) : null
    ]);

    const overrideGroup = el("div", { className: "override-group", title: "Manual Override" }, [
      el("button", {
        className: "override-btn" + (ov === "auto" ? " sel-auto" : ""),
        text: "Auto",
        onClick: function () { setOverride(idx, "auto"); }
      }),
      el("button", {
        className: "override-btn" + (ov === "force_on" ? " sel-on" : ""),
        text: "Force ON",
        onClick: function () { setOverride(idx, "force_on"); }
      }),
      el("button", {
        className: "override-btn" + (ov === "force_off" ? " sel-off" : ""),
        text: "Force OFF",
        onClick: function () { setOverride(idx, "force_off"); }
      })
    ]);

    const rightGroup = el("div", { className: "row", style: "margin:0;" }, [
      overrideGroup,
el("button", { className: "ghost", text: "Duplicate", onClick: function () { duplicateSchedule(idx); } }),
el("button", { className: "danger", text: "Delete", onClick: function () { removeSchedule(idx); } })
]);
const headerRow = el("div", { className: "row", style: "justify-content:space-between;" }, [leftGroup, rightGroup]);
// Row 2: Mode, Times, & Power-Loss Recovery
const modeSelect = el("select", {
onChange: function (e) { s.mode = e.target.value; markDirty(); render(); }
}, [
el("option", { value: "dates", text: "Specific Calendar Dates" }),
el("option", { value: "days", text: "Days of the Week" }),
el("option", { value: "daily", text: "Every Day" })
]);
modeSelect.value = s.mode;
const timingRow = el("div", { className: "row" }, [
el("label", { className: "lbl", text: "Runs:" }),
modeSelect,
el("label", { className: "lbl", text: hasEnd ? "From" : "At" }),
el("input", {
type: "time",
value: s.startTime,
onChange: function (e) { s.startTime = e.target.value; markDirty(); }
}),
el("label", { className: "lbl", style: "cursor:pointer;" }, [
el("input", {
type: "checkbox",
checked: hasEnd,
onChange: function (e) { s.hasEndTime = e.target.checked; markDirty(); render(); }
}),
" End Time:"
]),
hasEnd ? el("input", {
type: "time",
value: s.endTime,
onChange: function (e) { s.endTime = e.target.value; markDirty(); }
}) : null,
el("label", {
className: "lbl",
style: "margin-left:8px; cursor:pointer;",
title: "If checked, re-triggers this schedule immediately if the PC reboots mid-window"
}, [
el("input", {
type: "checkbox",
checked: s.autoRecover !== false,
onChange: function (e) { s.autoRecover = e.target.checked; markDirty(); }
}),
" Auto-recover after power loss"
])
]);
// Row 3: Date or Day-of-Week Controls
const dateSection = el("div", {});
if (s.mode === "dates") {
const singlePicker = el("input", { type: "date" });
const actionRow = el("div", { className: "row", style: "margin-bottom:6px;" }, [
singlePicker,
el("button", {
className: "secondary",
text: "+ Add Date",
onClick: function () { addDate(idx, singlePicker); }
}),
el("button", {
className: "ghost",
text: bulkOpen ? "Hide Date Range Helper" : "Bulk Add Date Range...",
onClick: function () { AppState.openBulkHelper[s.id] = !bulkOpen; render(); }
}),
s.dates.length > 0 ? el("button", {
className: "ghost",
text: "Clear All (" + s.dates.length + ")",
onClick: function () { s.dates = []; markDirty(); render(); }
}) : null
]);
dateSection.appendChild(actionRow);
if (bulkOpen) {
const fromInput = el("input", { type: "date" });
const toInput = el("input", { type: "date" });
const dayCheckboxes = {};
const dayPills = DAYS.map(function (day) {
const cb = el("input", { type: "checkbox", checked: true });
dayCheckboxes[day] = cb;
return el("label", { className: "day-pill" }, [cb, " " + day.slice(0, 3)]);
});
const bulkPanel = el("div", { className: "sub-panel", style: "margin-bottom:8px;" }, [
el("div", { className: "row", style: "margin-bottom:8px;" }, [
el("label", { className: "lbl", text: "From" }),
fromInput,
el("label", { className: "lbl", text: "to" }),
toInput,
el("button", {
className: "secondary",
text: "Add Matching Dates",
onClick: function () { addDateRange(idx, fromInput, toInput, dayCheckboxes); }
})
]),
el("div", { className: "row", style: "margin-bottom:0;" }, [
el("label", { className: "lbl", text: "Include:" })
].concat(dayPills).concat([
el("button", {
className: "ghost",
text: "All",
onClick: function () { DAYS.forEach(function (d) { dayCheckboxes[d].checked = true; }); }
}),
el("button", {
className: "ghost",
text: "Fri–Sat",
onClick: function () { DAYS.forEach(function (d) { dayCheckboxes[d].checked = d === "Friday" || d === "Saturday"; }); }
}),
el("button", {
className: "ghost",
text: "Fri–Sun",
onClick: function () { DAYS.forEach(function (d) { dayCheckboxes[d].checked = d === "Friday" || d === "Saturday" || d === "Sunday"; }); }
})
]))
]);
dateSection.appendChild(bulkPanel);
}
const chipsDiv = el("div", { className: "chips" });
if (s.dates.length === 0) {
chipsDiv.appendChild(el("span", { style: "color:#6b7280;font-size:12px;", text: "No dates selected yet" }));
} else {
s.dates.forEach(function (d) {
chipsDiv.appendChild(el("div", { className: "chip" }, [
d + " ",
el("span", { text: "×", onClick: function () { removeDate(idx, d); } })
]));
});
}
dateSection.appendChild(chipsDiv);
} else if (s.mode === "days") {
const pills = DAYS.map(function (day) {
return el("label", { className: "day-pill" }, [
el("input", {
type: "checkbox",
checked: s.daysOfWeek.includes(day),
onChange: function () {
if (s.daysOfWeek.includes(day)) {
s.daysOfWeek = s.daysOfWeek.filter(function (d) { return d !== day; });
} else {
s.daysOfWeek.push(day);
}
markDirty();
render();
}
}),
" " + day.slice(0, 3)
]);
});
dateSection.appendChild(el("div", { className: "row" }, pills));
}
// Row 4: Target Show Variable Controls
const varRowChildren = [el("label", { className: "lbl", text: "Target Show Variable:" })];
if (varNames.length > 0) {
const varSelect = el("select", {
onChange: function (e) {
s.targetVariable = e.target.value;
s.activeValue = "";
s.inactiveValue = "";
markDirty();
render();
}
}, [el("option", { value: "", text: "(None — use events/states only)" })].concat(
varNames.map(function (v) { return el("option", { value: v, text: v }); })
));
varSelect.value = s.targetVariable;
varRowChildren.push(varSelect);
} else {
varRowChildren.push(el("input", {
type: "text",
style: "width:140px;",
value: s.targetVariable || "",
placeholder: "e.g. ShowMode",
onInput: function (e) {
const wasEmpty = !s.targetVariable;
s.targetVariable = e.target.value;
markDirty();
if (wasEmpty && s.targetVariable) render();
}
}));
}
if (s.targetVariable) {
varRowChildren.push(el("label", { className: "lbl", text: "When Active →" }));
varRowChildren.push(buildValueControl(idx, "activeValue", s.targetVariable, s.activeValue));
if (hasEnd) {
varRowChildren.push(el("label", { className: "lbl", style: "margin-left:6px;" }, [
el("input", {
type: "checkbox",
checked: s.restoreOnEnd !== false,
onChange: function (e) { s.restoreOnEnd = e.target.checked; markDirty(); render(); }
}),
" When Ended →"
]));
if (s.restoreOnEnd !== false) {
varRowChildren.push(buildValueControl(idx, "inactiveValue", s.targetVariable, s.inactiveValue));
}
}
}
const varBox = el("div", { className: "sub-panel" }, [
el("div", { className: "row", style: "margin:0;" }, varRowChildren)
]);
const card = el("div", {
className: "card" + (isForced ? " forced" : isActive ? " active-now" : "")
}, [headerRow, timingRow, dateSection, varBox]);
container.appendChild(card);
});
}
document.getElementById("reset-on-startup").checked = !!AppState.store.settings.resetOverridesOnStartup;
document.getElementById("reset-on-startup").addEventListener("change", function (e) {
AppState.store.settings.resetOverridesOnStartup = e.target.checked;
saveAll();
});
document.getElementById("reset-overrides-btn").addEventListener("click", function () {
AppState.store.schedules.forEach(function (s) { s.override = "auto"; });
saveAll("Overrides cleared!");
render();
});
document.getElementById("btn-updates").addEventListener("click", checkForUpdates);
document.getElementById("btn-export").addEventListener("click", exportSchedules);
document.getElementById("btn-import").addEventListener("click", function () {
const input = document.getElementById("import-file");
input.value = "";
input.click();
});
document.getElementById("import-file").addEventListener("change", handleImportFile);
document.getElementById("btn-add").addEventListener("click", function () {
AppState.store.schedules.push(normalizeSchedule({ name: "New Show", dates: [] }));
markDirty();
render();
});
document.getElementById("btn-save").addEventListener("click", function () {
saveAll();
});
initCogs();
tick();
render();
setInterval(tick, 1000);
