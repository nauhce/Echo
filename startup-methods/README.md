# Startup Methods

This folder contains local startup helpers for Echo.

## Windows

Use `windows-echo.bat` for startup. It opens a visible console, checks Node.js, then runs Echo.

Use `windows-echo-hidden.vbs` for daily startup. It starts Echo without a console window.

Use `windows-echo-stop.bat` to stop the Echo process listening on port `5177`.

The Windows `.bat` files intentionally use English-only text to avoid command prompt encoding issues on different Windows language settings.

## macOS

Use `macos-echo.command` for startup. It checks Node.js, then runs Echo.

Use `macos-echo-stop.command` to stop the Echo process listening on port `5177`.

After downloading or unzipping the project on macOS, run this once from the project root:

```sh
chmod +x startup-methods/macos-echo.command startup-methods/macos-echo-stop.command
```

## After Startup

Open:

```text
http://localhost:5177
```

If the browser does not open automatically, paste that address into the browser manually.

## Requirement

Windows and macOS users need Node.js installed. Echo does not require `npm install` for normal startup. Download Node.js from:

```text
https://nodejs.org/
```
