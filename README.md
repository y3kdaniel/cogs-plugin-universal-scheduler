# Universal Scheduler Plugin for COGS

A visual scheduling and time/date automation plugin for [Clockwork Dog COGS](https://cogs.show) designed for multi-date attractions, seasonal events, and daily show automation.

## Features
* **Visual Admin UI inside COGS:** Native date pickers, day-of-week toggles, and start/end time selectors.
* **Bulk Date Range & Show Variable Automation:** Quickly filter date ranges and trigger show variable updates (`targetVariable` and `targetValue`) dynamically.
* **Flexible Trigger Modes:** Use start/end time windows or uncheck the end time for single-minute one-shot triggers.
* **Power-Loss Recovery & Manual Overrides:** Per-schedule recovery options for PC reboots, plus **Auto / Force ON / Force OFF** safety toggles and live date/time state exposure.
* **Import / Export JSON:** Backup and clone schedule profiles across show machines.

## Folder Structure & Installation

```text
cogs-plugin-universal-scheduler/
├── cogs-client.js
├── cogs-plugin-manifest.json
├── index.html
├── LICENSE
└── README.md
```

1. **Locate plugins folder:** Place the folder into your COGS `plugins` directory (`%APPDATA%\cogs\plugins` on Windows or `~/Library/Application Support/cogs/plugins` on macOS).
2. **Add browser client:** Download or install `@clockworkdog/cogs-client` into the plugin root as `cogs-client.js` for offline operation.
3. **Configure:** Restart COGS and open **Plugins → Universal Scheduler**.

## COGS Behaviour Setup & Exposed States

Add a lightweight Behaviour in your COGS project to map `Universal Scheduler` state changes (`targetValue` / `targetVariable`) to your COGS Show Variables. 

* **Exposed States:** `activeSchedules`, `activeCount`, `targetVariable`, `targetValue`, `dateISO`, `dayOfWeek`, `isWeekend`, `timeHHMM`, `minutesSinceMidnight`.
* **Exposed Events:** `scheduleStarted`, `scheduleEnded`, `clockStrikes`.

## Power-Loss Recovery Checklist
1. Enable **Power On** after AC/power loss in your PC's BIOS/UEFI.
2. Set up OS auto-login and launch COGS on startup, enabling **Auto-start Show** in COGS settings.
3. Check **Auto-recover after power loss** on critical schedules.

## License
MIT
