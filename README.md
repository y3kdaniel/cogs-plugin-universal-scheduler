# Universal Scheduler Plugin for COGS

A self-contained `README.md` template for the Universal Scheduler plugin for Clockwork Dog COGS.

## Features
* **Visual Admin UI:** Date pickers, day toggles, schedule duplication, and quick-copy triggers.
* **Bulk Date Range Helper:** Day-of-week presets for batch date additions.
* **Flexible Trigger Modes:** Time-window and one-shot trigger support.
* **Power-Loss & Show-Restart Recovery:** Automatic schedule re-firing on reboot with manual overrides (**Auto / Force ON / Force OFF**).
* **Import / Export JSON:** Profile backup and migration.

## Folder Structure & Installation
Place the plugin folder inside your COGS `plugins` directory, ensure the browser SDK (`cogs-client.js`) is present, enable the plugin in COGS, and launch the **Show Schedules** window.

## COGS Behaviour Setup & Exposed States
Reference schedule cards using copyable names for start/end events (`scheduleStarted`, `scheduleEnded`) and active window conditions (`activeSchedules`).

## Power-Loss & Show-Restart Recovery Checklist
1. Enable **Power On** after AC loss in the PC BIOS/UEFI.
2. Configure OS auto-login, launch COGS on startup, and enable **Auto-start Show**.
3. Keep **Auto-recover after power loss / show restart** enabled on critical schedules.

## License
MIT
