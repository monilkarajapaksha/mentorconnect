-- Mentor Calendar module: mentors, weekly availability, time off, meetings, meeting history.

CREATE TABLE mentors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_e164 TEXT,
  expertise TEXT NOT NULL DEFAULT '[]', -- JSON array of tags
  bio TEXT,
  color TEXT NOT NULL, -- '#rrggbb', used on the calendar
  timezone TEXT NOT NULL DEFAULT 'Asia/Colombo',
  default_meeting_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (default_meeting_minutes BETWEEN 15 AND 480),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE mentor_availability (
  id TEXT PRIMARY KEY,
  mentor_id TEXT NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday, in the mentor's timezone
  start_time TEXT NOT NULL, -- 'HH:MM'
  end_time TEXT NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX idx_availability_mentor ON mentor_availability(mentor_id, weekday);

CREATE TABLE mentor_time_off (
  id TEXT PRIMARY KEY,
  mentor_id TEXT NOT NULL REFERENCES mentors(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL, -- UTC ISO
  end_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX idx_time_off_mentor ON mentor_time_off(mentor_id, start_at);

CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  mentor_id TEXT NOT NULL REFERENCES mentors(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  start_at TEXT NOT NULL, -- UTC ISO
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  mode TEXT NOT NULL CHECK (mode IN ('online', 'in_person', 'phone')),
  location_or_link TEXT,
  agenda TEXT,
  notes TEXT, -- mentor/admin notes after the session
  external_event_id TEXT, -- reserved for a future Google/Outlook calendar sync
  created_by_admin_id TEXT REFERENCES admins(id),
  updated_by_admin_id TEXT REFERENCES admins(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX idx_meetings_mentor_start ON meetings(mentor_id, start_at);
CREATE INDEX idx_meetings_client_start ON meetings(client_id, start_at);
CREATE INDEX idx_meetings_start ON meetings(start_at);

CREATE TABLE meeting_history (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  admin_id TEXT REFERENCES admins(id),
  changed_at TEXT NOT NULL,
  action TEXT NOT NULL, -- created | updated | rescheduled | status_changed | cancelled
  changes TEXT NOT NULL -- JSON: {"field": {"old": .., "new": ..}, "forced": ["outside_availability"]}
);
CREATE INDEX idx_meeting_history ON meeting_history(meeting_id, changed_at DESC);

-- Lets a call entry created from a booking link back to its meeting.
ALTER TABLE calls ADD COLUMN meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL;
