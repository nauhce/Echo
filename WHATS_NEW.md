# What's New

## 2026-07-02

- Added annotated HTML export. Review pages can now export a standalone HTML snapshot with pins, comments, requirements, replies, filters, and Markdown rendering in the side panel.
- Improved exported highlight positioning by resolving saved element selectors in the exported document before falling back to saved coordinates.
- Added smarter URL snapshot handling for modern websites. Echo now detects Nuxt / Next / Vite-style resource-heavy pages and archives required CSS, JavaScript, images, and fonts only when needed.
- Added URL import loading feedback so users can see that Echo is importing the page and downloading resources.
- Added single-file export support for archived pages. When a document has downloaded resources, the annotated HTML export automatically inlines local resources as `data:` URLs; simple documents keep the previous lightweight export path.
- Added cleanup for archived resource folders when a document is deleted.
- Added Git ignore coverage for archived URL resources under `data/docs/*_assets/`.
- Added global Chinese / English internationalization. The language switch is available on the home page, and review pages follow the saved language.
- Replaced the native browser file picker display with a custom localized file picker so upload labels do not leak the browser or operating system language.
- Added Windows and macOS startup helpers under `startup-methods/` with English filenames.
- Added bilingual documentation: `README.md`, `README.zh-CN.md`, `startup-methods/README.md`, and `startup-methods/README.zh-CN.md`.
- Renamed `产品说明.html` to `product-overview.html`.
- Updated AI requirement generation so generated requirements follow the selected UI language.

Note: The requirement-document module is not complete yet. It has the first backend and UI path in place, but still needs end-to-end AI testing, permission-flow validation, and UX refinement.
