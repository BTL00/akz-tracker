// Admin module for managing expeditions and boats
// This module is completely standalone and does not share global state with app.js

// State
let currentTab = 'expeditions';
let allBoats = [];
let allExpeditions = [];

// Get admin API key from session storage
function getApiKey() {
  return sessionStorage.getItem('admin-api-key') || '';
}

// Initialize admin module
function initAdmin() {
  // Tab switching
  document.querySelectorAll('.admin-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Close button
  document.getElementById('admin-close-btn').addEventListener('click', () => {
    closeAdminModal();
  });

  // Refresh button
  const refreshBtn = document.getElementById('admin-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('refreshing');
      await loadData();
      setTimeout(() => {
        refreshBtn.classList.remove('refreshing');
      }, 600);
    });
  }

  // Overlay click to close
  document.getElementById('admin-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAdminModal();
  });

  // New expedition button
  const newExpBtn = document.getElementById('new-expedition-btn');
  if (newExpBtn) {
    newExpBtn.addEventListener('click', () => {
      renderExpeditionForm();
    });
  }

  // New boat button
  const newBoatBtn = document.getElementById('new-boat-btn');
  if (newBoatBtn) {
    newBoatBtn.addEventListener('click', () => {
      renderBoatForm();
    });
  }

  // GPX upload button
  const gpxUploadBtn = document.getElementById('gpx-upload-btn');
  if (gpxUploadBtn) {
    gpxUploadBtn.addEventListener('click', handleGPXUpload);
  }

  // GPX import confirm button
  const gpxImportConfirmBtn = document.getElementById('gpx-import-confirm-btn');
  if (gpxImportConfirmBtn) {
    gpxImportConfirmBtn.addEventListener('click', confirmGPXImport);
  }

  // GPX import cancel button
  const gpxImportCancelBtn = document.getElementById('gpx-import-cancel-btn');
  if (gpxImportCancelBtn) {
    gpxImportCancelBtn.addEventListener('click', cancelGPXImport);
  }

  // NMEA upload button
  const nmeaUploadBtn = document.getElementById('nmea-upload-btn');
  if (nmeaUploadBtn) {
    nmeaUploadBtn.addEventListener('click', handleNMEAUpload);
  }

  // NMEA import confirm button
  const nmeaImportConfirmBtn = document.getElementById('nmea-import-confirm-btn');
  if (nmeaImportConfirmBtn) {
    nmeaImportConfirmBtn.addEventListener('click', confirmNMEAImport);
  }

  // NMEA import cancel button
  const nmeaImportCancelBtn = document.getElementById('nmea-import-cancel-btn');
  if (nmeaImportCancelBtn) {
    nmeaImportCancelBtn.addEventListener('click', cancelNMEAImport);
  }

  // Boat PIN/Keys modal overlay click to close
  const boatPinKeysModal = document.getElementById('boat-pin-keys-modal');
  if (boatPinKeysModal) {
    boatPinKeysModal.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeBoatPinKeysModal();
    });
  }

  // Load initial data
  loadData();
}

