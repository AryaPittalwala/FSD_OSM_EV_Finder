/**
 * app.js — EV Charger Finder (OSM Smart Explorer)
 * Events: input, submit, click
 * APIs: Nominatim (geocoding) + Open Charge Map (EV stations)
 */

'use strict';

// ── Open Charge Map Configuration ──────────────────────────
const OCM_API_KEY = '046d788f-51ca-4941-9df4-5951f89778bf';
const OCM_MAX_RESULTS = 30; // Limit results to conserve quota and ensure snappy map rendering

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
    const rawRadius = parseInt(radiusSelect.value, 10);
    const radiusKm  = rawRadius >= 1000 ? Math.round(rawRadius / 1000) : rawRadius;
    stationsStatus.textContent = `Searching for EV stations within ${radiusKm} km…`;
    stationsStatus.className = 'msg info';
    stationsSection.classList.remove('hidden');

    let stations;
    try {
      stations = await fetchEVStations(lat, lon, radiusKm);
    } catch (apiErr) {
      stationsStatus.textContent = `Could not load EV stations: ${apiErr.message}.`;
      stationsStatus.className = 'msg error';
      stationsCount.textContent = '';
      console.error('Open Charge Map error:', apiErr);
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

// ── Open Charge Map API — EV stations ──────────────────────
async function fetchEVStations(lat, lon, radiusKm) {
  const url = new URL('https://api.openchargemap.io/v3/poi/');
  url.searchParams.set('output', 'json');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('distance', radiusKm);
  url.searchParams.set('distanceunit', 'KM');
  url.searchParams.set('maxresults', OCM_MAX_RESULTS);
  url.searchParams.set('compact', 'false');
  url.searchParams.set('verbose', 'false');
  url.searchParams.set('key', OCM_API_KEY);

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 15000);

  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/json',
        'X-API-Key': OCM_API_KEY
      }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      if (res.status === 403) throw new Error('API key invalid or limit reached');
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Invalid response structure');
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('Request timed out (server busy)');
    throw err;
  }
}

// ── Render Open Charge Map stations ────────────────────────
function renderStations(stations, userLat, userLon) {
  clearStationMarkers();
  stationsList.innerHTML = '';
  activeItem = null;

  // Filter valid locations with lat/lon
  const validStations = (stations || []).filter(s =>
    s.AddressInfo &&
    typeof s.AddressInfo.Latitude === 'number' &&
    typeof s.AddressInfo.Longitude === 'number'
  );

  if (!validStations.length) {
    stationsStatus.textContent = 'No EV stations found within this radius. Try selecting a larger radius.';
    stationsStatus.className = 'msg info';
    stationsCount.textContent = '0 found';
    map.setView([userLat, userLon], 11);
    setTimeout(() => map.invalidateSize(), 200);
    return;
  }

  stationsStatus.textContent = '';
  stationsCount.textContent  = `${validStations.length} found`;

  const withDist = validStations
    .map(s => {
      const lat = s.AddressInfo.Latitude;
      const lon = s.AddressInfo.Longitude;
      const dist = (typeof s.AddressInfo.Distance === 'number')
        ? s.AddressInfo.Distance
        : haversine(userLat, userLon, lat, lon);
      return { ...s, _lat: lat, _lon: lon, _dist: dist };
    })
    .sort((a, b) => a._dist - b._dist);

  const bounds = [[userLat, userLon]];

  withDist.forEach((s, idx) => {
    const addr = s.AddressInfo || {};
    const name = addr.Title || `EV Station #${idx + 1}`;
    const operator = s.OperatorInfo?.Title || '';
    const points = s.NumberOfPoints ? `${s.NumberOfPoints} point(s)` : '';
    const cost = s.UsageCost ? `Fee: ${s.UsageCost}` : '';
    const metaParts = [operator, points, cost].filter(Boolean);
    const meta = metaParts.length > 0 ? metaParts.join(' · ') : (addr.Town || 'EV Charging Station');
    const dist = s._dist;

    bounds.push([s._lat, s._lon]);
    const mkr = L.marker([s._lat, s._lon], { icon: evIcon })
      .addTo(map).bindPopup(buildPopup(s));
    stationMarkers.push(mkr);

    const li = document.createElement('li');
    li.className = 'station-item';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');

    const ic = document.createElement('span');
    ic.className = 'station-icon';
    ic.textContent = '⚡';

    const info = document.createElement('div');
    info.className = 'station-info';

    const nm = document.createElement('div');
    nm.className = 'station-name';
    nm.textContent = name;

    const mt = document.createElement('div');
    mt.className = 'station-meta';
    mt.textContent = meta;

    const ds = document.createElement('span');
    ds.className = 'station-dist';
    ds.textContent = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;

    info.append(nm, mt);
    li.append(ic, info, ds);

    const activate = () => {
      if (activeItem) activeItem.classList.remove('active');
      li.classList.add('active');
      activeItem = li;
      map.setView([s._lat, s._lon], 16);
      mkr.openPopup();
    };

    li.addEventListener('click', activate);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate();
    });

    stationsList.appendChild(li);
  });

  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 200);
}

function buildPopup(station) {
  const addr = station.AddressInfo || {};
  const div = document.createElement('div');

  const title = document.createElement('strong');
  title.textContent = addr.Title || 'EV Charging Station';
  div.appendChild(title);

  const add = (label, val) => {
    if (!val) return;
    const p = document.createElement('p');
    p.style.margin = '4px 0 0';
    p.textContent = `${label}: ${val}`;
    div.appendChild(p);
  };

  const address = [addr.AddressLine1, addr.Town, addr.StateOrProvince].filter(Boolean).join(', ');
  add('Address', address);
  add('Operator', station.OperatorInfo?.Title);
  add('Access', station.UsageType?.Title);
  add('Capacity', station.NumberOfPoints ? `${station.NumberOfPoints} point(s)` : null);
  add('Fee', station.UsageCost);

  if (Array.isArray(station.Connections) && station.Connections.length > 0) {
    const power = station.Connections.map(c => c.PowerKW ? `${c.PowerKW} kW` : null).filter(Boolean);
    if (power.length > 0) add('Power', [...new Set(power)].join(', '));
  }

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
