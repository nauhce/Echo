# What's New

## 2026-07-02

- Added global Chinese / English internationalization. The language switch is available on the home page, and review pages follow the saved language.
- Replaced the native browser file picker display with a custom localized file picker so upload labels do not leak the browser or operating system language.
- Added Windows and macOS startup helpers under `startup-methods/` with English filenames.
- Added bilingual documentation: `README.md`, `README.zh-CN.md`, `startup-methods/README.md`, and `startup-methods/README.zh-CN.md`.
- Renamed `产品说明.html` to `product-overview.html`.
- Updated AI requirement generation so generated requirements follow the selected UI language.

Note: The requirement-document module is not complete yet. It has the first backend and UI path in place, but still needs end-to-end AI testing, permission-flow validation, and UX refinement.
