import { TIER_LABEL, tierChipStyle } from "@/lib/ui";

export default function TierChip({
  tier,
  size = "sm",
}: {
  tier: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[2px] border font-semibold uppercase tracking-wide ${
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs"
      }`}
      style={tierChipStyle(tier)}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: tierChipStyle(tier).color as string }}
        aria-hidden
      />
      {TIER_LABEL[tier] ?? tier}
    </span>
  );
}
