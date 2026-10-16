# Cage Finder

Look up a suburb from a parcel sticker and get the cage it goes to. Type it, or scan the sticker with the camera. Works offline once installed.

- **Search**: type a few letters. Case, spaces and punctuation don't matter, small typos are forgiven, and `Pt`/`Mt` match `Port`/`Mount`.
- **Scan sticker**: point the camera at the sticker, fit the suburb name in the box, tap **Read**. A confident match goes straight to the result. If unsure, it shows up to 3 options to tap. If it can't read anything, type instead.
- **Result**: the cage name, huge, on the cage colour. If a suburb is on more than one list (e.g. Pinkerton Plains: Barossa and Kadina) you get a yellow warning and every cage.
- **LOCAL**: Adelaide metro suburbs that aren't on any cage sheet show as **LOCAL** with their postcode. Tap **Move to cage** once you know the real cage (you can create a new cage right there).
- **Not found**: tap **Add to a cage**.
- **Manage**: add, rename, recolour and delete cages and suburbs, browse the Local list, and **Export / Import / Reset**.

## Where the data comes from

| File | What |
|---|---|
| `data/cages.json` | Transcribed from the photos in `sheets/` (19 cages, 407 suburbs). |
| `data/adelaide-suburbs.json` | SA Government suburb list ([data.sa.gov.au](https://data.sa.gov.au/data/dataset/suburb-boundaries), CC-BY 4.0), postcodes 5000-5199, minus suburbs already on a cage sheet. Happy Valley 5159 is kept on purpose: the Mildura sheet's Happy Valley is a different place. |

These files are only the starting point. Each device saves its own copy (in the browser's storage) the first time it runs, and every edit you make goes there. **Edits on your phone don't appear on the tablet by themselves**: use Export on one, then Import on the other.

## Moving data between phone and tablet

1. On the device with the changes: **Manage → Export**. A file like `cage-finder-2026-10-16.json` is saved (Downloads on Android, Files app on iPhone).
2. Get the file to the other device (email it to yourself, Google Drive, USB, etc.).
3. On the other device: **Manage → Import**, pick the file, confirm. This replaces everything on that device.

## Deploy (free, HTTPS) with GitHub Pages

The camera only works over HTTPS, so the app has to be hosted. GitHub Pages is free for public repositories.

**Note:** a public repo means anyone can see the files, including the suburb lists and (if you leave them in) the sheet photos. The site URL is public too, though nobody will find it unless you share it.

1. Create a free account at <https://github.com> if you don't have one.
2. Click **+ → New repository**. Name it `cage-finder`, set it to **Public**, don't add a README. Click **Create repository**.
3. In PowerShell, in this folder:
   ```powershell
   git remote add origin https://github.com/<your-username>/cage-finder.git
   git push -u origin main
   ```
   Git will open a browser window to sign in the first time.
4. On GitHub, open the repo: **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, Branch to **main** and folder **/ (root)**, then **Save**.
5. Wait a minute or two, then refresh that page. It shows the address, something like `https://<your-username>.github.io/cage-finder/`.

### Publishing an update

1. Make the change, then open `sw.js` and bump `VERSION` (e.g. `'v1'` → `'v2'`). Without this, installed copies keep the old files.
2. `git commit -am "Describe the change"` then `git push`.
3. On each device, open the app, close it fully, and open it again to pick up the new version.

Changing `data/cages.json` and redeploying does **not** change devices that already have saved data (that would wipe their edits). To push new sheet data to a device, use **Manage → Reset to sheet data** on it, or Export/Import.

## Install on a device

Open the site address once with internet, then:

- **Android phone or tablet (Chrome)**: menu **⋮ → Install app** (or **Add to Home screen**). It gets its own icon and opens full screen.
- **iPhone / iPad (Safari)**: tap **Share** (square with arrow) **→ Add to Home Screen → Add**. Use Safari for this.
- **Work tablet**: same as above for its browser. If install or the camera is blocked, the device is probably managed by work IT; typing search still works in the normal browser.

Then, **before relying on it offline**: open the installed app once with internet and tap **Scan sticker → Read** once. That makes sure the OCR files are downloaded. After that, test with flight mode on.

The first time you scan, the phone asks for camera permission: allow it. If you said no by accident, re-enable it in the browser's site settings (Android) or **Settings → Safari → Camera** (iPhone).

## Developing on this PC

No installs needed:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. Matcher tests: <http://localhost:8080/tests.html> (should end with `RESULT: 21/21 passed`).

The app caches itself, so after editing files: F12 → **Application → Storage → Clear site data**, then reload.

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css`, `app.js` | Screens: search, result, add/move dialog |
| `js/match.js` | Normalising, fuzzy search, OCR text matching |
| `js/store.js` | Saved data on the device |
| `js/manage.js` | Manage screen |
| `js/scan.js` | Camera + OCR |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline + install |
| `vendor/tesseract/` | Tesseract.js 5.1.1 + English model, so OCR works offline |
| `tests.html`, `serve.ps1` | Tests and local server |
| `sheets/` | Original sheet photos |
