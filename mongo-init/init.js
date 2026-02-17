// mongo-init/init.js
// Runs automatically on first MongoDB start (docker-entrypoint-initdb.d).
// Creates indexes and seeds test data.
// To re-seed: docker-compose down -v && docker-compose up -d

db = db.getSiblingDB('akz-tracker');

// --------------- Indexes ---------------
db.locations.createIndex({ boatId: 1, timestamp: -1 });
db.expeditions.createIndex({ expeditionId: 1 }, { unique: true });
db.boats.createIndex({ boatId: 1 }, { unique: true });
db.boats.createIndex({ pin: 1 });
db.boats.createIndex({ apiKey: 1 }, { unique: true });

// --------------- Helpers ---------------
function clampCourse(c) {
  while (c < 0) c += 360;
  while (c >= 360) c -= 360;
  return Math.round(c);
}

// --------------- Boats ---------------
var now = new Date();
var boats = [
  { id: 'boat-alfa',    name: 'Alfa',    mmsi: '211000001', color: '#2196F3', baseLat: 54.1878, baseLon: 12.0915, course: 45,  speed: 5.5 },
  { id: 'boat-bravo',   name: 'Bravo',   mmsi: '211000002', color: '#FF9800', baseLat: 54.1850, baseLon: 12.0980, course: 120, speed: 4.2 },
  { id: 'boat-charlie', name: 'Charlie', mmsi: '211000003', color: '#4CAF50', baseLat: 54.1910, baseLon: 12.0840, course: 270, speed: 6.0 },
];

// --------------- Expedition 1: Morning Regatta ---------------
// 15 minutes, all 3 boats, 1-minute samples
var exp1Start = new Date(now.getTime() - 90 * 60 * 1000); // 1h30m ago
var exp1End   = new Date(exp1Start.getTime() + 15 * 60 * 1000);
var INTERVAL  = 60 * 1000; // 1 minute

var docs = [];

// Generate tracks for expedition 1
for (var b = 0; b < boats.length; b++) {
  var boat = boats[b];
  var lat = boat.baseLat;
  var lon = boat.baseLon;
  var course = boat.course;
  var speed  = boat.speed;
  var steps  = Math.floor((exp1End.getTime() - exp1Start.getTime()) / INTERVAL);

  for (var i = 0; i <= steps; i++) {
    var t = new Date(exp1Start.getTime() + i * INTERVAL);
    var rad = course * Math.PI / 180;
    // ~0.0003 deg per step ≈ ~30 m movement per minute
    lat += 0.0003 * Math.cos(rad);
    lon += 0.0003 * Math.sin(rad);
    // Gentle course drift
    course = clampCourse(course + (Math.random() - 0.5) * 8);
    speed  = Math.max(1, boat.speed + (Math.random() - 0.5) * 3);

    docs.push({
      boatId: boat.id,
      name: boat.name,
      mmsi: boat.mmsi,
      color: boat.color,
      lat: lat,
      lon: lon,
      course: clampCourse(course),
      speed: Math.round(speed * 10) / 10,
      status: 'Under way',
      source: 'tracker',
      timestamp: t,
    });
  }
}

// --------------- Expedition 2: Afternoon Cruise ---------------
// 12 minutes, Alfa + Charlie only, 1-minute samples
var exp2Start = new Date(now.getTime() - 30 * 60 * 1000); // 30 min ago
var exp2End   = new Date(exp2Start.getTime() + 12 * 60 * 1000);
var exp2Boats = [boats[0], boats[2]]; // Alfa + Charlie

for (var b2 = 0; b2 < exp2Boats.length; b2++) {
  var boat2 = exp2Boats[b2];
  // Start from slightly offset position for variety
  var lat2 = boat2.baseLat + 0.003;
  var lon2 = boat2.baseLon - 0.002;
  var course2 = clampCourse(boat2.course + 90); // rotated 90°
  var speed2  = boat2.speed;
  var steps2  = Math.floor((exp2End.getTime() - exp2Start.getTime()) / INTERVAL);

  for (var j = 0; j <= steps2; j++) {
    var t2 = new Date(exp2Start.getTime() + j * INTERVAL);
    var rad2 = course2 * Math.PI / 180;
    lat2 += 0.0003 * Math.cos(rad2);
    lon2 += 0.0003 * Math.sin(rad2);
    course2 = clampCourse(course2 + (Math.random() - 0.5) * 6);
    speed2  = Math.max(1, boat2.speed + (Math.random() - 0.5) * 2.5);

    docs.push({
      boatId: boat2.id,
      name: boat2.name,
      mmsi: boat2.mmsi,
      color: boat2.color,
      lat: lat2,
      lon: lon2,
      course: clampCourse(course2),
      speed: Math.round(speed2 * 10) / 10,
      status: 'Under way',
      source: 'tracker',
      timestamp: t2,
    });
  }
}

// --------------- "Live" latest position for each boat ---------------
// One fresh reading per boat at ~now so they appear on the live map
boats.forEach(function (boat) {
  docs.push({
    boatId: boat.id,
    name: boat.name,
    mmsi: boat.mmsi,
    color: boat.color,
    lat: boat.baseLat + 0.005,
    lon: boat.baseLon + 0.005,
    course: boat.course,
    speed: boat.speed,
    status: 'Under way',
    source: 'tracker',
    timestamp: now,
  });
});

if (docs.length) db.locations.insertMany(docs);

// --------------- Seed boats collection ---------------
db.boats.insertMany([
  {
    boatId: 'boat-alfa',
    name: 'Alfa',
    color: '#2196F3',
    mmsi: '211000001',
    pin: '111111',
    apiKey: 'aaaaaaaa-1111-1111-1111-111111111111',
    createdAt: new Date(),
  },
  {
    boatId: 'boat-bravo',
    name: 'Bravo',
    color: '#FF9800',
    mmsi: '211000002',
    pin: '222222',
    apiKey: 'bbbbbbbb-2222-2222-2222-222222222222',
    createdAt: new Date(),
  },
  {
    boatId: 'boat-charlie',
    name: 'Charlie',
    color: '#4CAF50',
    mmsi: '211000003',
    pin: '333333',
    apiKey: 'cccccccc-3333-3333-3333-333333333333',
    createdAt: new Date(),
  },
]);

// --------------- Seed expeditions ---------------
db.expeditions.insertMany([
  {
    expeditionId: 'morning-regatta',
    name: 'Morning Regatta',
    boatIds: ['boat-alfa', 'boat-bravo', 'boat-charlie'],
    live: false,
    startDate: exp1Start,
    endDate: exp1End,
    description: 'Demo regatta with 3 boats, 15-minute race.',
    createdAt: new Date(),
  },
  {
    expeditionId: 'afternoon-cruise',
    name: 'Afternoon Cruise',
    boatIds: ['boat-alfa', 'boat-charlie'],
    live: true,
    startDate: exp2Start,
    endDate: exp2End,
    description: 'Demo cruise with 2 boats, 12 minutes.',
    createdAt: new Date(),
  },
]);

print('✔  akz-tracker DB initialised: indexes created, 3 boats (with PINs) + 2 expeditions seeded.');
