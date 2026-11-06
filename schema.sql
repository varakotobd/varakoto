CREATE TABLE IF NOT EXISTS fare_reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 origin TEXT NOT NULL,
 destination TEXT NOT NULL,
 origin_lat REAL, origin_lon REAL, destination_lat REAL, destination_lon REAL,
 fare INTEGER NOT NULL CHECK(fare BETWEEN 1 AND 5000),
 travel_date TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 vehicle_type TEXT NOT NULL DEFAULT 'rickshaw' CHECK(vehicle_type IN ('rickshaw','auto','cng','easybike')),
 fare_basis TEXT,
 vehicle_variant TEXT,
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

-- Local fares supplied by the Vara Koto owner, without trip dates.
-- Not official, not automatically counted as verified passenger reports.
CREATE TABLE IF NOT EXISTS curated_fares (
 route_key TEXT NOT NULL,
 vehicle_type TEXT NOT NULL CHECK(vehicle_type IN ('rickshaw','auto')),
 fare INTEGER NOT NULL CHECK(fare BETWEEN 1 AND 5000),
 fare_basis TEXT NOT NULL CHECK(fare_basis IN ('per_ride','per_person')),
 vehicle_variant TEXT NOT NULL,
 source_note TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(route_key,vehicle_type)
);
INSERT OR IGNORE INTO curated_fares VALUES('newmarket_chapain','rickshaw',20,'per_ride','rickshaw','');
INSERT OR IGNORE INTO curated_fares VALUES('newmarket_chapain','auto',10,'per_person','battery_auto','');
INSERT OR IGNORE INTO curated_fares VALUES('newmarket_dewga','rickshaw',40,'per_ride','rickshaw','Origin inferred as New Market; please confirm.');
INSERT OR IGNORE INTO curated_fares VALUES('newmarket_dewga','auto',20,'per_person','battery_auto','Origin inferred as New Market; please confirm.');
INSERT OR IGNORE INTO curated_fares VALUES('chapain_crp','rickshaw',20,'per_ride','rickshaw','');
INSERT OR IGNORE INTO curated_fares VALUES('chapain_radio_colony','rickshaw',30,'per_ride','rickshaw','');
INSERT OR IGNORE INTO curated_fares VALUES('shyamoli_shia','rickshaw',30,'per_ride','rickshaw','');
INSERT OR IGNORE INTO curated_fares VALUES('shyamoli_shia','auto',10,'per_person','leguna','');
