# Cage Notes: notes for Claude

Read README.md for the original features, data and install steps (it predates the 2026-10-24 redesign; this file is current). Start Claude Code in this folder so this file loads.

## What it is
Installable offline PWA for a warehouse sorter: type a suburb from a parcel sticker, get the cage. Plain HTML/CSS/JS, no build step, no backend. Called "Cage Notes" (renamed from Cage Finder 2026-10-24); the repo and URL keep the old name.

- Live: https://lyric28-bit.github.io/cage-finder/ (GitHub Pages, public repo Lyric28-bit/cage-finder, branch main).
- Status (2026-10-24): sw.js VERSION v10 (note-style search, Lyric prefers it; photo thumbnails kept while searching).

## Layout (2026-10-24 redesign)
- One main screen styled like a plain notes app: "Notes" header, `⋯` menu (Export / Import / Reset to sheet data), "Search notes" box.
- With the search empty, the cage list shows as a note under it (js/manage.js renders into `#manage-root`): one line per cage (colour dot, name, count, suburb preview) plus a collapsible Local line. Tap a line to edit inline (rename, colour, add/remove suburbs, delete, photo buttons). There is no separate Manage page any more.
- Search (v9): typing swaps the full note for a filtered copy of it in `#note-results` (renderSuggestions in app.js): same "Cages" heading and cage lines, each matching suburb listed under its cage (or Local) with the typed letters in a `<mark>`, best-matching cage first, top 30 matches. A suburb on two cages appears under both. Enter opens the best match (first `.suggestion`). Typo and Pt/Mt matches show without a highlight. Cages with a sheet photo keep their thumbnail on the cage line while searching (v10); there a tap opens the viewer instead of the picker. Previous suggestion-list look: tag `v4-view-photo`.
- Result: the cage name in a thick block of its colour on the page, "on 2 lists" bar for multi-cage suburbs, "Done" returns to search.
- Look-alike warning (`similarPlaces` in js/match.js): the result lists other names 1 letter off, or 2 off when both are 6+ letters, that go to a different cage (e.g. Enfield LOCAL vs Penfield North Cartons). Worked out live from the device's data. Same-destination pairs and short names are skipped on purpose.
- Sheet photos (js/photos.js): each cage can have one photo of its printed sheet, stored **on the device only** in IndexedDB (`cage-notes-photos`, key = normalised cage name), shrunk to 2000px JPEG. 📷 button on each cage line; panel has View / Change / Remove photo; results show a thumbnail that opens a full-screen tap-to-zoom viewer. Rename moves the photo, delete removes it. Export/Import does not carry photos; each phone adds its own. Startup never waits on IndexedDB (some iOS versions stall).

