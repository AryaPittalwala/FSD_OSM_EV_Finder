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
const powerSelect    = document.getElementById('power-select');
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

// ETA Alert & Toast DOM refs
const nearestEtaAlert  = document.getElementById('nearest-eta-alert');
const nearestEtaName   = document.getElementById('nearest-station-name');
const nearestEtaTime   = document.getElementById('nearest-eta-time');
const nearestEtaDist   = document.getElementById('nearest-eta-dist');
const floatingEtaToast = document.getElementById('floating-eta-toast');
const toastTitle       = document.getElementById('toast-title');
const toastMeta        = document.getElementById('toast-meta');
const toastClose       = document.getElementById('toast-close');

if (toastClose) {
  toastClose.addEventListener('click', () => {
    if (floatingEtaToast) floatingEtaToast.classList.add('hidden');
  });
}

// ── Leaflet map ────────────────────────────────────────────
const map = L.map('map').setView([20.5937, 78.9629], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

let locationMarker = null;    // User's location marker
let stationMarkers = [];      // EV station markers
let activeItem     = null;    // Currently highlighted list item
let cachedStations = [];      // Last fetched stations for instant zero-token filtering
let cachedUserCoords = null;  // Last user coordinates

// Custom modern pin icons
const evIcon = L.divIcon({
  className: 'custom-ev-pin',
  html: `<div style="
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff;
    width: 28px;
    height: 28px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    border: 2px solid #ffffff;
  "><span style="transform: rotate(45deg); font-size: 13px; font-weight: bold; line-height: 1;">⚡</span></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28]
});

const userIcon = L.divIcon({
  className: 'custom-user-pin',
  html: `<div style="
    background: linear-gradient(135deg, #2563eb, #38bdf8);
    color: #fff;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 16px rgba(56, 189, 248, 0.7);
    border: 2px solid #ffffff;
    font-size: 13px;
  ">📍</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -13]
});

// Ensure full map viewport initializes correctly
window.addEventListener('load', () => setTimeout(() => map.invalidateSize(), 150));
window.addEventListener('resize', () => map.invalidateSize());

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
    searchBtn.textContent = 'Find Stations';
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
  powerSelect.value = 'all';
  cachedStations = [];
  cachedUserCoords = null;
  if (locationMarker) { map.removeLayer(locationMarker); locationMarker = null; }
  map.setView([20.5937, 78.9629], 5);
  input.focus();
});

