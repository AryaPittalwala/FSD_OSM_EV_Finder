# OSM Smart Explorer

A beginner-friendly web app that geocodes any city/landmark using the OpenStreetMap Nominatim API and shows the result on an interactive Leaflet map.

## How to Run

**Option A – VS Code Live Server (recommended)**
1. Open the `osm-smart-explorer/` folder in VS Code.
2. Install the "Live Server" extension (ritwickdey.liveserver).
3. Right-click `index.html` → **Open with Live Server**.

**Option B – Python HTTP server**
```bash
cd osm-smart-explorer
python -m http.server 8080
# Open http://localhost:8080
```

> ⚠️ Do **not** open `index.html` directly as a `file://` URL — Nominatim may block requests due to CORS.

## Features Implemented
| Requirement | Status |
|---|---|
| `input` event (char counter + live hint) | ✅ |
| `submit` event (validate + fetch + render) | ✅ |
| `click` event (clear/reset) | ✅ |
| Input validation (length, content, whitespace) | ✅ |
| Fetch with URLSearchParams + response.ok check | ✅ |
| JSON parsing + empty/error handling | ✅ |
| Leaflet map + OSM tiles + attribution | ✅ |
| Single reusable marker (no duplicates) | ✅ |
| Result panel (name, lat, lon, category) | ✅ |
| OSM external link | ✅ |
| Responsive layout | ✅ |
| Accessible labels + ARIA live regions | ✅ |

## API & Attribution
- Geocoding: [Nominatim](https://nominatim.openstreetmap.org/) — [Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- Tiles: [OpenStreetMap](https://www.openstreetmap.org/) — [Tile Policy](https://operations.osmfoundation.org/policies/tiles/)
- Map library: [Leaflet.js](https://leafletjs.com/) (BSD-2-Clause)

## Limitations
- No AI summary (no API key configured — placeholder omitted as per requirements).
- Rate-limited to form submissions only; no autocomplete.
- Public Nominatim is for low-volume demo use only.
