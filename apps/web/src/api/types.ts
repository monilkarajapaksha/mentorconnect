import type {
  Admin,
  AvailabilityBlock,
  Call,
  CallStatus,
  Client,
  MeetingWithRefs,
  Mentor,
  MentorTimeOff,
  Paginated,
  Slot,
} from '@calllog/shared';

export type ClientDetail = { client: Client; calls: Call[]; suggestedStatus: CallStatus };
export type Lookup = ({ found: true } & ClientDetail) | { found: false; normalizedPhone: string };
export type ClientList = Paginated<Client> & { statusCounts: Record<string, number> };
export type CallWithClient = Call & { client_name: string; client_phone: string };
export type ScheduledItem = CallWithClient & { overdue: boolean };
export type Stats = { total: number; noCalls: number; counts: Record<string, number> };
export type CallHistoryItem = {
  id: string;
  changed_at: string;
  admin_name: string | null;
  changes: Record<string, { old: unknown; new: unknown }>;
};
export type { Admin };

export type MentorListItem = Mentor & { today_meetings: number; next_free_slot: Slot | null };
export type MentorDetailResponse = {
  mentor: Mentor;
  availability: AvailabilityBlock[];
  upcomingScheduledMeetings: number;
};
export type MeetingHistoryEntry = {
  id: string;
  changed_at: string;
  action: 'created' | 'updated' | 'rescheduled' | 'status_changed' | 'cancelled';
  admin_name: string | null;
  changes: Record<string, { old: unknown; new: unknown } | string[]>;
};
export type MeetingDetail = {
  meeting: MeetingWithRefs;
  mentor: Mentor;
  client: Client;
  clientCurrentStatus: CallStatus | null;
  recentCalls: Call[];
  history: MeetingHistoryEntry[];
};
export type ClientMeetings = { upcoming: MeetingWithRefs[]; past: MeetingWithRefs[] };
export type FreeSlots = {
  mentorId: string;
  timezone: string;
  duration: number;
  step: number;
  slots: Slot[];
};
export type { AvailabilityBlock, MeetingWithRefs, Mentor, MentorTimeOff, Slot };
