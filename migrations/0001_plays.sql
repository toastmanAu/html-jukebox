-- Anonymous per-load IDs make retried requests idempotent. No visitor identifiers.
CREATE TABLE play_events (
  load_id TEXT PRIMARY KEY,
  demo_id TEXT NOT NULL
);
CREATE TABLE play_counts (
  demo_id TEXT PRIMARY KEY,
  plays INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER count_new_play AFTER INSERT ON play_events BEGIN
  INSERT INTO play_counts (demo_id, plays) VALUES (NEW.demo_id, 1)
  ON CONFLICT(demo_id) DO UPDATE SET plays = plays + 1;
END;
