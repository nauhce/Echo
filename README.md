# Echo

Echo is a lightweight review tool for interactive HTML prototypes, product demos, and requirement drafts.

It runs as a small local web service. You import an HTML file or save a snapshot from a reachable URL, then share a review link with teammates on the same LAN or VPN. Reviewers can select UI elements, add comments, reply, mark comments resolved, and collaborate on requirement descriptions.

## Features

- Import standalone HTML files.
- Save local snapshots from reachable page URLs.
- Automatically archive page resources for modern Nuxt / Next / Vite-style pages when a plain HTML snapshot would likely lose styling.
- Share review links over LAN or VPN.
- Comment on specific page elements and regions.
- Reply to comments and mark them resolved or reopened.
- Add requirement descriptions for selected UI areas.
- Export annotated HTML snapshots with pins, comments, requirements, replies, filters, and Markdown-rendered notes.
- Use AI to complete requirement drafts when an OpenAI-compatible API key is configured.
- Configure requirement collaborators.
- Switch the interface between Chinese and English globally.
- Keep review data and imported documents on the host machine.

## Startup

Startup helpers are in:

```text
startup-methods/
```

Windows:

- `startup-methods/windows-echo.bat`: visible startup window, recommended for startup and troubleshooting.
- `startup-methods/windows-echo-hidden.vbs`: no-console startup for daily use.
- `startup-methods/windows-echo-stop.bat`: stop the service on port `5177`.

macOS:

- `startup-methods/macos-echo.command`: visible startup window, recommended for startup and troubleshooting.
- `startup-methods/macos-echo-stop.command`: stop the service on port `5177`.

On macOS, grant execute permission once after downloading or unzipping:

```sh
chmod +x startup-methods/macos-echo.command startup-methods/macos-echo-stop.command
```

After startup, open:

```text
http://localhost:5177
```

See [startup-methods/README.md](startup-methods/README.md) for detailed startup notes.

## Manual Run

If you prefer the terminal, no dependency install is required for normal startup:

```sh
node server.js
```

The default port is `5177`. You can override it:

```sh
PORT=3000 node server.js
```

On Windows PowerShell:

```powershell
$env:PORT=3000
node server.js
```

## Review Flow

1. Start Echo and open `http://localhost:5177`.
2. Import an HTML file or save a snapshot from a URL.
3. Open the generated review page.
4. Share a reachable LAN/VPN review link with teammates.
5. Reviewers enter their name, choose view/comment/requirement mode, and collaborate.
6. Keep the host service running while teammates are reviewing.

## URL Snapshots

Echo first saves the target page HTML. For simple pages, it keeps the snapshot lightweight and does not download extra resources. For resource-heavy modern pages, Echo detects framework and bundler signals such as Nuxt / Next paths, module preload links, hashed CSS/JS chunks, and utility-class-heavy layouts. When those signals are present, Echo downloads the page's required CSS, JavaScript, images, and fonts into a document-specific local resource folder.

This improves visual fidelity for imported competitor pages while avoiding unnecessary slowdown for simple HTML documents.

## Export

Review pages provide two export paths:

- Comment table export: CSV for comments and replies.
- Annotated HTML export: a browser-openable HTML file with comment pins, requirement pins, filters, replies, and Markdown-rendered notes.

If a document was imported with archived resources, the annotated HTML export automatically inlines those local resources as `data:` URLs. The exported file can then be opened directly without depending on the original Echo service or local `data/docs/` paths. Documents without archived resources keep the lighter export behavior.

## Data Storage

Runtime data is stored locally:

```text
data/store.json
data/docs/
```

These files are ignored by Git. Imported URL snapshots are saved under `data/docs/`, and archived URL resources are saved in document-specific `data/docs/*_assets/` folders.

## AI Settings

AI-assisted requirement generation uses the settings configured on the home page:

- OpenAI-compatible Base URL
- model name
- API key

The generated requirement language follows the current UI language.

Do not commit runtime data files or local configuration containing API keys. The default Git ignore rules exclude `data/store.json`, imported HTML snapshots, archived resources, build outputs, and packaged binaries.

## Troubleshooting

If teammates cannot open a review link:

- Make sure Echo is still running on the host machine.
- Share a LAN/VPN IP link, not `localhost`.
- Check that everyone is on the same LAN or VPN.
- Allow port `5177` through the host firewall.
- Stop any other process using port `5177`.

Use the stop helper in `startup-methods/` if the port is stuck.

## Build

The project includes a `pkg` build script:

```sh
npm run build
```

This creates platform executables under `bin/`. The resulting files are larger because they include a Node.js runtime.