// Switch tabs
function switchTab(tab) {
  currentTab = tab;

  // Update tab buttons
  document.querySelectorAll('.admin-tabs .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Update content sections
  document.querySelectorAll('.tab-content').forEach(content => {
    const isActive = content.id === `${tab}-tab`;
    content.classList.toggle('active', isActive);
    content.classList.toggle('hidden', !isActive);
  });

  loadData();
}

// Load data for current tab
async function loadData() {
  try {
    if (currentTab === 'expeditions') {
      const response = await fetch('/api/expeditions', {
        headers: { 'x-api-key': getApiKey() }
      });
      allExpeditions = await response.json();
      renderExpeditionsTable();
    } else {
      const response = await fetch('/api/boats-metadata', {
        headers: { 'x-api-key': getApiKey() }
      });
      allBoats = await response.json();
      renderBoatsTable();
    }
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

// Render expeditions table
function renderExpeditionsTable() {
  const tbody = document.querySelector('#expeditions-table tbody');
  tbody.innerHTML = '';

  allExpeditions.forEach(exp => {
    const tr = document.createElement('tr');
    
    const nameTd = document.createElement('td');
    nameTd.innerHTML = `
      ${escapeHtml(exp.name)}
      ${exp.live ? '<span class="live-badge">Live</span>' : ''}
    `;
    tr.appendChild(nameTd);

    const boatsTd = document.createElement('td');
    boatsTd.textContent = exp.boatIds.length;
    tr.appendChild(boatsTd);

    const datesTd = document.createElement('td');
    datesTd.textContent = `${formatDate(exp.startDate)} - ${exp.endDate ? formatDate(exp.endDate) : 'Ongoing'}`;
    tr.appendChild(datesTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';
    actionsTd.innerHTML = `
      <button onclick="admin.editExpedition('${exp.expeditionId}')">Edit</button>
      <button class="delete-btn" onclick="admin.deleteExpedition('${exp.expeditionId}')">Delete</button>
      <button onclick="admin.exportExpeditionGPX('${exp.expeditionId}')">📥 GPX</button>
    `;
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });
}

// Render boats table
function renderBoatsTable() {
  const tbody = document.querySelector('#boats-table tbody');
  tbody.innerHTML = '';

  allBoats.forEach(boat => {
    const tr = document.createElement('tr');

    const circTd = document.createElement('td');
    circTd.innerHTML = `<div style="width:16px;height:16px;border-radius:50%;background:${escapeHtml(boat.color)}"></div>`;
    tr.appendChild(circTd);

    const nameTd = document.createElement('td');
    nameTd.textContent = boat.name;
    tr.appendChild(nameTd);

    const mmsiTd = document.createElement('td');
    mmsiTd.textContent = boat.mmsi || '-';
    tr.appendChild(mmsiTd);

    // Tracker status column
    const statusTd = document.createElement('td');
    statusTd.className = 'tracker-status';
    let statusHtml = '<div style="display: flex; gap: 8px; font-size: 12px;">';
    
    // AT4 Tracker status
    if (boat.at4TcpPort) {
      const at4 = boat.trackerStatus?.at4;
      if (at4?.connected) {
        statusHtml += '<span style="color: #4CAF50;" title="AT4 tracker connected">🟢 AT4</span>';
      } else if (at4?.active) {
        statusHtml += '<span style="color: #FF9800;" title="AT4 listener active, awaiting connection">🟡 AT4</span>';
      } else {
        statusHtml += '<span style="color: #999;" title="AT4 configured but inactive">⚪ AT4</span>';
      }
    }
    
    // Phone tracker status
    const phone = boat.trackerStatus?.phone;
    if (phone?.active) {
      const lastUpdate = new Date(phone.lastUpdate);
      const minutesAgo = Math.floor((Date.now() - lastUpdate.getTime()) / 60000);
      statusHtml += `<span style="color: #4CAF50;" title="Phone tracking active (${minutesAgo}m ago)">🟢 Phone</span>`;
    } else {
      statusHtml += '<span style="color: #999;" title="Phone tracking inactive">⚪ Phone</span>';
    }
    
    statusHtml += '</div>';
    statusTd.innerHTML = statusHtml;
    tr.appendChild(statusTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';
    actionsTd.innerHTML = `
      <button onclick="admin.showBoatPinKeys('${boat.boatId}', '${escapeHtml(boat.name)}', '${boat.pin}', '${boat.apiKey}')">PIN/Keys</button>
      <button onclick="admin.editBoat('${boat.boatId}')">Edit</button>
      <button class="delete-btn" onclick="admin.deleteBoat('${boat.boatId}')">Delete</button>
      <button onclick="admin.exportBoatGPX('${boat.boatId}', '${escapeHtml(boat.name)}')">📥 GPX</button>
    `;
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  });
}

// Render expedition form
function renderExpeditionForm(expeditionId = null) {
  const expedition = expeditionId ? allExpeditions.find(e => e.expeditionId === expeditionId) : null;
  const isEdit = !!expedition;

  const formHtml = `
    <div class="admin-form" id="expedition-form">
      <div class="form-group">
        <label>Expedition id</label>
        <input type="text" id="exp-id" value="${expedition ? escapeHtml(expedition.expeditionId) : ''}" ${isEdit ? 'readonly' : ''} placeholder="e.g., summer-regatta-2024">
      </div>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="exp-name" value="${expedition ? escapeHtml(expedition.name) : ''}" placeholder="e.g., Summer Regatta">
      </div>
      <div class="form-group">
        <label>Start date</label>
        <input type="date" id="exp-start" value="${expedition ? expedition.startDate.split('T')[0] : ''}">
      </div>
      <div class="form-group">
        <label>End date (optional)</label>
        <input type="date" id="exp-end" value="${expedition && expedition.endDate ? expedition.endDate.split('T')[0] : ''}">
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="exp-desc" placeholder="Optional description">${expedition ? escapeHtml(expedition.description || '') : ''}</textarea>
      </div>
      <div class="form-group">
        <label>Boats</label>
        <div class="boat-checklist" id="exp-boats"></div>
      </div>
      <div class="form-group toggle-group">
        <label>Live expedition</label>
        <label class="toggle-switch">
          <input type="checkbox" id="exp-live" ${expedition && expedition.live ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <span style="font-size:12px;color:#666;">(Live expeditions filter the map view, historical expeditions use playback mode)</span>
      </div>
      <div class="form-actions">
        <button class="cancel-btn" onclick="admin.cancelForm()">Cancel</button>
        <button class="submit-btn" onclick="admin.saveExpedition(${isEdit})">${isEdit ? 'Update' : 'Create'}</button>
      </div>
    </div>
  `;

  const container = document.getElementById('expeditions-tab');
  const existingForm = container.querySelector('.admin-form');
  if (existingForm) existingForm.remove();
  container.insertAdjacentHTML('afterbegin', formHtml);

  // Populate boat checklist
  fetch('/api/boats')
    .then(r => r.json())
    .then(boats => {
      const checklist = document.getElementById('exp-boats');
      boats.forEach(boat => {
        const checked = expedition && expedition.boatIds.includes(boat.boatId);
        checklist.innerHTML += `
          <label>
            <input type="checkbox" value="${boat.boatId}" ${checked ? 'checked' : ''}>
            <div style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${boat.color};margin-right:4px;"></div>
            ${escapeHtml(boat.name)}
          </label>
        `;
      });
    });
}

// Render boat form
function renderBoatForm(boatId = null) {
  const boat = boatId ? allBoats.find(b => b.boatId === boatId) : null;
  const isEdit = !!boat;

  const formHtml = `
    <div class="admin-form" id="boat-form">
      <div class="form-group">
        <label>Boat id</label>
        <input type="text" id="boat-id" value="${boat ? escapeHtml(boat.boatId) : ''}" ${isEdit ? 'readonly' : ''} placeholder="e.g., boat-delta">
      </div>
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="boat-name" value="${boat ? escapeHtml(boat.name) : ''}" placeholder="e.g., Delta">
      </div>
      <div class="form-group">
        <label>Color</label>
        <input type="color" id="boat-color" value="${boat ? boat.color : '#3388ff'}">
      </div>
      <div class="form-group">
        <label>MMSI (optional)</label>
        <input type="text" id="boat-mmsi" value="${boat ? escapeHtml(boat.mmsi || '') : ''}" placeholder="9-digit number">
      </div>
      <!-- NMEA and SignalK ports hidden for simplified GUI -->
      <div class="form-group" style="display:none;">
        <label>NMEA TCP port (optional, 10110-10129)</label>
        <input type="number" id="boat-nmea-port" value="${boat && boat.nmeaTcpPort ? boat.nmeaTcpPort : ''}" placeholder="e.g., 10110" min="10110" max="10129">
        <small>Allocate a unique port for this boat's NMEA data stream</small>
      </div>
      <div class="form-group">
        <label>AT4 Tracker TCP port (optional, 21100-21129)</label>
        <input type="number" id="boat-at4-port" value="${boat && boat.at4TcpPort ? boat.at4TcpPort : ''}" placeholder="e.g., 21100" min="21100" max="21129">
        <small>Allocate a unique port for this boat's AT4 GPS tracker connection (one tracker per boat per port)</small>
      </div>
      <div class="form-group" style="display:none;">
        <label>SignalK port (optional, 13110-13129)</label>
        <input type="number" id="boat-signalk-port" value="${boat && boat.signalkPort ? boat.signalkPort : ''}" placeholder="e.g., 13110" min="13110" max="13129">
        <small>Allocate a unique port for this boat's SignalK connection</small>
      </div>
      <div class="form-group">
        <label>Data sources to display</label>
        <small>Select which data sources should be shown on the map for this boat</small>
        <div class="source-filter-list">
          ${renderSourceCheckboxes(boat)}
        </div>
      </div>
      <div class="form-actions">
        <button class="cancel-btn" onclick="admin.cancelForm()">Cancel</button>
        <button class="submit-btn" onclick="admin.saveBoat(${isEdit})">${isEdit ? 'Update' : 'Create'}</button>
      </div>
    </div>
  `;

  const container = document.getElementById('boats-tab');
  const existingForm = container.querySelector('.admin-form');
  if (existingForm) existingForm.remove();
  container.insertAdjacentHTML('afterbegin', formHtml);
}

// Render source checkboxes for boat form
function renderSourceCheckboxes(boat) {
  // NMEA and SignalK sources removed for simplified GUI
  const sources = [
    { value: 'phone', label: 'Phone GPS' },
    { value: 'at4', label: 'AT4 Tracker' },
    { value: 'gpx', label: 'GPX import' },
    { value: 'nmea-file', label: 'NMEA (file input)' }
  ];

  const enabledSources = boat && boat.enabledSources ? boat.enabledSources : 
    ['phone', 'at4', 'gpx', 'nmea-file'];

  return sources.map(source => `
    <label class="source-checkbox">
      <input type="checkbox" 
             name="enabled-source" 
             value="${source.value}" 
             ${enabledSources.indexOf(source.value) !== -1 ? 'checked' : ''}>
      <span>${source.label}</span>
    </label>
  `).join('');
}

// Save expedition
async function saveExpedition(isEdit) {
  const id = document.getElementById('exp-id').value.trim();
  const name = document.getElementById('exp-name').value.trim();
  const startDate = document.getElementById('exp-start').value;
  const endDate = document.getElementById('exp-end').value;
  const description = document.getElementById('exp-desc').value.trim();
  const live = document.getElementById('exp-live').checked;
  const boatIds = Array.from(document.querySelectorAll('#exp-boats input:checked')).map(cb => cb.value);

  if (!id || !name || !startDate || boatIds.length === 0) {
    alert('Please fill in all required fields and select at least one boat.');
    return;
  }

  const data = {
    expeditionId: id,
    name,
    boatIds,
    live,
    startDate: new Date(startDate).toISOString(),
    endDate: endDate ? new Date(endDate).toISOString() : null,
    description
  };

  try {
    const url = isEdit ? `/api/expeditions/${id}` : '/api/expeditions';
    const method = isEdit ? 'PUT' : 'POST';
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey()
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) throw new Error('Failed to save expedition');

    cancelForm();
    loadData();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Save boat
async function saveBoat(isEdit) {
  const id = document.getElementById('boat-id').value.trim();
  const name = document.getElementById('boat-name').value.trim();
  const color = document.getElementById('boat-color').value;
  const mmsi = document.getElementById('boat-mmsi').value.trim();
  const nmeaPortInput = document.getElementById('boat-nmea-port').value.trim();
  const at4PortInput = document.getElementById('boat-at4-port').value.trim();
  const signalkPortInput = document.getElementById('boat-signalk-port').value.trim();
  
  // Collect enabled sources from checkboxes
  const enabledSources = Array.from(
    document.querySelectorAll('input[name="enabled-source"]:checked')
  ).map(cb => cb.value);

  if (!id || !name) {
    alert('Please fill in boat ID and name.');
    return;
  }

  // Validate port ranges if provided
  const nmeaTcpPort = nmeaPortInput ? parseInt(nmeaPortInput, 10) : null;
  const at4TcpPort = at4PortInput ? parseInt(at4PortInput, 10) : null;
  const signalkPort = signalkPortInput ? parseInt(signalkPortInput, 10) : null;

  if (nmeaTcpPort && (nmeaTcpPort < 10110 || nmeaTcpPort > 10129)) {
    alert('NMEA TCP port must be between 10110 and 10129');
    return;
  }

  if (at4TcpPort && (at4TcpPort < 21100 || at4TcpPort > 21129)) {
    alert('AT4 TCP port must be between 21100 and 21129');
    return;
  }

  if (signalkPort && (signalkPort < 13110 || signalkPort > 13129)) {
    alert('SignalK port must be between 13110 and 13129');
    return;
  }

  const data = { boatId: id, name, color, mmsi, nmeaTcpPort, at4TcpPort, signalkPort, enabledSources };

  try {
    if (isEdit) {
      const response = await fetch(`/api/boats/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': getApiKey()
        },
        body: JSON.stringify({ name, color, mmsi, nmeaTcpPort, at4TcpPort, signalkPort, enabledSources })
      });
      if (!response.ok) throw new Error('Failed to update boat');
      
      cancelForm();
      loadData();
    } else {
      // Create new boat
      const response = await fetch('/api/boats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': getApiKey()
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create boat');
      }
      
      const result = await response.json();
      
      cancelForm();
      await loadData();
      
      // Show inline notice instead of alert
      document.getElementById('bcn-pin').textContent = result.pin;
      document.getElementById('bcn-apikey').textContent = result.apiKey;
      document.getElementById('boat-created-notice').classList.remove('hidden');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Edit expedition
function editExpedition(expeditionId) {
  renderExpeditionForm(expeditionId);
}

// Edit boat
function editBoat(boatId) {
  renderBoatForm(boatId);
}

// Delete expedition
async function deleteExpedition(expeditionId) {
  if (!confirm('Are you sure you want to delete this expedition?')) return;

  try {
    const response = await fetch(`/api/expeditions/${expeditionId}`, {
      method: 'DELETE',
      headers: { 'x-api-key': getApiKey() }
    });

    if (!response.ok) throw new Error('Failed to delete expedition');

    loadData();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Delete boat
async function deleteBoat(boatId) {
  alert('Deleting boats is not supported. Boats are automatically managed based on location data.');
}

// Cancel form
function cancelForm() {
  const form = document.querySelector('.admin-form');
  if (form) form.remove();
}

// Close modal
function closeAdminModal() {
  document.getElementById('admin-modal').classList.add('hidden');
}

// Utility functions
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

// ===== GPX Import/Export Functions =====

let parsedGPXData = null;

async function handleGPXUpload() {
  const fileInput = document.getElementById('gpx-file-input');
  const file = fileInput.files[0];
  
  if (!file) {
    alert('Please select a GPX file');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/gpx/import', {
      method: 'POST',
      headers: {  'x-api-key': getApiKey() },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    const result = await response.json();
    parsedGPXData = result;
    renderGPXMapping(result);
  } catch (err) {
    alert('Error uploading GPX: ' + err.message);
    console.error(err);
  }
}

function renderGPXMapping(gpxData) {
  const mappingList = document.getElementById('gpx-mapping-list');
  mappingList.innerHTML = '';

  gpxData.tracks.forEach((track, idx) => {
    const totalPoints = track.points;
    
    // Calculate estimated point reductions for each sampling mode
    const reductions = {
      'none': totalPoints,
      '10sec': Math.max(1, Math.ceil(totalPoints / 10)),
      '1min': Math.max(1, Math.ceil(totalPoints / 60)),
      '10min': Math.max(1, Math.ceil(totalPoints / 600)),
      '1hour': Math.max(1, Math.ceil(totalPoints / 3600))
    };

    const div = document.createElement('div');
    div.className = 'gpx-track-mapping';
    div.innerHTML = `
      <div class="mapping-row">
        <div class="track-info">
          <strong>${escapeHtml(track.name)}</strong>
          <span>${track.points} points</span>
          ${track.startTime ? `<span>${new Date(track.startTime).toLocaleString()}</span>` : ''}
        </div>
        <div class="mapping-controls">
          <label>Boat PIN:</label>
          <input type="text" id="track-${idx}-pin" placeholder="6-digit PIN" maxlength="6" pattern="[0-9]{6}" />
          
          <label>Re-sampling:</label>
          <select id="track-${idx}-resample" class="track-resample-select" data-track-idx="${idx}">
            <option value="none">No re-sampling (${reductions['none']} points)</option>
            <option value="10sec">10 seconds (≈${reductions['10sec']} points)</option>
            <option value="1min">1 minute (≈${reductions['1min']} points)</option>
            <option value="10min">10 minutes (≈${reductions['10min']} points)</option>
            <option value="1hour">1 hour (≈${reductions['1hour']} points)</option>
          </select>
        </div>
      </div>
    `;
    mappingList.appendChild(div);
  });

  document.getElementById('gpx-preview').classList.remove('hidden');
}

async function confirmGPXImport() {
  if (!parsedGPXData) {
    alert('No GPX data to import');
    return;
  }

  // Collect mapping (PIN and resampling mode)
  const mapping = {};
  let valid = true;
  let hasAtLeastOne = false;

  parsedGPXData.tracks.forEach((track, idx) => {
    const pinInput = document.getElementById(`track-${idx}-pin`);
    const resampleSelect = document.getElementById(`track-${idx}-resample`);
    const pin = pinInput.value.trim();
    const resamplingMode = resampleSelect.value;

    // Allow skipping track by leaving PIN empty
    if (!pin) {
      return; // Skip this track
    }

    hasAtLeastOne = true;

    if (!/^[0-9]{6}$/.test(pin)) {
      alert(`Invalid PIN for track ${idx + 1} (${track.name}). Must be 6 digits or leave empty to skip.`);
      valid = false;
      return;
    }

    mapping[idx] = { pin, resamplingMode };
  });

  if (!valid) {
    return;
  }

  if (!hasAtLeastOne) {
    alert('No tracks selected for import. Please enter at least one PIN or cancel the import.');
    return;
  }

  try {
    const response = await fetch('/api/gpx/import/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey()
      },
      body: JSON.stringify({
        gpxData: parsedGPXData.rawData,
        mapping
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Import failed');
    }

    const result = await response.json();
    alert(`Import successful!\n\nLocations imported: ${result.locationsCreated}\nDuplicates skipped: ${result.locationsSkipped}${result.errors ? '\n\nWarnings:\n' + result.errors.join('\n') : ''}`);
    
    // Reset
    cancelGPXImport();
    loadData();
  } catch (err) {
    alert('Error importing GPX: ' + err.message);
    console.error(err);
  }
}

function cancelGPXImport() {
  parsedGPXData = null;
  document.getElementById('gpx-file-input').value = '';
  document.getElementById('gpx-preview').classList.add('hidden');
  document.getElementById('gpx-mapping-list').innerHTML = '';
}

// ===== NMEA Import Functions =====

let parsedNMEAData = null;

async function handleNMEAUpload() {
  const fileInput = document.getElementById('nmea-file-input');
  const file = fileInput.files[0];
  
  if (!file) {
    alert('Please select an NMEA file');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/nmea/import', {
      method: 'POST',
      headers: { 'x-api-key': getApiKey() },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    const result = await response.json();
    parsedNMEAData = result;
    renderNMEASummary(result);
  } catch (err) {
    alert('Error uploading NMEA: ' + err.message);
    console.error(err);
  }
}

function renderNMEASummary(nmeaData) {
  const summaryDiv = document.getElementById('nmea-summary');
  const summary = nmeaData.summary;
  
  summaryDiv.innerHTML = `
    <div class="nmea-summary-info">
      <p><strong>File:</strong> ${escapeHtml(nmeaData.filename)}</p>
      <p><strong>Total lines:</strong> ${summary.totalLines}</p>
      <p><strong>Positions found:</strong> ${summary.positionsFound}</p>
      <p><strong>Errors:</strong> ${summary.errors}</p>
      ${summary.timeRange ? `
        <p><strong>Time range:</strong> ${new Date(summary.timeRange.start).toLocaleString()} - ${new Date(summary.timeRange.end).toLocaleString()}</p>
      ` : ''}
    </div>
  `;

  // Populate boat select dropdown
  const boatSelect = document.getElementById('nmea-boat-id');
  boatSelect.innerHTML = '<option value="">-- Select boat --</option>';
  allBoats.forEach(boat => {
    const option = document.createElement('option');
    option.value = boat.boatId;
    option.textContent = `${boat.name} (${boat.boatId})${boat.mmsi ? ` - MMSI: ${boat.mmsi}` : ''}`;
    boatSelect.appendChild(option);
  });

  document.getElementById('nmea-preview').classList.remove('hidden');
}

async function confirmNMEAImport() {
  if (!parsedNMEAData) {
    alert('No NMEA data to import');
    return;
  }

  const boatId = document.getElementById('nmea-boat-id').value;
  const pin = document.getElementById('nmea-boat-pin').value.trim();

  if (!boatId || !pin) {
    alert('Please select a boat and enter its PIN');
    return;
  }

  if (!/^[0-9]{6}$/.test(pin)) {
    alert('Invalid PIN. Must be 6 digits.');
    return;
  }

  try {
    const response = await fetch('/api/nmea/import/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey()
      },
      body: JSON.stringify({
        nmeaData: parsedNMEAData.rawData,
        boatId,
        pin
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Import failed');
    }

    const result = await response.json();
    alert(`Import successful!\n\nBoat: ${result.boatName} (${result.boatId})\nLocations imported: ${result.locationsCreated}\nDuplicates skipped: ${result.locationsSkipped}`);
    
    // Reset
    cancelNMEAImport();
    loadData();
  } catch (err) {
    alert('Error importing NMEA: ' + err.message);
    console.error(err);
  }
}

function cancelNMEAImport() {
  parsedNMEAData = null;
  document.getElementById('nmea-file-input').value = '';
  document.getElementById('nmea-boat-id').value = '';
  document.getElementById('nmea-boat-pin').value = '';
  document.getElementById('nmea-preview').classList.add('hidden');
  document.getElementById('nmea-summary').innerHTML = '';
}

async function exportExpeditionGPX(expeditionId) {
  try {
    const response = await fetch(`/api/expeditions/${expeditionId}/export/gpx`, {
      headers: { 'x-api-key': getApiKey() }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Export failed');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${expeditionId}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error exporting GPX: ' + err.message);
    console.error(err);
  }
}

async function exportBoatGPX(boatId, boatName) {
  // Show modal for date range (to be implemented in step 10)
  showBoatExportModal(boatId, boatName);
}

function showBoatExportModal(boatId, boatName) {
  const modal = document.getElementById('boat-export-modal');
  document.getElementById('boat-export-name').textContent = boatName;
  document.getElementById('boat-export-id').value = boatId;
  
  // Set default date range (last 30 days)
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  
  document.getElementById('boat-export-start').value = start.toISOString().split('T')[0];
  document.getElementById('boat-export-end').value = end.toISOString().split('T')[0];
  
  modal.classList.remove('hidden');
}

async function confirmBoatExport() {
  const boatId = document.getElementById('boat-export-id').value;
  const startDate = document.getElementById('boat-export-start').value;
  const endDate = document.getElementById('boat-export-end').value;
  
  if (!startDate || !endDate) {
    alert('Please select a date range');
    return;
  }

  try {
    const url = `/api/boats/${boatId}/export/gpx?startDate=${startDate}&endDate=${endDate}`;
    const response = await fetch(url, {
      headers: { 'x-api-key': getApiKey() }
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Export failed');
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${boatId}_${startDate}_${endDate}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
    
    cancelBoatExport();
  } catch (err) {
    alert('Error exporting GPX: ' + err.message);
    console.error(err);
  }
}

function cancelBoatExport() {
  document.getElementById('boat-export-modal').classList.add('hidden');
}

// Show PIN and API key for a boat
function showBoatPinKeys(boatId, boatName, pin, apiKey) {
  const modal = document.getElementById('boat-pin-keys-modal');
  if (!modal) {
    console.error('boat-pin-keys-modal not found');
    return;
  }
  document.getElementById('boat-pk-name').textContent = boatName;
  document.getElementById('boat-pk-pin').textContent = pin;
  document.getElementById('boat-pk-apikey').textContent = apiKey;
  modal.classList.remove('hidden');
}

function closeBoatPinKeysModal() {
  const modal = document.getElementById('boat-pin-keys-modal');
  if (modal) modal.classList.add('hidden');
}

// Helper to escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}

// Export functions to global scope for onclick handlers
window.admin = {
  editExpedition,
  editBoat,
  deleteExpedition,
  deleteBoat,
  saveExpedition,
  saveBoat,
  cancelForm,
  exportExpeditionGPX,
  exportBoatGPX,
  confirmBoatExport,
  cancelBoatExport,
  showBoatPinKeys,
  closeBoatPinKeysModal
};
