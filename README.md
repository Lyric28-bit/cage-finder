# Cage Notes

Type the suburb from a parcel sticker and get the cage it goes to. Works offline once installed.

Live at <https://lyric28-bit.github.io/cage-finder/> (the repo keeps its old name, Cage Finder).

- **Search**: type a few letters. Case, spaces and punctuation don't matter, small typos are forgiven, and `Pt`/`Mt` match `Port`/`Mount`. Cage towns (Berri, Renmark...) find their own cage.
- **Result**: the cage name, huge, in a block of the cage colour. If a suburb is on more than one list (e.g. Pinkerton Plains: Barossa and Kadina) you get a yellow warning and every cage.
- **LOCAL**: Adelaide metro suburbs that aren't on any cage sheet show as **LOCAL** with their postcode. Tap **Move to cage** once you know the real cage (you can create a new cage right there).
- **Not found**: tap **Add to a cage**.
- **Look-alike warning**: if another name is a letter or two off and goes to a different cage (e.g. Enfield LOCAL vs Penfield North Cartons), the result lists it so you check the label.
- **The note**: with the search empty, the cage list shows under it like a note. Tap a cage to add, rename, recolour or delete cages and suburbs; Local is the last line. **Export / Import / Reset** are in the **⋯** menu.
- **Sheet photos**: tap 📷 on a cage line to add a photo of its printed sheet. Results from that cage show a thumbnail; tap it (or **View photo** in the cage) for full screen and tap to zoom. Photos stay on that device only: they are never uploaded and Export doesn't include them, so each phone adds its own.
- **Map**: **⋯ → Map** opens a street map of Adelaide you can pinch-zoom, with a suburb search that drops a pin. On Cartons results and in an opened Cartons cage, **Show on map** opens it zoomed to that suburb or cage, with the cage's region line drawn dashed. **Cage lines** shows all six Cartons lines in their colours, with roughly how close each is to the drawn map (±km). The lines are traced from the photos, so check the photo for anything near an edge. Street tiles need internet the first time; areas you've viewed are kept for offline.

## Where the data comes from

| File | What |
|---|---|
| `data/cages.json` | Transcribed from the sheet photos (19 cages, 407 suburbs), plus 6 Adelaide local-region cages (City, North, North East, Port, Regency and South Cartons: 271 suburbs) estimated from the warehouse region maps. The photos stay on this PC only. |
| `data/adelaide-suburbs.json` | SA Government suburb list ([data.sa.gov.au](https://data.sa.gov.au/data/dataset/suburb-boundaries), CC-BY 4.0), postcodes 5000-5199, minus suburbs already on a cage sheet. Happy Valley 5159 is kept on purpose: the Mildura sheet's Happy Valley is a different place. |
| `data/suburb-points.json` | A centre point for each of 465 Adelaide metro suburbs (postcodes 5000-5199), worked out from the SA Government suburb boundaries ([data.sa.gov.au](https://data.sa.gov.au/data/dataset/suburb-boundaries), CC BY 3.0 AU). Used by the map search. |
| `data/region-loops.json` | The Cartons region-map lines, traced from the photos and placed using the suburb names printed on each. Approximate. |
| Map tiles | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, shown with [Leaflet](https://leafletjs.com) (kept in `lib/leaflet/`). |

These files are only the starting point. Each device saves its own copy (in the browser's storage) the first time it runs, and every edit you make goes there. **Edits on your phone don't appear on the tablet by themselves**: use Export on one, then Import on the other.

## Moving data between phone and tablet

1. On the device with the changes: **⋯ → Export**. A file like `cage-finder-2026-10-16.json` is saved (Downloads on Android, Files app on iPhone).
2. Get the file to the other device (email it to yourself, Google Drive, USB, etc.).
3. On the other device: **⋯ → Import**, pick the file, confirm. This replaces everything on that device.

## Deploy (free, HTTPS) with GitHub Pages

Installing and offline mode need HTTPS, so the app has to be hosted. GitHub Pages is free for public repositories.

**Note:** a public repo means anyone can see the files, including the suburb lists. The sheet photos are never pushed (`sheets/` is gitignored). The site URL is public too, though nobody will find it unless you share it.

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
3. On each device, open the app and tap **New version ready. Tap to update.**

Changing `data/cages.json` and redeploying does **not** overwrite devices that already have saved data (that would wipe their edits). If you change it, also bump `"sheetVersion"` at the top of `data/cages.json` (e.g. `1` → `2`). Devices then show a yellow note saying new sheet data is available, and **⋯ → Reset to sheet data** applies it (Export first if you want to keep your own edits).

## Install on a device

Open the site address once with internet, then:

- **Android phone or tablet (Chrome)**: menu **⋮ → Install app** (or **Add to Home screen**). It gets its own icon and opens full screen.
- **iPhone / iPad (Safari)**: tap **Share** (square with arrow) **→ Add to Home Screen → Add**. Use Safari for this.
- **Work tablet**: same as above for its browser. If install is blocked, the device is probably managed by work IT; the app still works in the normal browser.

Then, **before relying on it offline**: open the installed app once with internet, then test with flight mode on.

## Developing on this PC

No installs needed:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. Matcher tests: <http://localhost:8080/tests.html> (every line PASS and a final `RESULT: n/n passed`).

The app caches itself, so after editing files: F12 → **Application → Storage → Clear site data**, then reload.

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css`, `app.js` | Main screen, result, add/move dialog, photo viewer |
| `js/match.js` | Normalising, fuzzy search, look-alike names |
| `js/store.js` | Saved data on the device |
| `js/manage.js` | The cage note and the ⋯ menu |
| `js/photos.js` | Sheet photos, stored on the device only (IndexedDB) |
| `js/map.js`, `lib/leaflet/` | Street map, suburb search, Cartons region lines |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline + install |
| `tests.html`, `serve.ps1` | Tests and local server |
| `sheets/` | Original sheet photos (local only, gitignored, never push) |
