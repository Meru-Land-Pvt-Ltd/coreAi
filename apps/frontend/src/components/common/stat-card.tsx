type Props = {
  label: string;
  value: string;
  hint?: string;
};

export function StatCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-3xl soft-card p-5">
      <p className="text-sm text-orange-700">{label}</p>
      <h2 className="mt-2 text-3xl font-bold text-orange-950">{value}</h2>
      {hint ? <p className="mt-2 text-xs text-orange-700/70">{hint}</p> : null}
    </div>
  );
}