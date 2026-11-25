CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  phone_e164 TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  notes TEXT,
  current_status TEXT,
  last_call_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_clients_status ON clients(current_status);
CREATE INDEX idx_clients_last_call ON clients(last_call_at);

CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  status TEXT NOT NULL CHECK (status IN ('declined', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5', 'follow_up_6', 'follow_up_7', 'follow_up_8', 'follow_up_9', 'follow_up_10', 'scheduled', 'order_confirmed', 'payment_done', 'session_done', 'feedback_received')),
  summary TEXT NOT NULL,
  scheduled_at TEXT,
  notes TEXT,
  created_by_admin_id TEXT REFERENCES admins(id),
  updated_by_admin_id TEXT REFERENCES admins(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL)
);
CREATE INDEX idx_calls_client_created ON calls(client_id, created_at DESC);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_scheduled ON calls(scheduled_at);

CREATE TABLE call_history (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  admin_id TEXT REFERENCES admins(id),
  changed_at TEXT NOT NULL,
  changes TEXT NOT NULL -- JSON: {"field": {"old": ..., "new": ...}}
);
CREATE INDEX idx_call_history_call ON call_history(call_id, changed_at DESC);
