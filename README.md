# Universal Scheduler Plugin for COGS

A visual scheduling and time/date automation plugin for [Clockwork Dog COGS](https://cogs.show). Designed for multi-date attractions, seasonal events, and daily show automation with configurable power-loss recovery.

## Features
* **Visual Admin UI inside COGS:** Manage schedules with native date pickers, day-of-week toggles, and start/end time selectors—no config syntax required.
* **Bulk Date Range Helper:** Add date ranges filtered by specific days of the week (e.g., all Fridays–Sundays in October) in two clicks.
* **Direct Show Variable Control:** Automatically sets any COGS Show Variable (Option, Boolean, Number, or String) when a schedule starts and optionally reverts it when it ends.
* **One-Shot or Window Modes:** Use a start + end time window, or uncheck **End Time** for a single-minute one-shot trigger.
* **Per-Schedule Power-Loss Recovery:** Choose which schedules should automatically re-trigger if the PC reboots mid-show after a crash or power outage.
* **Manual Overrides & Safety Reset:** Test schedules anytime with **Auto / Force ON / Force OFF** toggles, plus a one-click reset and optional automatic reset on startup.
* **Live Date & Time States:** Exposes `dateISO`, `dayOfWeek`, `isWeekend`, `timeHHMM`, `minutesSinceMidnight`, `activeSchedules`, and `clockStrikes` for custom COGS behaviours.
* **Import / Export JSON:** Back up or clone schedule profiles across multiple show machines.

## Installation

1. Locate your COGS `plugins` directory:
   * **Windows:** `%APPDATA%\cogs\plugins`
   * **macOS:** `~/Library/Application Support/cogs/plugins`
2. Clone or copy this folder into `plugins/cogs-plugin-universal-scheduler`.
3. Open a terminal inside `cogs-plugin-universal-scheduler` and install dependencies:
   ```bash
   npm install
   ```
4. Restart COGS (or reload plugins) and open **Plugins → Universal Scheduler** to configure your schedules.

## Power-Loss Recovery Checklist
To ensure your attraction recovers automatically after an unexpected power outage:
1. Enable **Restore on AC/Power Loss → Power On** in your PC's BIOS/UEFI.
2. Configure Windows/macOS to auto-login and launch COGS on startup.
3. Enable **Auto-start Show** in your COGS project settings.
4. Keep **Auto-recover after power loss** checked on any schedule that should resume mid-window.

## License
MIT
