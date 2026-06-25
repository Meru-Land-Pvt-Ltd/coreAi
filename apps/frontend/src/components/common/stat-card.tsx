type Props = {
  label: string;
  value: string;
  hint?: string;
};

export function StatCard({ label, value, hint }: Props) {
  return (
    <div data-testid="components-common-stat-card-div-1" className="rounded-3xl soft-card p-5">
      <p data-testid="components-common-stat-card-p-1" className="text-sm text-orange-700">{label}</p>
      <h2 data-testid="components-common-stat-card-h2-1" className="mt-2 text-3xl font-bold text-orange-950">{value}</h2>
      {hint ? <p data-testid="components-common-stat-card-p-2" className="mt-2 text-xs text-orange-700/70">{hint}</p> : null}
    </div>
  );
}