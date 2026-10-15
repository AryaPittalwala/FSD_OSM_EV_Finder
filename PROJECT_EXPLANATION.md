# EV Smart Explorer – Project Summary & Source Code Explanation

## 1. Project Overview
The EV Smart Explorer is an interactive web application that finds Electric Vehicle (EV) charging stations near any searched city, locality, or postal code. It displays results on a split-screen layout with an interactive map on the right and searchable station cards on the left.

- **Frontend:** Semantic HTML5, CSS3 (Glassmorphism & Electric Blue Theme), Vanilla JavaScript (ES6+).
- **Mapping Library:** Leaflet.js with OpenStreetMap tiles.
- **APIs Used:**
  1. **Nominatim API (OpenStreetMap):** Converts location names into geographic coordinates (Latitude & Longitude).
  2. **Open Charge Map API (v3.1):** Fetches real-time EV charging stations, connector power (kW), operators, and fees.

---

## 2. Requirements & Feature Mapping

| Requirement | Implementation Detail |
| :--- | :--- |
| **Form with Validation** | Requires min 3 chars, max 100 chars, alphanumeric check (`/[a-zA-Z0-9]/`). Displays error/info feedback. |
| **JS Event 1: `input`** | Live character counter (`0 / 100`) and real-time typing guidance. |
| **JS Event 2: `submit`** | Prevents page reload, runs validation, geocodes via Nominatim, and queries Open Charge Map. |
| **JS Event 3: `click` / Keyboard** | Clears state and resets map; card clicks zoom the map to the selected station with a popup and toast. |
| **JS Event 4: `change`** | Instant client-side power filter (High, Medium, Low, No Spec) using cached data without extra API calls. |
| **Fetch API & JSON Handling** | Async/await fetch with `AbortController` timeouts; parses JSON data structures (`AddressInfo`, `Connections`, `OperatorInfo`). |
| **Travel Time (ETA) & Alerts** | Estimates driving time (~28 km/h city model). Features a **Nearest Station Alert Banner**, card ETA badges (`🚗 ~X mins`), and a **floating map alert toast**. |

---

## 3. Source Code Explanation

### 3.1 Structure (`index.html`)
- **Header (`.navbar`):** Electric blue translucent bar with logo, title, and live status badge.
- **Left Sidebar (`.sidebar`):**
  - Search input with clear button and live character counter.
  - Dropdown filters for **Power Range** (`#power-select`) and **Search Radius** (`#radius-select`).
  - **Nearest EV Station Alert Banner** (`#nearest-eta-alert`): Highlights the closest charger and its ETA.
  - Station list (`#stations-list`) to render EV station cards.
- **Right Map (`.map-viewport`):**
  - Leaflet map container (`#map`) filling the entire right screen.
  - Floating station ETA alert toast (`#floating-eta-toast`).

### 3.2 Logic & Workflow (`app.js`)
1. **Map Setup:** Initializes Leaflet centered on coordinates `[20.5937, 78.9629]` (zoom 5) with custom rotating lightning bolt pins (`⚡`).
2. **Geocoding Step:** Calls `https://nominatim.openstreetmap.org/search` to convert query into `lat` and `lon`.
3. **EV Fetching Step:** Calls `https://api.openchargemap.io/v3/poi/` with `latitude`, `longitude`, `distance`, `maxresults=30`, and user API key.
4. **Client-Side Power Filtering:** Reads connection ratings to categorize stations:
   - **High Power:** $\ge$ 50 kW (Fast DC)
   - **Medium Power:** 20 kW to 49 kW (Fast AC / Standard DC)
   - **Low Power:** < 20 kW (Standard AC)
   - **No Power Specified:** Unlisted wattage
5. **Distance & ETA Calculation:** Calculates distance via the Haversine formula and derives driving time:
   $$\text{Travel Time (mins)} = \max\left(1, \text{round}\left(\frac{\text{Distance in km}}{28} \times 60\right)\right)$$
6. **Card & Map Rendering:**
   - Adds station markers to the map.
   - Shows the top **Nearest Station Alert Banner**.
   - Generates station cards with operator pills, color-coded power tier badges, operational status dots, travel times, and distances.
   - Clicking a card or pin opens a popup and triggers the floating map notification toast.

### 3.3 Styling (`styles.css`)
- **Glassmorphism:** Uses `backdrop-filter: blur(16px)` and translucent backgrounds (`rgba(15, 23, 42, 0.85)`).
- **Responsive Layout:** Side-by-side on desktop (>860px) and vertical stack on mobile devices.
- **Color Coding:**
  - High Power: Amber/Gold (`#fbbf24`)
  - Medium Power: Electric Cyan (`#38bdf8`)
  - Low Power: Emerald Green (`#34d399`)
  - Unspecified: Muted Slate (`#94a3b8`)

---

## 4. How to Run
```bash
cd "osm-smart-explorer"
python -m http.server 8080
# Open http://localhost:8080 in your browser
```
