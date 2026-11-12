/**
 * checkMaterialReadiness: the core planning calculation.
 *
 * Plain code with no database or AI, so it can be tested on its own
 * (see readiness.test.ts). The model never does this arithmetic.
 *
 * How it works, week by week:
 * 1. Inbound purchase orders land at the start of their expected week.
 * 2. Builds compete for stock in this order: priority (1 first), then the
 *    week they were originally planned (slipped builds first), then id.
 * 3. A build is READY if its site has every component on its bill of
 *    materials for all its racks. Ready builds consume the stock.
 * 4. A build that is SHORT consumes nothing (it cannot start). It stays in
 *    the queue and is retried each following week. The week it can finally
 *    be built is its recovery week.
 *
 * The whole plan is simulated so recovery can be found beyond the
 * requested horizon, but only builds inside the horizon are reported.
 */
import {
  COMPONENT_NAMES,
  SITE_NAMES,
  type BomLine,
  type Build,
  type InboundRow,
  type InventoryRow
} from "./data";

export interface PlanningData {
  builds: Build[];
  bom: BomLine[];
  inventory: InventoryRow[];
  inbound: InboundRow[];
}

export interface Shortage {
  component: string;
  componentName: string;
  needed: number;
  available: number;
  shortBy: number;
}

export interface BuildReadiness {
  id: string;
  week: number;
  site: string;
  rackType: string;
  racks: number;
  destination: string;
  priority: number;
  status: "ready" | "short";
  shortages: Shortage[]; // empty when ready
  recoveryWeek: number | null; // short builds only; null = not within plan
  weeksLate: number | null; // recoveryWeek minus planned week
}

export interface ReadinessResult {
  horizon: string;
  buildsChecked: number;
  readyCount: number;
  shortCount: number;
  summary: string;
  builds: BuildReadiness[];
  note: string;
}

const key = (site: string, component: string) => `${site}|${component}`;

export function checkMaterialReadiness(
  data: PlanningData,
  weeks: number
): ReadinessResult {
  // Stock on hand, keyed by site and component.
  const stock = new Map<string, number>();
  for (const row of data.inventory) {
    stock.set(key(row.site, row.component), row.on_hand);
  }

  // Simulate to the last week that has any build or inbound shipment.
  const lastWeek = Math.max(
    weeks,
    ...data.builds.map((b) => b.week),
    ...data.inbound.map((p) => p.expected_week)
  );

  const needsFor = (b: Build) =>
    data.bom
      .filter((line) => line.rack_type === b.rack_type)
      .map((line) => ({
        component: line.component,
        needed: line.qty_per_rack * b.quantity
      }));

  // First check of each build, in its planned week.
  const firstCheck = new Map<string, Shortage[]>();
  // Week each build was actually built.
  const builtInWeek = new Map<string, number>();

  let queue: Build[] = [];
  for (let week = 1; week <= lastWeek; week++) {
    // 1. Inbound lands.
    for (const po of data.inbound) {
      if (po.expected_week === week) {
        const k = key(po.site, po.component);
        stock.set(k, (stock.get(k) ?? 0) + po.quantity);
      }
    }

    // 2. This week's builds join any slipped builds, in priority order.
    queue.push(...data.builds.filter((b) => b.week === week));
    queue.sort(
      (a, b) =>
        a.priority - b.priority || a.week - b.week || a.id.localeCompare(b.id)
    );

    // 3 and 4. Build what we can; short builds stay in the queue.
    const stillWaiting: Build[] = [];
    for (const b of queue) {
      const needs = needsFor(b);
      const shortages: Shortage[] = [];
      for (const n of needs) {
        const available = stock.get(key(b.site, n.component)) ?? 0;
        if (available < n.needed) {
          shortages.push({
            component: n.component,
            componentName: COMPONENT_NAMES[n.component] ?? n.component,
            needed: n.needed,
            available,
            shortBy: n.needed - available
          });
        }
      }

      if (!firstCheck.has(b.id)) firstCheck.set(b.id, shortages);

      if (shortages.length === 0) {
        for (const n of needs) {
          const k = key(b.site, n.component);
          stock.set(k, (stock.get(k) ?? 0) - n.needed);
        }
        builtInWeek.set(b.id, week);
      } else {
        stillWaiting.push(b);
      }
    }
    queue = stillWaiting;
  }

  // Report only builds planned inside the requested horizon.
  const inHorizon = data.builds
    .filter((b) => b.week <= weeks)
    .sort((a, b) => a.week - b.week || a.priority - b.priority || a.id.localeCompare(b.id));

  const builds: BuildReadiness[] = inHorizon.map((b) => {
    const shortages = firstCheck.get(b.id) ?? [];
    const short = shortages.length > 0;
    const recoveryWeek = short ? (builtInWeek.get(b.id) ?? null) : null;
    return {
      id: b.id,
      week: b.week,
      site: SITE_NAMES[b.site],
      rackType: b.rack_type,
      racks: b.quantity,
      destination: b.region,
      priority: b.priority,
      status: short ? "short" : "ready",
      shortages,
      recoveryWeek,
      weeksLate: recoveryWeek === null ? null : recoveryWeek - b.week
    };
  });

  const shortBuilds = builds.filter((b) => b.status === "short");
  const summary =
    shortBuilds.length === 0
      ? `All ${builds.length} builds in weeks 1 to ${weeks} have the material they need.`
      : `${shortBuilds.length} of ${builds.length} builds in weeks 1 to ${weeks} are short. ` +
        shortBuilds
          .map((b) => {
            const parts = b.shortages
              .map((s) => `${s.shortBy} x ${s.componentName} (${s.component})`)
              .join(", ");
            const recovery =
              b.recoveryWeek === null
                ? "supply does not recover within the plan"
                : `supply recovers in week ${b.recoveryWeek}, ${b.weeksLate} week(s) late`;
            return `${b.id} (${b.site}, week ${b.week}, priority ${b.priority}, ${b.racks} ${b.rackType} rack(s) for ${b.destination}) is short ${parts}; ${recovery}.`;
          })
          .join(" ");

  return {
    horizon: `weeks 1 to ${weeks}`,
    buildsChecked: builds.length,
    readyCount: builds.length - shortBuilds.length,
    shortCount: shortBuilds.length,
    summary,
    builds,
    note: "Mock data for demo purposes."
  };
}
