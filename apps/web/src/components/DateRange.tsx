export function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (v: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="flex items-center gap-1">
        <span className="text-slate-600">From</span>
        <input
          type="date"
          className="input !w-auto"
          value={from}
          onChange={(e) => onChange({ from: e.target.value, to })}
        />
      </label>
      <label className="flex items-center gap-1">
        <span className="text-slate-600">To</span>
        <input
          type="date"
          className="input !w-auto"
          value={to}
          onChange={(e) => onChange({ from, to: e.target.value })}
        />
      </label>
    </div>
  );
}
