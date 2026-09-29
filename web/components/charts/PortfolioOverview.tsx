/* Portfolio overview — the dashboard section for the home page. Server
 * component: it receives data already queried in the page (server) and lays
 * out the seven charts. The filter bar is the only client island (it drives
 * the URL that the server re-queries on), so it sits in a Suspense boundary. */
import { Suspense } from "react";

import KpiStrip from "@/components/charts/KpiStrip";
import TierDonut from "@/components/charts/TierDonut";
import WeeklyTrend from "@/components/charts/WeeklyTrend";
import RuleDensity from "@/components/charts/RuleDensity";
import BarrierFailures from "@/components/charts/BarrierFailures";
import SiteRuleHeatmap from "@/components/charts/SiteRuleHeatmap";
import ModelReview from "@/components/charts/ModelReview";
import OverviewFilterBar from "@/components/charts/OverviewFilterBar";
import type {
  BarrierData,
  HeatmapData,
  KpiStripData,
  ModelReviewData,
  OverviewFilter,
  RuleDensityData,
  TierMixData,
  WeeklyTrendData,
} from "@/db/queries/overview";

type Props = {
  filter: OverviewFilter;
  siteNames: string[];
  kpi: KpiStripData;
  tier: TierMixData;
  trend: WeeklyTrendData;
  rules: RuleDensityData;
  barriers: BarrierData;
  heat: HeatmapData;
  review: ModelReviewData;
};

export default function PortfolioOverview({ filter, siteNames, kpi, tier, trend, rules, barriers, heat, review }: Props) {
  const { site, weeks } = filter;
  return (
    <section aria-labelledby="portfolio-overview-title" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-micro" style={{ color: "var(--brand)" }}>
            Portfolio overview
          </p>
          <h2 className="page-title mt-1 text-[22px]">
            What the <em>whole corpus</em> is telling us
          </h2>
        </div>
        <p className="max-w-[46ch] text-xs leading-5 text-[var(--faint)]">
          Every chart reads the reports table through the filters below. Click any bar,
          slice, point, or cell to open the matching reports in the feed.
        </p>
      </div>

      <div className="mt-4">
        <Suspense fallback={<div className="h-10 rounded-[3px] border border-[var(--line)] bg-[var(--ink-900)]" aria-hidden />}>
          <OverviewFilterBar sites={siteNames} />
        </Suspense>
      </div>

      <div className="mt-5">
        <KpiStrip data={kpi} site={site} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <TierDonut data={tier} site={site} weeks={weeks} />
        <WeeklyTrend data={trend} site={site} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <RuleDensity data={rules} site={site} />
        <BarrierFailures data={barriers} site={site} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <SiteRuleHeatmap data={heat} site={site} weeks={weeks} />
        <ModelReview data={review} />
      </div>
    </section>
  );
}
