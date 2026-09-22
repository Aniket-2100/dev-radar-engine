# Dev Radar Event Engine

A scheduled, source-backed event discovery runner for [Dev Radar](https://dev-radar.whozknowani2400.chatgpt.site).

## What it does

Every two hours, GitHub Actions asks Exa for upcoming technology opportunities in Delhi NCR and across India. It only sends a record to Dev Radar when the source explicitly supports the date, organizer, location and registration link. Duplicate protection and expiry are handled by Dev Radar.

The default `india` scan profile uses the Delhi NCR and India-wide lanes every two hours. A separate global workflow checks international programs, global hackathons, space technology, astronomy, aerospace and space-agency opportunities (including NASA, ESA and ISRO listings where eligibility allows) once daily. India scans cover the next 60 days; the daily global scan looks up to 180 days ahead because international programs are usually announced earlier. The optional `expanded` profile runs every lane together and should be used only after reviewing the increased Exa usage.

## Required repository secrets

Add these under **Settings → Secrets and variables → Actions**:

- `EXA_API_KEY` — an API key from the Exa dashboard.
- `DEV_RADAR_INGEST_URL` — `https://dev-radar.whozknowani2400.chatgpt.site/api/engine/ingest`
- `DEV_RADAR_INGEST_SECRET` — the matching private ingest secret from Dev Radar.

Optional repository variable:

- `DEV_RADAR_SCAN_SCOPE` — use `global` for the international-only lanes or `expanded` for every lane in one run; omit it for the India profile.

The workflow can also be run manually from the **Actions** tab after the secrets are set.

## Safety

The runner discards records missing an exact date, a legitimate source link, an official registration link, or required event facts. It never publishes a search result merely because it looks relevant.
