CREATE TABLE IF NOT EXISTS fare_reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 origin TEXT NOT NULL,
 destination TEXT NOT NULL,
 origin_lat REAL, origin_lon REAL, destination_lat REAL, destination_lon REAL,
 fare INTEGER NOT NULL CHECK(fare BETWEEN 1 AND 5000),
 travel_date TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 vehicle_type TEXT NOT NULL DEFAULT 'rickshaw' CHECK(vehicle_type IN ('rickshaw','auto','cng','easybike')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_route_status ON fare_reports(origin,destination,status);
CREATE INDEX IF NOT EXISTS idx_pending ON fare_reports(status,created_at);
CREATE TABLE IF NOT EXISTS submission_limits (
 fingerprint TEXT NOT NULL,
 day TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY (fingerprint,day)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_route ON fare_reports(vehicle_type,origin,destination,status);
