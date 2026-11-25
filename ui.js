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
  const el = document.getElementById("update-status");
  el.textContent = "Checking...";
  try {
    const res = await fetch("https://github.com/" + GITHUB_REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!res.ok) {
      el.textContent = "No releases published yet.";
      return;
    }
    const data = await res.json();
    const latest = (data.tag_name || "").replace(/^v/i, "");
    if (!latest || latest === PLUGIN_VERSION) {
      el.textContent = "Up to date!";
    } else {
      el.innerHTML = 'Update available: <a href="' + data.html_url + '" target="_blank">v' + latest + "</a>";
    }
  } catch (e) {
    el.textContent = "Offline / Local mode";
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

window.setOverride = function (idx, mode) {
  AppState.store.schedules[idx].override = mode;
  saveAll("Override updated!");
  render();
};

window.duplicateSchedule = function (idx) {
  const copy = normalizeSchedule(JSON.parse(JSON.stringify(AppState.store.schedules[idx])));
  copy.id = "sched-" + Date.now();
  copy.name = (copy.name || "Schedule") + " (Copy)";
  copy.override = "auto";
  AppState.store.schedules.splice(idx + 1, 0, copy);
  markDirty();
  render();
};

window.removeSchedule = function (idx) {
  AppState.store.schedules.splice(idx, 1);
  markDirty();
  render();
};

window.addDate = function (idx) {
  const picker = document.getElementById("date-picker-" + idx);
  if (!picker || !picker.value) return;
  if (!AppState.store.schedules[idx].dates.includes(picker.value)) {
    AppState.store.schedules[idx].dates.push(picker.value);
    AppState.store.schedules[idx].dates.sort();
  }
  picker.value = "";
  markDirty();
  render();
};

window.removeDate = function (idx, dateStr) {
  AppState.store.schedules[idx].dates = AppState.store.schedules[idx].dates.filter(function (d) {
    return d !== dateStr;
  });
  markDirty();
  render();
};

window.clearAllDates = function (idx) {
  AppState.store.schedules[idx].dates = [];
  markDirty();
  render();
};

window.toggleBulkHelper = function (id) {
  AppState.openBulkHelper[id] = !AppState.openBulkHelper[id];
  render();
};

window.addDateRange = function (idx) {
  const fromVal = document.getElementById("range-from-" + idx).value;
  const toVal = document.getElementById("range-to-" + idx).value;
  if (!fromVal || !toVal) return;

  const allowedDays = new Set();
  DAYS.forEach(function (day) {
    const cb = document.getElementById("range-day-" + idx + "-" + day);
    if (cb && cb.checked) allowedDays.add(day);
  });
  if (allowedDays.size === 0) return;

  const fParts = fromVal.split("-").map(Number);
  const tParts = toVal.split("-").map(Number);
  const start = new Date(Date.UTC(fParts.at(0), fParts.at(1) - 1, fParts.at(2)));
  const end = new Date(Date.UTC(tParts.at(0), tParts.at(1) - 1, tParts.at(2)));
  if (start > end) return;

  const existing = new Set(AppState.store.schedules[idx].dates);
  const cursor = new Date(start);
  let safety = 0;

  while (cursor <= end && safety < 730) {
    const dayName = JS_DAY_NAMES[cursor.getUTCDay()];
    if (allowedDays.has(dayName)) {
      existing.add(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety++;
  }

  AppState.store.schedules[idx].dates = Array.from(existing).sort();
  markDirty();
  render();
};

window.setRangePreset = function (idx, preset) {
  DAYS.forEach(function (day) {
    const cb = document.getElementById("range-day-" + idx + "-" + day);
    if (!cb) return;
    if (preset === "all") cb.checked = true;
    if (preset === "fri-sat") cb.checked = day === "Friday" || day === "Saturday";
    if (preset === "fri-sun") cb.checked = day === "Friday" || day === "Saturday" || day === "Sunday";
  });
};

window.toggleDay = function (idx, day) {
  const arr = AppState.store.schedules[idx].daysOfWeek;
  if (arr.includes(day)) {
    AppState.store.schedules[idx].daysOfWeek = arr.filter(function (d) { return d !== day; });
  } else {
    arr.push(day);
  }
  markDirty();
  render();
};

window.updateField = function (idx, field, val, rerender) {
  AppState.store.schedules[idx][field] = val;
  markDirty();
  if (rerender) render();
};

window.onSelectVariable = function (idx, varName) {
  AppState.store.schedules[idx].targetVariable = varName;
  AppState.store.schedules[idx].activeValue = "";
  AppState.store.schedules[idx].inactiveValue = "";
  markDirty();
  render();
};

function renderValueInput(idx, field, varName, currentVal) {
  const varDef = AppState.showVariables[varName];
  const safeVal = currentVal === undefined ? "" : String(currentVal);

  if (varDef && varDef.type === "option" && Array.isArray(varDef.options)) {
    let opts = '<option value="">-- Select --</option>';
    varDef.options.forEach(function (o) {
      const sel = safeVal === String(o) ? " selected" : "";
      opts += '<option value="' + o + '"' + sel + ">" + o + "</option>";
    });
    return '<select onchange="updateField(' + idx + ", '" + field + "', this.value)\">" + opts + "</select>";
  }

  if (varDef && varDef.type === "boolean") {
    return (
      '<select onchange="updateField(' + idx + ", '" + field + "', this.value)\">" +
      '<option value="">-- Select --</option>' +
      '<option value="true"' + (safeVal === "true" ? " selected" : "") + ">True</option>" +
      '<option value="false"' + (safeVal === "false" ? " selected" : "") + ">False</option>" +
      "</select>"
    );
  }

  return (
    '<input type="text" style="width:120px;" value="' + safeVal + '" placeholder="Value" ' +
    'oninput="updateField(' + idx + ", '" + field + "', this.value)\" />"
  );
}

function render() {
  const container = document.getElementById("list");
  container.innerHTML = "";
  const varNames = Object.keys(AppState.showVariables).sort();

  AppState.store.schedules.forEach(function (s, idx) {
    const isActive = AppState.activeIds.has(s.id);
    const ov = s.override || "auto";
    const isForced = ov !== "auto";
    const hasEnd = s.hasEndTime !== false;
    const bulkOpen = !!AppState.openBulkHelper[s.id];

    const card = document.createElement("div");
    card.className = "card" + (isForced ? " forced" : isActive ? " active-now" : "");

    let dateControls = "";
    if (s.mode === "dates") {
      const chips = s.dates
        .map(function (d) {
          return '<div class="chip">' + d + ' <span onclick="removeDate(' + idx + ", '" + d + "')\">×</span></div>";
        })
        .join("");

      const dayFilterPills = DAYS.map(function (day) {
        return '<label class="day-pill"><input type="checkbox" id="range-day-' + idx + "-" + day + '" checked /> ' + day.slice(0, 3) + "</label>";
      }).join("");

      const bulkPanel = bulkOpen
        ? '<div class="sub-panel" style="margin-bottom:8px;">' +
            '<div class="row" style="margin-bottom:8px;">' +
              '<label class="lbl">From</label>' +
              '<input type="date" id="range-from-' + idx + '" />' +
              '<label class="lbl">to</label>' +
              '<input type="date" id="range-to-' + idx + '" />' +
              '<button class="secondary" onclick="addDateRange(' + idx + ')">Add Matching Dates</button>' +
            "</div>" +
            '<div class="row" style="margin-bottom:0;">' +
              '<label class="lbl">Include:</label>' +
            dayFilterPills +
'<button class="ghost" onclick="setRangePreset(' + idx + ", 'all')">All" +
'<button class="ghost" onclick="setRangePreset(' + idx + ", 'fri-sat')">Fri–Sat" +
'<button class="ghost" onclick="setRangePreset(' + idx + ", 'fri-sun')">Fri–Sun" +
"" +
""
: "";
dateControls =
'' +
'' +
'+ Add Date' +
'<button class="ghost" onclick="toggleBulkHelper('' + s.id + "')">" +
(bulkOpen ? "Hide Date Range Helper" : "Bulk Add Date Range...") +
"" +
(s.dates.length > 0
? 'Clear All (' + s.dates.length + ")"
: "") +
"" +
bulkPanel +
'' + (chips || "No dates selected yet") + "";
} else if (s.mode === "days") {
const pills = DAYS.map(function (day) {
const checked = s.daysOfWeek.includes(day) ? " checked" : "";
return '<input type="checkbox"' + checked + ' onchange="toggleDay(' + idx + ", '" + day + "')" /> " + day.slice(0, 3) + "";
}).join("");
dateControls = '' + pills + "";
}
let varOptions = '(None — use events/states only)';
varNames.forEach(function (v) {
const sel = s.targetVariable === v ? " selected" : "";
varOptions += '<option value="' + v + '"' + sel + ">" + v + "";
});
const endVarControls = hasEnd && s.targetVariable
? '' +
'<input type="checkbox"' + (s.restoreOnEnd !== false ? " checked" : "") + ' onchange="updateField(' + idx + ", 'restoreOnEnd', this.checked, true)" />" +
" When Ended →" +
"" +
(s.restoreOnEnd !== false ? renderValueInput(idx, "inactiveValue", s.targetVariable, s.inactiveValue) : "")
: "";
const varInputs = s.targetVariable
? 'When Active →' +
renderValueInput(idx, "activeValue", s.targetVariable, s.activeValue) +
endVarControls
: "";
card.innerHTML =
'' +
'' +
'<input type="checkbox"' + (s.enabled ? " checked" : "") + ' onchange="updateField(' + idx + ", 'enabled', this.checked)" />" +
'<input type="text" value="' + s.name + '" placeholder="Schedule Name" oninput="updateField(' + idx + ", 'name', this.value)" />" +
(isActive ? 'Active Now' : "") +
(isForced ? '' + (ov === "force_on" ? "Forced ON" : "Forced OFF") + "" : "") +
"" +
'' +
'' +
'<button class="override-btn ' + (ov === "auto" ? "sel-auto" : "") + '" onclick="setOverride(' + idx + ", 'auto')">Auto" +
'<button class="override-btn ' + (ov === "force_on" ? "sel-on" : "") + '" onclick="setOverride(' + idx + ", 'force_on')">Force ON" +
'<button class="override-btn ' + (ov === "force_off" ? "sel-off" : "") + '" onclick="setOverride(' + idx + ", 'force_off')">Force OFF" +
"" +
'Duplicate' +
'Delete' +
"" +
"" +
'' +
'Runs:' +
'<select onchange="updateField(' + idx + ", 'mode', this.value, true)">" +
'<option value="dates"' + (s.mode === "dates" ? " selected" : "") + ">Specific Calendar Dates" +
'<option value="days"' + (s.mode === "days" ? " selected" : "") + ">Days of the Week" +
'<option value="daily"' + (s.mode === "daily" ? " selected" : "") + ">Every Day" +
"" +
'' + (hasEnd ? "From" : "At") + "" +
'<input type="time" value="' + s.startTime + '" onchange="updateField(' + idx + ", 'startTime', this.value)" />" +
'' +
'<input type="checkbox"' + (hasEnd ? " checked" : "") + ' onchange="updateField(' + idx + ", 'hasEndTime', this.checked, true)" />" +
" End Time:" +
"" +
(hasEnd ? '<input type="time" value="' + s.endTime + '" onchange="updateField(' + idx + ", 'endTime', this.value)" />" : "") +
'' +
'<input type="checkbox"' + (s.autoRecover !== false ? " checked" : "") + ' onchange="updateField(' + idx + ", 'autoRecover', this.checked)" />" +
" Auto-recover after power loss" +
"" +
"" +
dateControls +
'' +
'' +
'Set Show Variable:' +
'' + varOptions + "" +
varInputs +
"" +
"";
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
