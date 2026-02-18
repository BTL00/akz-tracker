/* Track fetcher worker - loads expedition data off main thread */

self.onmessage = function (event) {
  var expeditionId = event.data;
  
  fetch('/api/expeditions/' + encodeURIComponent(expeditionId) + '/track')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      self.postMessage({ success: true, data: data });
    })
    .catch(function (err) {
      self.postMessage({ success: false, error: err.message });
    });
};
