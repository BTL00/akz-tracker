/* ===== app.js – AKZ Tracker PWA orchestration ===== */

(function () {
  'use strict';

  var POLL_INTERVAL = 60000; // ms – fetch boats every 60s (WebSocket provides real-time updates)
  var API_BASE      = '';    // same origin

  var map;              // Leaflet map instance
  var timer;            // setInterval id for polling
  var statusTimer;      // setInterval id for status updates
  var mode = 'live';    // 'live' | 'history'
  var autoFit = true;   // when true, live polls fit-bounds to markers
  var firstRender = true; // first live render always fits
  var currentExpedition = null; // current expedition object (for live filtering)
  var liveFilterBoatIds = null; // array of boatIds to filter in live mode
  var connectionMode = 'websocket'; // 'websocket' | 'polling-30' | 'polling-60'
  var lastUpdateTime = null; // timestamp of last successful update

  // SVG icon markup for play / pause
  var SVG_PLAY  = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,3 20,12 6,21"/></svg>';
  var SVG_PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>';

  // DOM refs
  var fitBtn, trackBtn, adminBtn, playbackBar;
  var expeditionSelect, playBtn, speedSelect;
  var timeSlider, timeDisplay;
  var trackerModal, trackerNameInput, trackerPinInput, trackerColorInput, trackerStartBtn, trackerCancelBtn;
  var adminModal, adminLoginModal, adminApiKeyInput;
  var connectionModeSelect, connectionIndicator, lastUpdateTimeDisplay;
  var apiKey = '';

  // ---------- Bootstrap ----------
  document.addEventListener('DOMContentLoaded', function () {
    map = initMap('map');

    // Cache DOM elements — floating buttons
    fitBtn        = document.getElementById('fit-btn');
    trackBtn      = document.getElementById('track-btn');
    adminBtn      = document.getElementById('admin-btn');
    playbackBar   = document.getElementById('playback-bar');
    adminModal  = document.getElementById('admin-modal');
    adminLoginModal = document.getElementById('admin-login-modal');
    adminApiKeyInput = document.getElementById('admin-api-key-input');

    // Cache DOM elements — playback bar
    expeditionSelect = document.getElementById('expedition-select');
    playBtn          = document.getElementById('play-btn');
    speedSelect      = document.getElementById('speed-select');
    timeSlider       = document.getElementById('time-slider');
    timeDisplay      = document.getElementById('time-display');

    // Cache DOM elements — tracker modal
    trackerModal      = document.getElementById('tracker-modal');
    trackerNameInput  = document.getElementById('tracker-name');
    trackerColorInput = document.getElementById('tracker-color');
    trackerStartBtn   = document.getElementById('tracker-start-btn');
    trackerCancelBtn  = document.getElementById('tracker-cancel-btn');

    // Cache DOM elements — connection controls
    connectionModeSelect = document.getElementById('connection-mode-select');
    connectionIndicator = document.getElementById('connection-indicator');
    lastUpdateTimeDisplay = document.getElementById('last-update-time');

    // Read API key from meta tag
    var metaKey = document.querySelector('meta[name="api-key"]');
    if (metaKey) apiKey = metaKey.getAttribute('content') || '';

    // Load connection mode preference
    var savedMode = localStorage.getItem('connection-mode');
    if (savedMode && ['websocket', 'polling-30', 'polling-60'].indexOf(savedMode) !== -1) {
      connectionMode = savedMode;
      connectionModeSelect.value = savedMode;
    }

    // Connection mode change handler
    connectionModeSelect.addEventListener('change', function () {
      switchConnectionMode(connectionModeSelect.value);
    });

    // Playback engine — sync default speed with HTML select
    Playback.init(map, {
      onTimeUpdate: handleTimeUpdate,
      onFinished:   handlePlaybackFinished,
      onRender:     handlePlaybackRender,
    });
    Playback.setSpeed(Number(speedSelect.value));

    // ---------- Floating button: auto-fit ----------
    fitBtn.classList.add('active');
    fitBtn.addEventListener('click', function () {
      autoFit = !autoFit;
      fitBtn.classList.toggle('active', autoFit);
      if (autoFit) fitNow();
    });

    // ---------- Floating button: admin modal ----------
    adminBtn.addEventListener('click', function () {
      // Check if admin API key is stored
      var storedKey = sessionStorage.getItem('admin-api-key');
      if (storedKey) {
        // Already logged in, show admin panel
        adminModal.classList.remove('hidden');
      } else {
        // Show login modal
        adminApiKeyInput.value = '';
        adminLoginModal.classList.remove('hidden');
        adminApiKeyInput.focus();
      }
    });

    // ---------- Admin login handlers ----------
    document.getElementById('admin-login-submit').addEventListener('click', function () {
      var key = adminApiKeyInput.value.trim();
      if (key) {
        sessionStorage.setItem('admin-api-key', key);
        adminLoginModal.classList.add('hidden');
        adminModal.classList.remove('hidden');
      } else {
        alert('Please enter an API key');
      }
    });

    document.getElementById('admin-login-cancel').addEventListener('click', function () {
      adminLoginModal.classList.add('hidden');
    });

    adminLoginModal.addEventListener('click', function (e) {
      if (e.target === adminLoginModal) {
        adminLoginModal.classList.add('hidden');
      }
    });

    // Allow Enter key to submit login
    adminApiKeyInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        document.getElementById('admin-login-submit').click();
      }
    });

    // ---------- Theme toggle button ----------
    var themeToggleBtn = document.getElementById('theme-toggle-btn');
    var themeIcon = document.getElementById('theme-icon');
    var themeLabel = document.getElementById('theme-label');
    
    // Load saved theme preference or default to light
    var savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
    
    themeToggleBtn.addEventListener('click', function () {
      var currentTheme = document.documentElement.dataset.theme || 'light';
      var newTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(newTheme);
      localStorage.setItem('theme', newTheme);
    });
    
    function applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
      themeLabel.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
      if (map && map.setDarkMode) {
        map.setDarkMode(theme === 'dark');
      }
    }

    // ---------- Load expeditions and populate picker ----------
    fetchExpeditions()
      .then(function (list) {
        populateExpeditionSelect(list);
      })
      .catch(function () {
        console.warn('Could not load expeditions');
      });

    // Detect user-initiated pan/zoom → disable auto-fit
    map.on('movestart', function (e) {
      if (e.originalEvent) {
        autoFit = false;
        fitBtn.classList.remove('active');
      }
    });

    // Wire playback-bar events
    expeditionSelect.addEventListener('change', onExpeditionChange);
    playBtn.addEventListener('click', onPlayPause);
    speedSelect.addEventListener('change', onSpeedChange);
    timeSlider.addEventListener('input', onSliderInput);

    // ---------- Floating button: track device ----------
    trackBtn.addEventListener('click', onTrackToggle);
    trackerStartBtn.addEventListener('click', onTrackerStart);
    trackerCancelBtn.addEventListener('click', hideTrackerModal);
    trackerModal.addEventListener('click', function (e) {
      if (e.target === trackerModal) hideTrackerModal();
    });

    // Restore tracking state if previously active
    if (localStorage.getItem('tracker-active') === '1') {
      autoStartTracker();
    }

    // Visibility change: warn user if they leave the tab while tracking
    document.addEventListener('visibilitychange', function () {
      if (!Tracker.isTracking()) return;
      if (document.visibilityState === 'hidden') {
        // GPS may pause — we can't prevent it, but wake lock helps
      } else {
        // Tab is visible again — toast confirms we're still going
        showToast('GPS tracking resumed');
        setTimeout(hideToast, 2000);
      }
    });

    // Start live polling
    fetchAndRender();
    applyConnectionMode();

    // Start status update timer (updates every second)
    statusTimer = setInterval(updateConnectionStatus, 1000);

    // Set up WebSocket callback for real-time location updates
    if (window.wsClient) {
      window.wsClient.setLocationUpdateCallback(handleWebSocketLocationUpdate);
    }
  });

  // ---------- Playback bar show / hide ----------
  function showPlaybackBar() {
    playbackBar.classList.remove('hidden');
    document.body.classList.add('playback-visible');
  }

  function hidePlaybackBar() {
    playbackBar.classList.add('hidden');
    document.body.classList.remove('playback-visible');
  }

  // ---------- Fetch latest boats and render ----------
  function fetchAndRender() {
    if (mode !== 'live') return;

    fetch(API_BASE + '/api/boats')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (boats) {
        // Apply boat filter if a live expedition is selected
        if (liveFilterBoatIds && liveFilterBoatIds.length) {
          boats = boats.filter(function (boat) {
            return liveFilterBoatIds.indexOf(boat.boatId) !== -1;
          });
        }

        var shouldFit = autoFit || firstRender;
        firstRender = false;
        updateBoats(map, boats, { fitBounds: shouldFit });
        hideToast();
        
        // Update last update time
        lastUpdateTime = Date.now();
        updateConnectionStatus();
      })
      .catch(function (err) {
        console.warn('Failed to fetch boats:', err);
        showToast('Unable to reach server – showing cached data');
      });
  }

  // ---------- Handle WebSocket location updates ----------
  function handleWebSocketLocationUpdate(location) {
    if (mode !== 'live') return;

    // Fetch all boats to get the updated state
    // In a more optimized version, we could update just the single boat marker
    fetchAndRender();
    
    // Update last update time
    lastUpdateTime = Date.now();
    updateConnectionStatus();
  }

  // ---------- Fit helpers ----------
  function fitNow() {
    if (!_markerPool) return;
    var markers = [];
    Object.keys(_markerPool).forEach(function (id) {
      markers.push(_markerPool[id].marker);
    });
    if (markers.length) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15));
    }
  }

  // ---------- Connection mode switching ----------
  function switchConnectionMode(mode) {
    connectionMode = mode;
    localStorage.setItem('connection-mode', mode);
    
    // Clear existing polling timer
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    
    // Apply the new mode
    applyConnectionMode();
    
    // Show toast notification
    var modeNames = {
      'websocket': 'WebSocket',
      'polling-60': 'Polling every 1 minute',
      'polling-300': 'Polling every 5 minutes'
    };
    showToast('Switched to ' + modeNames[mode]);
    setTimeout(hideToast, 2000);
  }

  function applyConnectionMode() {
    // Disconnect WebSocket if not in websocket mode
    if (connectionMode !== 'websocket' && window.wsClient) {
      window.wsClient.disconnect();
    }
    
    // Set up polling or websocket based on mode
    if (connectionMode === 'websocket') {
      // WebSocket mode: connect if not already connected
      if (window.wsClient) {
        window.wsClient.connect();
      }
      // Also poll every 60 seconds as fallback
      timer = setInterval(fetchAndRender, 60000);
    } else if (connectionMode === 'polling-60') {
      // Polling mode: 1 minute
      timer = setInterval(fetchAndRender, 60000);
    } else if (connectionMode === 'polling-300') {
      // Polling mode: 5 minutes
      timer = setInterval(fetchAndRender, 300000);
    }
  }

  function updateConnectionStatus() {
    if (!lastUpdateTime) {
      lastUpdateTimeDisplay.textContent = '—';
      connectionIndicator.className = '';
      return;
    }
    
    var now = Date.now();
    var elapsed = now - lastUpdateTime;
    var seconds = Math.floor(elapsed / 1000);
    var minutes = Math.floor(seconds / 60);
    
    var text;
    if (seconds < 5) {
      text = 'Just now';
    } else if (seconds < 60) {
      text = seconds + 's ago';
    } else if (minutes < 60) {
      text = minutes + 'm ago';
    } else {
      var hours = Math.floor(minutes / 60);
      text = hours + 'h ago';
    }
    
    lastUpdateTimeDisplay.textContent = text;
    
    // Update indicator color based on staleness
    connectionIndicator.className = '';
    if (elapsed > 300000) { // 5 minutes
      connectionIndicator.classList.add('error');
    } else if (elapsed > 120000) { // 2 minutes
      connectionIndicator.classList.add('warning');
    }
  }

  // ---------- Expedition selection ----------
  function onExpeditionChange() {
    var value = expeditionSelect.value;
    if (!value) {
      // No expedition selected — back to unfiltered live mode
      currentExpedition = null;
      liveFilterBoatIds = null;
      enterLiveMode();
      return;
    }

    // Parse expedition ID and view type (format: "expeditionId:viewType" or just "expeditionId")
    var parts = value.split(':');
    var id = parts[0];
    var viewType = parts[1] || 'history'; // default to history for old format

    // Fetch expedition details to check if it's live or historical
    fetch('/api/expeditions/' + encodeURIComponent(id))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (expedition) {
        currentExpedition = expedition;
        if (expedition.live && viewType === 'live') {
          // Live expedition — Live view only (no playback bar)
          enterLiveOnlyMode(expedition);
        } else if (expedition.live && viewType === 'playback') {
          // Live expedition — Playback view (historical track with playback controls)
          enterLivePlaybackMode(expedition.expeditionId);
        } else {
          // Historical expedition — enter playback mode
          enterHistoryMode(expedition.expeditionId);
        }
      })
      .catch(function (err) {
        console.warn('Failed to load expedition:', err);
        showToast('Error loading expedition');
        setTimeout(hideToast, 2000);
      });
  }

  function enterLiveFilterMode(expedition) {
    mode = 'live';
    liveFilterBoatIds = expedition.boatIds;

    // Keep live polling active (don't clear timer)
    // Clear any existing playback data first
    Playback.destroy();
    clearTrackLines();

    showToast('Loading expedition history...');

    // Fetch boats and track data
    Promise.all([
      fetch(API_BASE + '/api/boats').then(function (res) { return res.json(); }),
      fetchExpeditionTrack(expedition.expeditionId)
    ])
      .then(function (results) {
        var boats = results[0];
        var result = results[1];
        var tracks = result.tracks;
        var range  = getTrackTimeRange(tracks);

        if (range.min === Infinity) {
          showToast('Tracking: ' + expedition.name + ' (no history yet)');
          setTimeout(hideToast, 2000);
          // Hide playback bar if no track data
          hidePlaybackBar();
          // Continue with live rendering
          fetchAndRender();
          return;
        }

        // Load track into playback engine with boat configurations
        Playback.loadTrack(tracks, range.min, range.max, boats);
        updateSliderRange(range.min, range.max);

        // Show playback bar and fit map to track bounds
        showPlaybackBar();
        fitMapToTracks(tracks);

        showToast('Tracking: ' + expedition.name + ' (live + history)');
        setTimeout(hideToast, 2000);

        // Continue live rendering in background
        fetchAndRender();
      })
      .catch(function (err) {
        console.warn('Failed to load track:', err);
        showToast('Tracking: ' + expedition.name);
        setTimeout(hideToast, 2000);
        // Hide playback bar on error
        hidePlaybackBar();
        // Continue with live rendering
        fetchAndRender();
      });
  }

  function enterLiveOnlyMode(expedition) {
    mode = 'live';
    liveFilterBoatIds = expedition.boatIds;

    // Clear any existing playback data
    Playback.destroy();
    clearTrackLines();

    // Hide playback bar
    hidePlaybackBar();

    // Clear and reset UI
    playBtn.innerHTML = SVG_PLAY;
    timeDisplay.textContent = '--:--';

    // Show loading toast (will be hidden by fetchAndRender on success)
    showToast('Loading ' + expedition.name + ' (Live)');

    // Render current live positions
    fetchAndRender();
  }

  function enterLivePlaybackMode(expeditionId) {
    mode = 'history';
    
    // Pause live polling
    if (timer) { clearInterval(timer); timer = null; }

    // Stop any running playback and reset UI to defaults
    Playback.stop();
    playBtn.innerHTML = SVG_PLAY;
    timeDisplay.textContent = '--:--';
    timeSlider.value = 0;

    // Clear live markers & tracks
    clearBoats();
    clearTrackLines();

    showToast('Loading expedition playback…');

    // Fetch boats and track data
    Promise.all([
      fetch(API_BASE + '/api/boats').then(function (res) { return res.json(); }),
      fetchExpeditionTrack(expeditionId)
    ])
      .then(function (results) {
        hideToast();
        var boats = results[0];
        var result = results[1];
        var tracks = result.tracks;
        var range  = getTrackTimeRange(tracks);

        if (range.min === Infinity) {
          showToast('No track data for this expedition');
          return;
        }

        // Load track with boat configurations
        Playback.loadTrack(tracks, range.min, range.max, boats);
        updateSliderRange(range.min, range.max);

        // Show playback bar and fit map to track bounds
        showPlaybackBar();
        fitMapToTracks(tracks);
      })
      .catch(function (err) {
        console.warn('Failed to load track:', err);
        showToast('Error loading expedition track');
      });
  }

  function enterHistoryMode(expeditionId) {
    mode = 'history';

    // Pause live polling
    if (timer) { clearInterval(timer); timer = null; }

    // Stop any running playback and reset UI to defaults
    Playback.stop();
    playBtn.innerHTML = SVG_PLAY;
    timeDisplay.textContent = '--:--';
    timeSlider.value = 0;

    // Clear live markers & tracks
    clearBoats();
    clearTrackLines();

    showToast('Loading expedition…');

    // Fetch boats and track data
    Promise.all([
      fetch(API_BASE + '/api/boats').then(function (res) { return res.json(); }),
      fetchExpeditionTrack(expeditionId)
    ])
      .then(function (results) {
        hideToast();
        var boats = results[0];
        var result = results[1];
        var tracks = result.tracks;
        var range  = getTrackTimeRange(tracks);

        if (range.min === Infinity) {
          showToast('No track data for this expedition');
          return;
        }

        // Load track with boat configurations
        Playback.loadTrack(tracks, range.min, range.max, boats);
        updateSliderRange(range.min, range.max);

        // Show playback bar and fit map to track bounds
        showPlaybackBar();
        fitMapToTracks(tracks);
      })
      .catch(function (err) {
        console.warn('Failed to load track:', err);
        showToast('Error loading expedition track');
      });
  }

  function enterLiveMode() {
    mode = 'live';
    currentExpedition = null;
    liveFilterBoatIds = null;

    Playback.destroy();

    // Reset UI
    playBtn.innerHTML = SVG_PLAY;
    timeDisplay.textContent = '--:--';
    expeditionSelect.value = '';

    // Hide playback bar
    hidePlaybackBar();

    // Remove history visuals
    clearBoats();
    clearTrackLines();

    // Re-enable auto-fit for the first live render
    autoFit = true;
    firstRender = true;
    fitBtn.classList.add('active');

    // Resume live polling
    fetchAndRender();
    timer = setInterval(fetchAndRender, POLL_INTERVAL);
  }

  // ---------- Playback controls ----------
  function onPlayPause() {
    if (Playback.isPlaying()) {
      Playback.pause();
      playBtn.innerHTML = SVG_PLAY;
    } else {
      Playback.play();
      playBtn.innerHTML = SVG_PAUSE;
    }
  }

  function onSpeedChange() {
    Playback.setSpeed(Number(speedSelect.value));
  }

  function onSliderInput() {
    var frac = Number(timeSlider.value) / 1000;
    var min  = Number(timeSlider.dataset.min);
    var max  = Number(timeSlider.dataset.max);
    var time = min + frac * (max - min);
    Playback.seekTo(time);
  }

  function handleTimeUpdate(currentTime, startTime, endTime) {
    var frac = (endTime - startTime) > 0
      ? (currentTime - startTime) / (endTime - startTime)
      : 0;
    timeSlider.value = Math.round(frac * 1000);
    timeDisplay.textContent = formatDateTime(currentTime);
  }

  function handlePlaybackFinished() {
    playBtn.innerHTML = SVG_PLAY;
  }

  /**
   * Called every playback frame with the interpolated boat positions.
   * When autoFit is enabled, smoothly keeps all boats within the centre
   * ~70 % of the viewport height (15 % padding top/bottom).
   */
  function handlePlaybackRender(boats) {
    if (!autoFit || !boats || !boats.length) return;

    var pts = boats.map(function (b) { return [b.lat, b.lon]; });
    var mapSize = map.getSize();                       // {x, y} in pixels
    var padV = Math.round(mapSize.y * 0.15);           // 15 % top + 15 % bottom = 70 % height for boats
    var padH = Math.round(mapSize.x * 0.15);           // proportional horizontal padding

    map.fitBounds(pts, {
      padding: [padV, padH],
      animate: true,
      duration: 0.35,
      maxZoom: map.getZoom(),                          // never zoom in closer than current
    });
  }

  function updateSliderRange(min, max) {
    timeSlider.dataset.min = min;
    timeSlider.dataset.max = max;
    timeSlider.value = 0;
  }

  // ---------- Helpers ----------

  function fitMapToTracks(tracks) {
    var bounds = [];
    var ids = Object.keys(tracks);
    for (var i = 0; i < ids.length; i++) {
      var locs = tracks[ids[i]];
      for (var j = 0; j < locs.length; j++) {
        bounds.push([locs[j].lat, locs[j].lon]);
      }
    }
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  function formatDateTime(ms) {
    var d = new Date(ms);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getUTCDate()) + '-' + pad(d.getUTCMonth() + 1) + '-' + d.getUTCFullYear()
      + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  }

  // ---------- Tracker functions ----------

  function onTrackToggle() {
    if (Tracker.isTracking()) {
      Tracker.stop();
      trackBtn.classList.remove('active');
      trackBtn.querySelector('span').textContent = 'Track';
      localStorage.removeItem('tracker-active');
      showToast('Tracking stopped');
      setTimeout(hideToast, 2000);
    } else {
      var savedName  = localStorage.getItem('tracker-name');
      var savedPin   = localStorage.getItem('tracker-pin');
      var savedColor = localStorage.getItem('tracker-color');
      if (savedName && savedPin) {
        startTrackerWith(savedName, savedPin, savedColor || '#e74c3c');
      } else {
        showTrackerModal();
      }
    }
  }

  function onTrackerStart() {
    var name  = trackerNameInput.value.trim();
    var pin   = trackerPinInput.value.trim();
    var color = trackerColorInput.value || '#e74c3c';
    
    if (!name) {
      alert('Please enter a boat name');
      trackerNameInput.focus();
      return;
    }
    
    if (!/^[0-9]{6}$/.test(pin)) {
      alert('Please enter a valid 6-digit PIN');
      trackerPinInput.focus();
      return;
    }
    
    localStorage.setItem('tracker-name', name);
    localStorage.setItem('tracker-pin', pin);
    localStorage.setItem('tracker-color', color);
    hideTrackerModal();
    startTrackerWith(name, pin, color);
  }

  function startTrackerWith(name, pin, color) {
    var slug   = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    var boatId = 'phone-' + (slug || 'device');

    Tracker.configure({
      boatId: boatId,
      name:   name,
      color:  color,
      pin:    pin,
      apiKey: apiKey,
    });

    if (Tracker.start()) {
      trackBtn.classList.add('active');
      trackBtn.querySelector('span').textContent = 'Tracking';
      localStorage.setItem('tracker-active', '1');
      var msg = 'Tracking started \u2013 GPS updates every 10 s';
      if (Tracker.hasWakeLock()) {
        msg += '\n\u26A0\uFE0F Wake Lock enabled. Keep screen unlocked for continuous tracking.';
      } else {
        msg += '\nKeep this tab visible and screen unlocked for best results';
      }
      showToast(msg);
      setTimeout(hideToast, 7000);
    } else {
      showToast('Geolocation not available on this device');
      setTimeout(hideToast, 3000);
    }
  }

  function autoStartTracker() {
    var name  = localStorage.getItem('tracker-name');
    var pin   = localStorage.getItem('tracker-pin');
    var color = localStorage.getItem('tracker-color') || '#e74c3c';
    if (name && pin) {
      startTrackerWith(name, pin, color);
    }
  }

  function showTrackerModal() {
    var savedName  = localStorage.getItem('tracker-name');
    var savedPin   = localStorage.getItem('tracker-pin');
    var savedColor = localStorage.getItem('tracker-color');
    if (savedName) trackerNameInput.value = savedName;
    if (savedPin) trackerPinInput.value = savedPin;
    if (savedColor) trackerColorInput.value = savedColor;
    trackerModal.classList.remove('hidden');
  }

  function hideTrackerModal() {
    trackerModal.classList.add('hidden');
  }

  // ---------- Toast helpers ----------
  function showToast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('visible');
  }

  function hideToast() {
    var el = document.getElementById('toast');
    if (!el) return;
    el.classList.remove('visible');
    el.classList.add('hidden');
  }
})();
