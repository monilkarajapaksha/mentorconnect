import { STATUS_COLORS, STATUS_LABELS, type CallStatus } from '@calllog/shared';

export function StatusBadge({ status }: { status: CallStatus | string | null | undefined }) {
  if (!status) {
    return (
      <span className="inline-block rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
        No calls yet
      </span>
    );
  }
  const s = status as CallStatus;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
        STATUS_COLORS[s] ?? ''
      }`}
    >
      {STATUS_LABELS[s] ?? status}
    </span>
  );
}
