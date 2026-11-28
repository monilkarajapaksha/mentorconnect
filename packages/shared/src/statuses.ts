/** Single source of truth for call statuses. Used by API, DB checks and UI. */
const FOLLOW_UP_COUNT = 10;

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'] as const;

export const FOLLOW_UP_STATUSES = [
  'follow_up_1',
  'follow_up_2',
  'follow_up_3',
  'follow_up_4',
  'follow_up_5',
  'follow_up_6',
  'follow_up_7',
  'follow_up_8',
  'follow_up_9',
  'follow_up_10',
] as const;

export const CALL_STATUSES = [
  'declined',
  'rejected_offer',
  ...FOLLOW_UP_STATUSES,
  'scheduled',
  'order_confirmed',
  'payment_done',
  'session_done',
  'feedback_received',
] as const;

export type CallStatus = (typeof CALL_STATUSES)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const STATUS_LABELS: Record<CallStatus, string> = {
  declined: 'Not answered',
  rejected_offer: 'Rejected the offer',
  follow_up_1: `${ORDINALS[0]} Follow-up`,
  follow_up_2: `${ORDINALS[1]} Follow-up`,
  follow_up_3: `${ORDINALS[2]} Follow-up`,
  follow_up_4: `${ORDINALS[3]} Follow-up`,
  follow_up_5: `${ORDINALS[4]} Follow-up`,
  follow_up_6: `${ORDINALS[5]} Follow-up`,
  follow_up_7: `${ORDINALS[6]} Follow-up`,
  follow_up_8: `${ORDINALS[7]} Follow-up`,
  follow_up_9: `${ORDINALS[8]} Follow-up`,
  follow_up_10: `${ORDINALS[9]} Follow-up`,
  scheduled: 'Scheduled',
  order_confirmed: 'Order Confirmed',
  payment_done: 'Payment Done',
  session_done: 'Session Done',
  feedback_received: 'Feedback Received',
};

/** Tailwind classes for the badge of each status. */
export const STATUS_COLORS: Record<CallStatus, string> = {
  declined: 'bg-slate-100 text-slate-700 border-slate-300',
  rejected_offer: 'bg-red-100 text-red-800 border-red-300',
  follow_up_1: 'bg-amber-50 text-amber-800 border-amber-200',
  follow_up_2: 'bg-amber-100 text-amber-800 border-amber-200',
  follow_up_3: 'bg-amber-100 text-amber-900 border-amber-300',
  follow_up_4: 'bg-amber-200 text-amber-900 border-amber-300',
  follow_up_5: 'bg-amber-200 text-amber-900 border-amber-400',
  follow_up_6: 'bg-orange-200 text-orange-900 border-orange-300',
  follow_up_7: 'bg-orange-200 text-orange-900 border-orange-400',
  follow_up_8: 'bg-orange-300 text-orange-900 border-orange-400',
  follow_up_9: 'bg-orange-300 text-orange-950 border-orange-500',
  follow_up_10: 'bg-orange-400 text-orange-950 border-orange-500',
  scheduled: 'bg-blue-100 text-blue-800 border-blue-300',
  order_confirmed: 'bg-green-100 text-green-800 border-green-300',
  payment_done: 'bg-green-200 text-green-900 border-green-400',
  session_done: 'bg-emerald-200 text-emerald-900 border-emerald-400',
  feedback_received: 'bg-emerald-300 text-emerald-950 border-emerald-500',
};

export function isCallStatus(value: string): value is CallStatus {
  return (CALL_STATUSES as readonly string[]).includes(value);
}

export function isFollowUp(status: string | null | undefined): status is FollowUpStatus {
  return !!status && (FOLLOW_UP_STATUSES as readonly string[]).includes(status);
}

/** Status to pre-select when logging a new call, given the client's last call status. */
export function suggestNextStatus(lastStatus: string | null | undefined): CallStatus {
  if (!isFollowUp(lastStatus)) return FOLLOW_UP_STATUSES[0];
  const idx = FOLLOW_UP_STATUSES.indexOf(lastStatus);
  return FOLLOW_UP_STATUSES[Math.min(idx + 1, FOLLOW_UP_COUNT - 1)] ?? lastStatus;
}

/** SQL fragment used by migrations: 'a','b',... */
export function statusSqlList(): string {
  return CALL_STATUSES.map((s) => `'${s}'`).join(', ');
}
