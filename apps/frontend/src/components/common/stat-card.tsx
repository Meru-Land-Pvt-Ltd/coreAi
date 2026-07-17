type Props = {
  label: string;
  value: string;
  hint?: string;
};

export function StatCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500" data-testid="common-stat-card-label-text">{label}</p>
      <h2 className="mt-2 text-3xl font-bold text-slate-950" data-testid="common-stat-card-2-3xl-orange-950-heading">{value}</h2>
      {hint ? <p className="mt-2 text-xs text-slate-400" data-testid="common-stat-card-hint-text">{hint}</p> : null}
    </div>
  );
}
