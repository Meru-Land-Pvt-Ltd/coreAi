import { ArchitectCard, ArchitectEmptyState, ArchitectPageHeader } from "@/components/architect/ui/architect-ui";

export function ArchitectPayoutsView() {
  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Payouts"
        title="Payouts"
        description="Payout data will appear here after real marketplace payments are connected."
      />

      <ArchitectCard>
        <ArchitectEmptyState
          title="No payout data yet"
          text="There are no live payout records available from the backend yet."
          actionLabel="View agents"
          actionHref="/architect/agents"
        />
      </ArchitectCard>
    </div>
  );
}
