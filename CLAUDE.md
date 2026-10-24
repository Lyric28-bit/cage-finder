# Cage Finder: notes for Claude

Read README.md first (features, data, deploy, install). This file is the extra context.

## What it is
Installable offline PWA for a warehouse sorter: type a suburb from a parcel sticker, get the cage (big text on the cage colour). Plain HTML/CSS/JS, no build step, no backend.

- Live: https://lyric28-bit.github.io/cage-finder/ (GitHub Pages, public repo Lyric28-bit/cage-finder, branch main).
- Status (2026-10-16): working and installed on Lyric's phone, offline confirmed. sw.js VERSION is v3 (2026-10-17, local-region cages added).

## Data
- data/cages.json: 19 cages, 407 suburbs transcribed from the sheet photos, plus 6 local-region cages (City, North, North East, Port, Regency and South Cartons; 271 suburbs) estimated from the region map photos, edges unverified. `sheetVersion` at the top.
- data/adelaide-suburbs.json: 158 Adelaide metro suburbs (SA Gov list, postcodes 5000-5199, minus ones on a cage sheet). These show as LOCAL. Happy Valley is in both on purpose (Mildura's is a different place).
- Each device keeps its own copy in localStorage; edits don't sync. Export/Import in Manage moves them.
- 2026-10-22: all 19 printed sheets (407 names) verified. Two blind re-reads matched the data, and Lyric hand-checked every name against the photos and the app. The Adelaide Hills "fold" is two taped pages, with no hidden row. The 6 Cartons region cages are still unverified.
- Open questions (Lyric asking his boss): Pinkerton Plains (on both Barossa and Kadina sheets); Aldinga/Seaford/McLaren Vale/Willunga (Victor Harbor sheet, but the South Cartons sign has SEAFORD crossed out with ALDINGA written in, and the South map covers them); Payneham (on the City/North East map line); a "WINGFIELD CARTONS" sign under the Regency map.
- Suburbs still LOCAL weren't inside any region map; Lyric moves them in-app (LOCAL result → Move to cage). Suburbs on the original sheets always stay on their sheet cage, even where a region map overlaps (e.g. Aldinga/Seaford/Willunga stay Victor Harbor). Wingfield is in Regency Cartons.

## Rules and quirks
- **Never commit or push sheets/** (workplace photos). It's gitignored and was stripped from main's history. Local branch `backup-with-photos` still has them: never push it, never push --all.
- Lyric runs `git push` himself in a normal PowerShell window: `!` commands can't show the GitHub login.
- Deploying a change: bump VERSION in sw.js. If cage data changes, also bump sheetVersion in data/cages.json. Installed apps show a "New version ready. Tap to update." button.
- Testing: `powershell -ExecutionPolicy Bypass -File serve.ps1`, then Lyric opens http://localhost:8080 and /tests.html (17/17 should pass) in Firefox and reports back. Headless Edge commands were denied, so don't try.
- Lyric shares screenshots by saving with ShareX: read the newest file in C:\Users\Lyric\Documents\ShareX\Screenshots\<yyyy-mm>.
- Camera/OCR scanning was built and then removed at Lyric's request. Don't re-add unless asked.
- The file tools turn typed backslash-u escapes into real characters. If a file needs a literal `\u0300`-style escape, build the backslash with `[char]92` in PowerShell.
- Git for Windows was installed mid-session; if `git` isn't found, use `C:\Program Files\Git\cmd\git.exe` or open a new terminal.
