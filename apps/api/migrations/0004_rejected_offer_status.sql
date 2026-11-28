-- Adds the 'rejected_offer' call status ("Rejected the offer").
-- SQLite cannot alter a CHECK constraint, so the calls table is rebuilt.
-- call_history cascades on calls deletes, so it is backed up and restored.
CREATE TABLE call_history_bak AS SELECT * FROM call_history;

CREATE TABLE calls_new (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  status TEXT NOT NULL CHECK (status IN ('declined', 'rejected_offer', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5', 'follow_up_6', 'follow_up_7', 'follow_up_8', 'follow_up_9', 'follow_up_10', 'scheduled', 'order_confirmed', 'payment_done', 'session_done', 'feedback_received')),
  summary TEXT NOT NULL,
  scheduled_at TEXT,
  notes TEXT,
  created_by_admin_id TEXT REFERENCES admins(id),
  updated_by_admin_id TEXT REFERENCES admins(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL)
);
INSERT INTO calls_new (id, client_id, direction, status, summary, scheduled_at, notes, created_by_admin_id, updated_by_admin_id, created_at, updated_at, meeting_id)
  SELECT id, client_id, direction, status, summary, scheduled_at, notes, created_by_admin_id, updated_by_admin_id, created_at, updated_at, meeting_id FROM calls;

DROP TABLE calls;
ALTER TABLE calls_new RENAME TO calls;
CREATE INDEX idx_calls_client_created ON calls(client_id, created_at DESC);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_scheduled ON calls(scheduled_at);

INSERT OR IGNORE INTO call_history SELECT * FROM call_history_bak;
DROP TABLE call_history_bak;
