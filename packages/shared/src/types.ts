import type { CallStatus } from './statuses';

export type Direction = 'incoming' | 'outgoing';

export interface Client {
  id: string;
  phone_e164: string;
  name: string;
  company: string | null;
  email: string | null;
  notes: string | null;
  current_status: CallStatus | null;
  last_call_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Call {
  id: string;
  client_id: string;
  direction: Direction;
  status: CallStatus;
  summary: string;
  scheduled_at: string | null;
  notes: string | null;
  created_by_admin_id: string | null;
  updated_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
  edited?: boolean;
}

export interface Admin {
  id: string;
  email: string;
  name: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type LookupResponse =
  | { found: true; client: Client; calls: Call[]; suggestedStatus: CallStatus }
  | { found: false; normalizedPhone: string };
