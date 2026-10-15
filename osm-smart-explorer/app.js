/**
 * app.js — EV Charger Finder (OSM Smart Explorer)
 * Events: input, submit, click
 * APIs: Nominatim (geocoding) + Overpass (EV stations)
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────
const form           = document.getElementById('search-form');
const input          = document.getElementById('search-input');
const searchBtn      = document.getElementById('search-btn');
const clearBtn       = document.getElementById('clear-btn');
const counter        = document.getElementById('char-counter');
const msgEl          = document.getElementById('validation-msg');
const radiusSelect   = document.getElementById('radius-select');
const resultPanel    = document.getElementById('result-panel');
const resName        = document.getElementById('res-name');
const resLat         = document.getElementById('res-lat');
const resLon         = document.getElementById('res-lon');
const resCat         = document.getElementById('res-cat');
const resLink        = document.getElementById('res-link');
const stationsSection = document.getElementById('stations-section');
const stationsCount  = document.getElementById('stations-count');
const stationsStatus = document.getElementById('stations-status');
const stationsList   = document.getElementById('stations-list');

// ── Leaflet map ────────────────────────────────────────────
const map = L.map('map').setView([20.5937, 78.9629], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

let locationMarker = null;    // User's location marker
let stationMarkers = [];      // EV station markers
let activeItem     = null;    // Currently highlighted list item

// Custom green EV pin icon
const evIcon = L.divIcon({
  className: '',
  html: '<div style="font-size:1.4rem;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))">⚡</div>',
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -24]
});

// ── EVENT 1: input — live character counter ────────────────
input.addEventListener('input', () => {
  const len = input.value.length;
  counter.textContent = `${len} / 100`;
  if (len > 0 && len < 3) {
    showMsg('Keep typing… (min 3 characters)', 'info');
  } else {
    clearMsg();
  }
});

// ── EVENT 2: submit — geocode → find EV stations ──────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const query = input.value.trim();

  // Validation
  if (!query)              return showMsg('Please enter a location.', 'error');
  if (query.length < 3)   return showMsg('Minimum 3 characters required.', 'error');
  if (query.length > 100) return showMsg('Maximum 100 characters allowed.', 'error');
  if (!/[a-zA-Z0-9]/.test(query)) return showMsg('Must contain at least one letter or digit.', 'error');

  clearMsg();
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching…';
  hideStations();

  try {
    // Step 1: Geocode the location via Nominatim
    const geoParams = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', addressdetails: '1' });
    const geoRes    = await fetch(`https://nominatim.openstreetmap.org/search?${geoParams}`,
                                  { headers: { 'Accept-Language': 'en' } });
    if (!geoRes.ok) throw new Error(`Geocoding failed (${geoRes.status})`);

    const geoData = await geoRes.json();
    if (!Array.isArray(geoData) || geoData.length === 0) {
      showMsg('Location not found. Try a more specific name.', 'info');
      return;
    }

    const place = geoData[0];
    const lat   = parseFloat(place.lat);
    const lon   = parseFloat(place.lon);

    renderLocation(place, lat, lon);
    placeLocationMarker(lat, lon, place.display_name);

    // Step 2: Open Charge Map API — EV stations near coordinates
    const radiusKm = parseInt(radiusSelect.value);
    stationsStatus.textContent = `Searching for EV stations within ${radiusKm} km…`;
    stationsStatus.className = 'msg info';
    stationsSection.classList.remove('hidden');

    let stations;
    try {
      stations = await fetchEVStations(lat, lon, radiusKm);
    } catch (ovErr) {
      stationsStatus.textContent = `Could not load EV stations: ${ovErr.message}.`;
      stationsStatus.className = 'msg error';
      stationsCount.textContent = '';
      console.error('OCM error:', ovErr);
      return;
    }
    renderStations(stations, lat, lon);

  } catch (err) {
    showMsg(`Error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Find EV Stations';
  }
});

// ── EVENT 3: click — clear everything ─────────────────────
clearBtn.addEventListener('click', () => {
  input.value = '';
  counter.textContent = '0 / 100';
  clearMsg();
  resultPanel.classList.add('hidden');
  hideStations();
  clearStationMarkers();
  if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
  map.setView([20.5937, 78.9629], 5);
  input.focus();
});

// ── Nominatim result renderer ──────────────────────────────
function renderLocation(place, lat, lon) {
  resName.textContent = place.display_name || '—';
  resLat.textContent  = lat.toFixed(6);
  resLon.textContent  = lon.toFixed(6);
  resCat.textContent  = place.category ? `${place.category} / ${place.type || '—'}` : '—';
  resLink.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=14`;
  resultPanel.classList.remove('hidden');
}

// ── Place/move the user location marker ───────────────────
function placeLocationMarker(lat, lon, title) {
  if (locationMarker) {
    locationMarker.setLatLng([lat, lon]).setPopupContent(title).openPopup();
  } else {
    locationMarker = L.marker([lat, lon]).addTo(map).bindPopup(title).openPopup();
  }
}

// ── Open Charge Map API — fetch EV stations ──────────────
// Free public API — register at https://openchargemap.org for a key
// Works without a key for demo/low-volume use
async function fetchEVStations(lat, lon, radiusKm) {
  const params = new URLSearchParams({
    output: 'json',
    latitude: lat,
    longitude: lon,
    distance: radiusKm,
    distanceunit: 'KM',
    maxresults: 100,
    compact: true,
    verbose: false
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`https://api.openchargemap.io/v3/poi/?${params}`,
                           { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response from Open Charge Map.');
    return data;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Request timed out.');
    throw e;
  }
}

// ── Render OCM stations list + map markers ────────────────
function renderStations(stations, userLat, userLon) {
  clearStationMarkers();
  stationsList.innerHTML = '';
  activeItem = null;

  if (!stations.length) {
    stationsStatus.textContent = 'No EV stations found here. Try a larger radius.';
    stationsCount.textContent = '';
    map.setView([userLat, userLon], 11);
    setTimeout(() => map.invalidateSize(), 200);
    return;
  }

  stationsStatus.textContent = '';
  stationsCount.textContent  = `${stations.length} found`;

  // OCM returns AddressInfo.Distance in km — sort by it
  stations.sort((a, b) => (a.AddressInfo?.Distance ?? 0) - (b.AddressInfo?.Distance ?? 0));

  const bounds = [[userLat, userLon]];

  stations.forEach((s, idx) => {
    const info     = s.AddressInfo || {};
    const name     = info.Title || `EV Station #${idx + 1}`;
    const address  = [info.AddressLine1, info.Town, info.StateOrProvince].filter(Boolean).join(', ');
    const operator = s.OperatorInfo?.Title || '';
    const points   = s.NumberOfPoints ? `${s.NumberOfPoints} point(s)` : '';
    const cost     = s.UsageCost || '';
    const sLat     = info.Latitude;
    const sLon     = info.Longitude;
    const dist     = info.Distance ?? haversine(userLat, userLon, sLat, sLon);

    if (!sLat || !sLon) return;
    bounds.push([sLat, sLon]);

    const mkr = L.marker([sLat, sLon], { icon: evIcon })
      .addTo(map)
      .bindPopup(buildPopup(name, operator, points, cost, address, sLat, sLon));
    stationMarkers.push(mkr);

    const li = document.createElement('li');
    li.className = 'station-item';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');

    const iconEl = document.createElement('span'); iconEl.className = 'station-icon'; iconEl.textContent = '⚡';
    const infoEl = document.createElement('div');  infoEl.className = 'station-info';
    const nameEl = document.createElement('div');  nameEl.className = 'station-name'; nameEl.textContent = name;
    const metaEl = document.createElement('div');  metaEl.className = 'station-meta';
    metaEl.textContent = [operator, points, address].filter(Boolean).join(' · ') || 'EV Charging Station';
    const distEl = document.createElement('span'); distEl.className = 'station-dist';
    distEl.textContent = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;

    infoEl.append(nameEl, metaEl);
    li.append(iconEl, infoEl, distEl);

    const activate = () => {
      if (activeItem) activeItem.classList.remove('active');
      li.classList.add('active'); activeItem = li;
      map.setView([sLat, sLon], 16); mkr.openPopup();
    };
    li.addEventListener('click', activate);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') activate(); });
    stationsList.appendChild(li);
  });

  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 200);
}

// ── Build popup safely (OCM fields) ──────────────────────
function buildPopup(name, operator, points, cost, address, lat, lon) {
  const div = document.createElement('div');
  const addRow = (label, val) => {
    if (!val) return;
    const p = document.createElement('p'); p.style.margin = '3px 0 0';
    p.textContent = `${label}: ${val}`; div.appendChild(p);
  };
  const h = document.createElement('strong'); h.textContent = name; div.appendChild(h);
  addRow('Operator', operator);
  addRow('Points',   points);
  addRow('Cost',     cost);
  addRow('Address',  address);
  const a = document.createElement('a');
  a.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=17`;
  a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'View on map ↗';
  a.style.cssText = 'font-size:0.8rem;display:block;margin-top:6px';
  div.appendChild(a);
  return div;
}

// ── Helpers ────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function deg2rad(d) { return d * (Math.PI / 180); }

function showMsg(text, type) { msgEl.textContent = text; msgEl.className = `msg ${type}`; }
function clearMsg()           { msgEl.textContent = ''; msgEl.className = 'msg'; }
function hideStations()       { stationsSection.classList.add('hidden'); stationsList.innerHTML = ''; stationsStatus.textContent = ''; stationsCount.textContent = ''; }
function clearStationMarkers(){ stationMarkers.forEach(m => map.removeLayer(m)); stationMarkers = []; }
