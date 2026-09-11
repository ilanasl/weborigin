# Banner Studio (local)

A local tool to create website banners and Google-ad images.

- **Banners mode** — pick a template, fill in the text and image topic, and get a
  finished banner (desktop + mobile) to download as PNG / JPG / WebP.
- **Ad Images mode** — generate clean atmosphere images (no text) for Google ads,
  with positive/negative guidance and optional logo placement.

Images are generated with **Google Gemini**. Your API key stays on your machine
in `server/.env` and is used only by the local server — it is never sent to the
browser.

## One-time setup

1. Install [Node.js](https://nodejs.org) 18+.
2. In this `app/` folder, install dependencies:
   ```
   npm install
   ```
3. Add your Gemini API key (free — get one at https://aistudio.google.com/apikey):
   ```
   cp server/.env.example server/.env
   ```
   Then open `server/.env` and paste your key after `GEMINI_API_KEY=`.

## Run it

```
npm run dev
```

Then open the URL it prints (default http://localhost:5173).

The API server runs on http://localhost:8787; the web app proxies `/api` to it,
so you only need the one browser tab.

## Add your own banner templates

Templates live in `web/src/templates/`. Each template is one file describing the
sizes (desktop + mobile), layers (background, overlay, logo, text elements) and
the fields shown in the panel. To add one:

1. Copy `web/src/templates/promoHero.ts` to a new file.
2. Edit the sizes, elements and defaults.
3. Register it in `web/src/templates/index.ts`.

The data-entry panel is generated automatically from the template's fields.

## Fonts

The font picker offers free Google Fonts and loads them on demand. The chosen
font is embedded when a banner is exported so the PNG matches the preview.

## Notes

- **Exact size:** exported files match the template's pixel dimensions exactly.
- **Target weight:** for JPG/WebP you can set a target file size (KB); the
  exporter tunes compression quality to stay under it (useful for ad networks).
- **Logo placement in Ad Images:** the supplied logo is passed to the model as an
  input image. Placement accuracy varies — regenerate until it looks right.
