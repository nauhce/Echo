# What's New

## 2026-07-01

- Renamed the Windows startup script from `start-reviewer.bat` to `Echo.bat` and removed the old Chinese startup wrapper.
- Redesigned the import console with a cleaner, minimal workspace-style UI.
- Added URL snapshot import so reachable pages can be saved locally as reviewable HTML.
- Added selectable share-link IPs under each document's copy-share menu for VPN/LAN scenarios.
- Added editable homepage hero copy, saved locally in the browser.
- Added AI and permission settings on the import console, including editor whitelist, OpenAI-compatible Base URL, model name, and API key storage.
- Added an early requirement-document mode on the review page with separate storage from regular comments.
- Added AI-generation plumbing for requirement descriptions based on selected element HTML and visible text.

Note: The requirement-document module is not complete yet. It has the first backend and UI path in place, but still needs end-to-end AI testing, permission-flow validation, and UX refinement.
