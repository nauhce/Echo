# Echo

Echo is a lightweight local review tool for interactive HTML prototypes and product requirement demos.

It lets you run a small web service on your own computer, import an HTML demo, and share a LAN review link with teammates. Reviewers can open the link in a browser, add comments to specific UI elements, reply to comments, and mark items as resolved.

## What It Does

- Runs locally on your machine.
- Shares review pages over your LAN or VPN.
- Imports standalone HTML demo files or saves HTML snapshots from reachable URLs.
- Lets reviewers annotate page elements and UI regions.
- Keeps comments synced for everyone using the same local service.
- Supports replies and resolved / reopened states.
- Hides annotation pins when the original element is no longer visible because of pagination, filtering, or collapsed content.
- Keeps all review data on your local machine.

## Current Notes

- The requirement-document mode is an early, unfinished module. Basic storage, permissions, and AI-generation plumbing are present, but the workflow still needs more testing and polish before it should be considered complete.

## Quick Start

On Windows:

1. Double-click `Echo.bat`.
2. The console page opens automatically at:

   ```text
   http://localhost:5177
   ```

3. Import an HTML file from the console, or paste a reachable page URL to save a snapshot.
4. Choose the share address that teammates can reach, then copy the review link shown in the console, for example:

   ```text
   http://192.168.x.x:5177/review/your-document
   ```

5. Send that link to teammates on the same LAN or VPN.
6. Keep the startup window open while the review is running.
7. Close the startup window, or double-click `停止评审助手.bat`, to stop the service.

## Reviewing a Demo

On the review page:

1. Click `开启批注` to enter annotation mode.
2. Click an element or region in the demo.
3. Add a comment and submit it.
4. Click an annotation pin to view comments at that location.
5. Click a comment card in the sidebar to locate and highlight the original area.
6. Use replies and resolved / reopened states to track decisions.

If a commented element is no longer visible because the demo content changed, the annotation pin is hidden while the sidebar record remains available.

## Data Storage

Review data is stored locally:

```text
data/store.json
```

Imported HTML copies are stored locally:

```text
data/docs/
```

URL imports save the fetched HTML in the same folder. A `<base>` tag is added when needed so relative images, styles, and scripts can still load from the original page URL.

These runtime files are ignored by Git by default.

## Troubleshooting

If teammates cannot open the review link, check:

- The startup window is still open.
- You sent the LAN IP link, not `localhost`.
- If VPN creates multiple IP addresses, choose the reachable address in the console before copying the review link.
- Everyone is on the same LAN or VPN.
- Windows Firewall allows access to port `5177`.
- Port `5177` is not already used by another process.

If the port is stuck, run:

```text
停止评审助手.bat
```

Then start the assistant again.

## Development

This project uses only built-in Node.js modules. No package installation is required.

Run it manually:

```powershell
node server.js
```

Then open:

```text
http://localhost:5177
```

## Repository Notes

The repository includes the app source, static UI, Windows helper scripts, and documentation.

Local review data, uploaded/imported HTML documents, and server logs are intentionally excluded from version control.
