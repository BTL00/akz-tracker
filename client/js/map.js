/* ===== map.js – Leaflet map initialisation with OpenSeaMap overlay ===== */

/**
 * Initialise and return a Leaflet map instance.
 * @param {string} elementId  DOM id of the container div
 * @param {object} [opts]     { lat, lon, zoom }
 * @returns {L.Map}
 */
function initMap(elementId, opts) {
  var lat  = (opts && opts.lat)  || 54.1878;
  var lon  = (opts && opts.lon)  || 12.0915;
  var zoom = (opts && opts.zoom) || 14;

  var map = L.map(elementId, {
    center: [lat, lon],
    zoom: zoom,
    zoomControl: false,
  });

  // --- Zoom control repositioned to bottom-right ---
  L.control.zoom({
    position: 'bottomright'
  }).addTo(map);

  // --- Base layer: OpenStreetMap (always active, never swapped) ---
  var baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });

  baseLayer.addTo(map);
  map._baseLayer = baseLayer;

  // --- Overlay: OpenSeaMap seamark tiles (always on top) ---
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18,
    opacity: 0.8,
    attribution:
      '&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a> contributors',
  }).addTo(map);

  // --- Custom scale bar: nautical miles (tenths) + meters ---
  var NauticalScale = L.Control.Scale.extend({
    onAdd: function (map) {
      var div = L.DomUtil.create('div', 'leaflet-control-scale');
      this._nmScale = L.DomUtil.create('div', 'leaflet-control-scale-line', div);
      this._mScale  = L.DomUtil.create('div', 'leaflet-control-scale-line', div);
      this._map = map;
      map.on('zoomend move', this._updateNM, this);
      this._updateNM();
      return div;
    },
    onRemove: function (map) {
      map.off('zoomend move', this._updateNM, this);
    },
    _updateNM: function () {
      var map = this._map;
      var y = map.getSize().y / 2;
      var maxMeters = map.distance(
        map.containerPointToLatLng([0, y]),
        map.containerPointToLatLng([this.options.maxWidth, y])
      );
      if (!maxMeters) return;
      // Nautical miles line
      var maxNM = maxMeters / 1852;
      var nmVal = this._roundNM(maxNM);
      var nmWidth = Math.round(this.options.maxWidth * nmVal / maxNM);
      this._nmScale.style.width = nmWidth + 'px';
      this._nmScale.innerHTML = nmVal < 1 ? (nmVal.toFixed(1) + ' nm') : (nmVal + ' nm');
      // Meters line (same pixel width as NM line, relabelled)
      var mVal = Math.round(nmVal * 1852);
      var mLabel = mVal >= 1000 ? (mVal / 1000) + ' km' : mVal + ' m';
      this._mScale.style.width = nmWidth + 'px';
      this._mScale.innerHTML = mLabel;
    },
    _roundNM: function (max) {
      if (max < 0.15) return 0.1;
      if (max < 0.35) return 0.2;
      if (max < 0.75) return 0.5;
      var p = Math.pow(10, Math.floor(Math.log10(max)));
      var d = max / p;
      return p * (d >= 5 ? 5 : d >= 2 ? 2 : 1);
    },
  });
  new NauticalScale({ maxWidth: 150, position: 'bottomleft' }).addTo(map);

  // --- Dark mode: CSS filter on the tile pane (keeps OpenSeaMap visible) ---
  map.setDarkMode = function(isDark) {
    var tilePanes = this.getContainer().querySelectorAll('.leaflet-tile-pane');
    tilePanes.forEach(function(pane) {
      if (isDark) {
        pane.style.filter = 'brightness(0.65) contrast(1.1) saturate(0.8)';
      } else {
        pane.style.filter = '';
      }
    });
  };

  return map;
}