// ── EVENT 4: change — filter stations by power range ──────
powerSelect.addEventListener('change', () => {
  if (cachedStations.length > 0 && cachedUserCoords) {
    renderStations(cachedStations, cachedUserCoords.lat, cachedUserCoords.lon);
  }
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
    locationMarker = L.marker([lat, lon], { icon: userIcon }).addTo(map).bindPopup(title).openPopup();
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

  // Cache for instant client-side filtering without extra API requests
  cachedStations = stations || [];
  cachedUserCoords = { lat: userLat, lon: userLon };

  // Filter valid locations with lat/lon
  const validStations = cachedStations.filter(s =>
    s.AddressInfo &&
    typeof s.AddressInfo.Latitude === 'number' &&
    typeof s.AddressInfo.Longitude === 'number'
  );

  // Helper to get highest connection power in kW
  function getMaxPower(s) {
    if (Array.isArray(s.Connections) && s.Connections.length > 0) {
      const powers = s.Connections.map(c => c.PowerKW).filter(p => typeof p === 'number' && p > 0);
      if (powers.length > 0) return Math.max(...powers);
    }
    return null;
  }

  // Filter by user selected power range
  const selectedPower = powerSelect.value;
  const filteredStations = validStations.filter(s => {
    const power = getMaxPower(s);
    if (selectedPower === 'high') return power !== null && power >= 50;
    if (selectedPower === 'medium') return power !== null && power >= 20 && power < 50;
    if (selectedPower === 'low') return power !== null && power < 20;
    if (selectedPower === 'unspecified') return power === null;
    return true; // 'all'
  });

  if (!filteredStations.length) {
    const powerLabels = {
      high: 'High Power (≥ 50 kW)',
      medium: 'Medium Power (20–49 kW)',
      low: 'Low Power (< 20 kW)',
      unspecified: 'Unspecified Power'
    };
    const pLabel = powerLabels[selectedPower];
    stationsStatus.textContent = pLabel
      ? `No ${pLabel} stations found nearby. Try selecting 'All Powers' or a larger radius.`
      : 'No EV stations found in this area. Try a larger radius.';
    stationsStatus.className = 'msg info';
    stationsCount.textContent = '0 found';
    stationsCount.classList.remove('hidden');
    map.setView([userLat, userLon], 11);
    setTimeout(() => map.invalidateSize(), 200);
    return;
  }

  stationsStatus.textContent = selectedPower !== 'all'
    ? `Showing filtered stations · Click to center`
    : 'Click any location to center on map';
  stationsStatus.className = 'stations-subtext';
  stationsCount.textContent = `${filteredStations.length} found`;
  stationsCount.classList.remove('hidden');

  const withDist = filteredStations
    .map(s => {
      const lat = s.AddressInfo.Latitude;
      const lon = s.AddressInfo.Longitude;
      const dist = (typeof s.AddressInfo.Distance === 'number')
        ? s.AddressInfo.Distance
        : haversine(userLat, userLon, lat, lon);
      return { ...s, _lat: lat, _lon: lon, _dist: dist };
    })
    .sort((a, b) => a._dist - b._dist);

  // Update Nearest Station Travel Time Alert Banner
  const nearest = withDist[0];
  if (nearest && nearestEtaAlert) {
    const nDist = nearest._dist;
    const nEta = estimateTravelTime(nDist);
    const distText = nDist < 1 ? `${Math.round(nDist * 1000)} m` : `${nDist.toFixed(1)} km`;
    nearestEtaName.textContent = nearest.AddressInfo?.Title || 'EV Charging Station';
    nearestEtaTime.textContent = `🚗 ~${nEta} drive`;
    nearestEtaDist.textContent = `${distText} from searched location`;
    nearestEtaAlert.classList.remove('hidden');
  }

  const bounds = [[userLat, userLon]];

  withDist.forEach((s, idx) => {
    const addr = s.AddressInfo || {};
    const name = addr.Title || `EV Station #${idx + 1}`;
    const operator = s.OperatorInfo?.Title || 'PUBLIC STATION';
    const dist = s._dist;
    const etaStr = estimateTravelTime(dist);
    const distStr = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;

    bounds.push([s._lat, s._lon]);
    const mkr = L.marker([s._lat, s._lon], { icon: evIcon })
      .addTo(map).bindPopup(buildPopup(s));
    stationMarkers.push(mkr);

    const li = document.createElement('li');
    li.className = 'station-item';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');

    // 1. Top row: Operator name + Power badge container
    const topRow = document.createElement('div');
    topRow.className = 'station-card-top';

    const rawOp = (operator || 'PUBLIC STATION').trim();
    const cleanOp = rawOp.replace(/^\(+|\)+$/g, '').trim() || 'PUBLIC STATION';
    const op = document.createElement('span');
    op.className = 'station-operator';
    op.textContent = cleanOp;
    topRow.appendChild(op);

    // Determine power tier class and label
    const maxPower = getMaxPower(s);
    let powerTierClass = 'power-none';
    let powerTierLabel = 'No Spec';

    if (maxPower !== null) {
      if (maxPower >= 50) {
        powerTierClass = 'tier-high';
        powerTierLabel = 'High Power';
      } else if (maxPower >= 20) {
        powerTierClass = 'tier-medium';
        powerTierLabel = 'Medium Power';
      } else {
        powerTierClass = 'tier-low';
        powerTierLabel = 'Low Power';
      }
    }

    const badgeContainer = document.createElement('div');
    badgeContainer.className = 'power-badge-container';

    // Distinct Power Tier Badge (High / Medium / Low / No Spec)
    const tierTag = document.createElement('span');
    tierTag.className = `power-tier-tag ${powerTierClass}`;
    tierTag.textContent = powerTierLabel;
    badgeContainer.appendChild(tierTag);

    // Exact wattage badge (e.g. ⚡ 90 kW)
    if (maxPower) {
      const pBadge = document.createElement('span');
      pBadge.className = `station-power-badge ${powerTierClass}`;
      pBadge.textContent = `⚡ ${maxPower} kW`;
      badgeContainer.appendChild(pBadge);
    }
    topRow.appendChild(badgeContainer);

    // 2. Station Title
    const nm = document.createElement('div');
    nm.className = 'station-name';
    nm.textContent = name;

    // 3. Address
    const addressStr = [addr.AddressLine1, addr.Town, addr.StateOrProvince].filter(Boolean).join(', ') || 'Address not listed';
    const addrDiv = document.createElement('div');
    addrDiv.className = 'station-address';
    addrDiv.textContent = addressStr;

    // 4. Bottom row: Operational status dot & Estimated travel time + Distance
    const btmRow = document.createElement('div');
    btmRow.className = 'station-card-bottom';

    const statusPill = document.createElement('div');
    statusPill.className = 'station-status-pill';
    statusPill.innerHTML = '<span class="status-indicator-dot"></span>Operational';

    const metricsGroup = document.createElement('div');
    metricsGroup.className = 'station-metrics-group';

    const etaPill = document.createElement('span');
    etaPill.className = 'station-eta-pill';
    etaPill.innerHTML = `🚗 ~${etaStr}`;

    const ds = document.createElement('span');
    ds.className = 'station-dist';
    ds.textContent = distStr;

    metricsGroup.append(etaPill, ds);
    btmRow.append(statusPill, metricsGroup);

    // Assemble card
    li.append(topRow, nm, addrDiv, btmRow);

    const activate = () => {
      if (activeItem) activeItem.classList.remove('active');
      li.classList.add('active');
      activeItem = li;
      map.setView([s._lat, s._lon], 16);
      mkr.openPopup();

      // Show floating travel time alert toast on map
      if (floatingEtaToast) {
        toastTitle.textContent = name;
        toastMeta.textContent = `🚗 ~${etaStr} drive (${distStr} from your location)`;
        floatingEtaToast.classList.remove('hidden');
      }
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
  div.className = 'station-popup';

  const title = document.createElement('h4');
  title.textContent = addr.Title || 'EV Charging Station';
  div.appendChild(title);

  const add = (label, val) => {
    if (!val) return;
    const p = document.createElement('p');
    p.innerHTML = `<strong>${label}:</strong> ${val}`;
    div.appendChild(p);
  };

  const travelTimeStr = estimateTravelTime(station._dist || 0);
  const distStr = (station._dist < 1)
    ? `${Math.round((station._dist || 0) * 1000)} m`
    : `${(station._dist || 0).toFixed(1)} km`;

  add('Est. Travel Time', `🚗 ~${travelTimeStr} drive`);
  add('Distance', `${distStr} away`);

  const address = [addr.AddressLine1, addr.Town, addr.StateOrProvince].filter(Boolean).join(', ');
  add('Address', address);
  add('Operator', station.OperatorInfo?.Title);
  add('Access', station.UsageType?.Title);
  add('Points', station.NumberOfPoints ? `${station.NumberOfPoints} port(s)` : null);
  add('Fee', station.UsageCost);

  if (Array.isArray(station.Connections) && station.Connections.length > 0) {
    const power = station.Connections.map(c => c.PowerKW ? `${c.PowerKW} kW` : null).filter(Boolean);
    if (power.length > 0) add('Power', [...new Set(power)].join(', '));
  }

  return div;
}

// ── Travel Time & Geometry Helpers ──────────────────────────
function estimateTravelTime(distKm) {
  if (distKm <= 0) return '1 min';
  // Realistic urban driving speed ~28 km/h + traffic factor
  const mins = Math.max(1, Math.round((distKm / 28) * 60));
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

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
function hideStations()       {
  stationsList.innerHTML = '';
  stationsStatus.textContent = 'Enter a location above to discover stations.';
  stationsCount.textContent = '';
  stationsCount.classList.add('hidden');
  if (nearestEtaAlert) nearestEtaAlert.classList.add('hidden');
  if (floatingEtaToast) floatingEtaToast.classList.add('hidden');
}
function clearStationMarkers(){ stationMarkers.forEach(m => map.removeLayer(m)); stationMarkers = []; }