## Data
- data/cages.json: 19 cages, 407 suburbs transcribed from the sheet photos, plus 6 local-region cages (City, North, North East, Port, Regency and South Cartons; 271 suburbs) estimated from the region map photos, edges unverified. `sheetVersion` at the top.
- data/adelaide-suburbs.json: 158 Adelaide metro suburbs (SA Gov list, postcodes 5000-5199, minus ones on a cage sheet). These show as LOCAL. Happy Valley is in both on purpose (Mildura's is a different place).
- Each device keeps its own copy in localStorage; edits don't sync. Export/Import in the `⋯` menu moves them.
- 2026-10-22: all 19 printed sheets (407 names) verified. Two blind re-reads matched the data, and Lyric hand-checked every name against the photos and the app. The Adelaide Hills "fold" is two taped pages, with no hidden row. The 6 Cartons region cages are still unverified.
- Open questions (Lyric asking his boss): Pinkerton Plains (on both Barossa and Kadina sheets); Aldinga/Seaford/McLaren Vale/Willunga (Victor Harbor sheet, but the South Cartons sign has SEAFORD crossed out with ALDINGA written in, and the South map covers them); Payneham (on the City/North East map line); a "WINGFIELD CARTONS" sign under the Regency map.
- Suburbs still LOCAL weren't inside any region map; Lyric moves them in-app (LOCAL result → Move to cage). Suburbs on the original sheets always stay on their sheet cage, even where a region map overlaps (e.g. Aldinga/Seaford/Willunga stay Victor Harbor). Wingfield is in Regency Cartons.

## Rules and quirks
- **Update this file with every push.** Lyric wants it always current: fold the CLAUDE.md update into the commit(s) being pushed.
- **Never commit or push sheets/** (workplace photos), or any photo. The site is public. It's gitignored and was stripped from main's history. Local branch `backup-with-photos` still has them: never push it, never push --all. Check `git ls-files sheets` is empty before pushing.
- Pushing: Claude can run `git push origin main` (credentials cached since 2026-10-24) but only after Lyric says yes for that push. If it ever asks for a login, Lyric runs it himself in a normal PowerShell window.
- Deploying a change: bump VERSION in sw.js (and add any new file to its FILES list). If cage data changes, also bump sheetVersion in data/cages.json. Installed apps show a "New version ready. Tap to update." button.
- Saves of known-good versions: git tags `v1-original` (pre-redesign), `v2-cage-notes`, `v3-photos`, `v4-view-photo` (v8, last version with the old suggestion-list search), `v5-note-search` (v10, confirmed on phone), plus matching folder copies on the Desktop (`Shipping-App-backup-2026-10-24`, `Shipping-App-v2-cage-notes-2026-10-24`, `Shipping-App-v3-photos-2026-10-24`, `Shipping-App-v4-view-photo-2026-10-24`, `Shipping-App-v5-note-search-2026-10-24`). Tags are local only.
- Lyric shares screenshots by saving with ShareX: read the newest file in C:\Users\Lyric\Documents\ShareX\Screenshots\<yyyy-mm>.
- Camera/OCR scanning was built and then removed at Lyric's request. Don't re-add unless asked. (Sheet photos are a different, manual feature.)
- A password lock was considered and dropped: it can't protect anything on a public static site.
- The file tools turn typed backslash-u escapes into real characters. If a file needs a literal `\u0300`-style escape, build the backslash with `[char]92` in PowerShell.
- No Python or Node on this PC. For scripts use PowerShell (Add-Type C# for anything heavy).

## Testing
- **Self-test every change before calling it done or offering to push.** Lyric wants this every time. At minimum: tests.html (all pass) and a full tests-ui.html run (0 problems), driven in Chrome by Claude, plus a targeted check of whatever changed (screenshot or JS check at phone width). If a test fails, find the cause from evidence and fix it before reporting; say what failed and what fixed it. If the change alters what the tests look for, update tests-ui.html in the same job. Report what was tested and what couldn't be (real phone picker, camera, pinch zoom, Firefox).
- Server: `powershell -ExecutionPolicy Bypass -File serve.ps1` (http://localhost:8080). It also serves sheets/ locally, which tests can fetch.
- tests.html: matcher unit tests, 23/23 should pass.
- tests-ui.html: drives the real app in a 390px frame. Searches every suburb (834) from test-data/ and checks it is listed under the right cage group(s) in the filtered note, then the result, colour, warnings, layout and Done, and opens every cage line in the note. Swaps in the test data and restores the browser's own data afterwards. tests-ui.html and test-data/ are excluded from git locally (.git/info/exclude).
- Claude in Chrome is connected: Claude can run both test pages itself. Clear the service worker and caches first or Chrome serves the old version. The extension's typing doesn't reach the search box, so drive it from javascript_tool (set the value, dispatch `input`, click `.suggestion`). Stub `window.confirm = () => true` before delete/remove clicks, or the dialog blocks the extension. Remove any test photos afterwards.
- Lyric tests by hand in Firefox and on his phone. Chrome can't test the real phone file picker, camera or pinch zoom.
