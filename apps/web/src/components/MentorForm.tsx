import { useState, type FormEvent } from 'react';
import { MENTOR_COLORS, type Mentor } from '@calllog/shared';
import { ApiError } from '../api/client';
import type { MentorFields } from '../api/hooks';
import { Modal } from './Modal';

const COMMON_ZONES = [
  'Asia/Colombo',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'Australia/Sydney',
];
const MINUTES = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);

interface Props {
  mentor?: Mentor;
  busy?: boolean;
  error?: unknown;
  onSubmit: (v: MentorFields) => void;
  onClose: () => void;
}

export function MentorForm({ mentor, busy, error, onSubmit, onClose }: Props) {
  const [name, setName] = useState(mentor?.name ?? '');
  const [email, setEmail] = useState(mentor?.email ?? '');
  const [phone, setPhone] = useState(mentor?.phone_e164 ?? '');
  const [tags, setTags] = useState((mentor?.expertise ?? []).join(', '));
  const [bio, setBio] = useState(mentor?.bio ?? '');
  const [color, setColor] = useState(mentor?.color ?? '');
  const [timezone, setTimezone] = useState(mentor?.timezone ?? 'Asia/Colombo');
  const [minutes, setMinutes] = useState(mentor?.default_meeting_minutes ?? 60);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Name is required';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'A valid email is required';
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      expertise: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      bio: bio.trim(),
      ...(color ? { color } : {}),
      timezone: timezone.trim(),
      defaultMeetingMinutes: minutes,
    });
  }

  const serverMessage = error instanceof ApiError ? error.message : undefined;

  return (
    <Modal title={mentor ? 'Edit mentor' : 'Add mentor'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div>
          <label className="label" htmlFor="mentor-name">
            Name
          </label>
          <input
            id="mentor-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="mentor-email">
              Email
            </label>
            <input
              id="mentor-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
          </div>
          <div>
            <label className="label" htmlFor="mentor-phone">
              Phone (optional)
            </label>
            <input
              id="mentor-phone"
              type="tel"
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="mentor-tags">
            Expertise (comma-separated)
          </label>
          <input
            id="mentor-tags"
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Python, Data science, Career coaching"
          />
        </div>
        <div>
          <label className="label" htmlFor="mentor-bio">
            Bio
          </label>
          <textarea
            id="mentor-bio"
            className="input"
            rows={2}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="mentor-tz">
              Timezone
            </label>
            <input
              id="mentor-tz"
              className="input"
              list="zones"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
            <datalist id="zones">
              {COMMON_ZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="mentor-minutes">
              Default meeting length
            </label>
            <select
              id="mentor-minutes"
              className="input"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </div>
        </div>
        <fieldset>
          <legend className="label">Calendar color</legend>
          <div className="flex flex-wrap items-center gap-2">
            {MENTOR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? 'border-slate-900' : 'border-transparent'}`}
                style={{ background: c }}
              />
            ))}
            {!mentor && !color && (
              <span className="text-xs text-slate-500">Automatic if you don’t pick one</span>
            )}
          </div>
        </fieldset>
        {serverMessage && (
          <p role="alert" className="text-sm text-red-600">
            {serverMessage}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : mentor ? 'Save mentor' : 'Add mentor'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
