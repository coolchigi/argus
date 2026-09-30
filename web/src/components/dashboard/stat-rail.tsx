import { StatTile } from "@/components/argus/stat-tile";
import { actionSub, type DashboardStats } from "@/components/dashboard/derive";

function Placeholder() {
  return (
    <>
      <span aria-hidden className="block h-[30px] w-10 rounded-sm bg-hairline" />
      <span className="sr-only">Loading</span>
    </>
  );
}

/**
 * Four linked tiles. Every number is derived from /policy-events, /impacts and
 * /briefs. `stats` is null while any of them is still loading.
 */
export function StatRail({ stats, monthLabel }: { stats: DashboardStats | null; monthLabel: string }) {
  const v = (n: number | undefined) => (stats ? n : <Placeholder />);
  return (
    <ul aria-label="This month at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <li>
        <StatTile
          href="/caseload?filter=affected"
          label="Clients affected"
          value={v(stats?.clientsAffected)}
          sub={stats ? `${stats.clientsWaiting} still waiting on a brief` : " "}
          className="h-full"
        />
      </li>
      <li>
        <StatTile
          href="/impacts"
          label="Action required"
          value={v(stats?.actionRequired)}
          sub={stats ? actionSub(stats) : " "}
          accent="brand"
          className="h-full"
        />
      </li>
      <li>
        <StatTile
          href="/policy-events?period=this-month"
          label="Policy events this month"
          value={v(stats?.eventsThisMonth)}
          sub={monthLabel}
          className="h-full"
        />
      </li>
      <li>
        <StatTile
          href="/impacts?tab=corrections"
          label="Corrections filed"
          value={v(stats?.correctionsFiled)}
          sub="Across every event"
          className="h-full"
        />
      </li>
    </ul>
  );
}
