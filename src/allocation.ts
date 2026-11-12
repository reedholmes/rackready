/**
 * proposeAllocation: when a component is short at a site, build two or
 * three options and show what each one does to the affected builds.
 *
 * Every option is a "what if" scenario: we change a copy of the data
 * (move stock, pull in a shipment) and rerun the same readiness calculation.
 * So every number in every option comes from code, never from the model.
 *
 * Mock assumptions (stated in the output too):
 * - The current week is week 1.
 * - A transfer between sites takes 1 week door to door.
 */
import { COMPONENT_NAMES, SITE_NAMES, type Site } from "./data";
import {
  checkMaterialReadiness,
  type BuildReadiness,
  type PlanningData
} from "./readiness";

const CURRENT_WEEK = 1;
const TRANSFER_LEAD_WEEKS = 1;

export interface BuildOutcome {
  id: string;
  destination: string;
  priority: number;
  plannedWeek: number;
  builtWeek: number | null; // null = not within the plan
  weeksLate: number | null;
  result: string; // ready-made phrase, e.g. "on time (week 3)"
}

export interface AllocationOption {
  option: number;
  name: string;
  // What to do, followed by a ready-made "Effect: ..." sentence for each
  // affected build. Kept in one field because Llama 3.3 reliably repeats
  // this field but tended to skip a separate effect field.
  action: string;
  outcomes: BuildOutcome[];
  tradeoff: string;
}

const effectOf = (outcomes: BuildOutcome[]) =>
  "Effect: " + outcomes.map((o) => `${o.id} ${o.result}`).join(", ") + ".";

export type AllocationResult =
  | {
      constrained: true;
      component: string;
      componentName: string;
      site: string;
      shortBuilds: string[];
      options: AllocationOption[];
      summary: string;
      assumptions: string[];
      note: string;
    }
  | { constrained: false; message: string };

/** Accepts "TX", "Texas", "texas", "MY", "Malaysia", ... */
export function resolveSite(input: string): Site | null {
  const s = input.trim().toLowerCase();
  for (const [code, name] of Object.entries(SITE_NAMES)) {
    if (s === code.toLowerCase() || s === name.toLowerCase()) return code as Site;
  }
  return null;
}

/** Accepts a code ("SW-TOR-48") or words from the name ("top-of-rack switch"). */
export function resolveComponent(
  input: string,
  data: PlanningData,
  site: Site
): string | null {
  const s = input.trim().toLowerCase();
  const codes = Object.keys(COMPONENT_NAMES);
  const exact = codes.find((c) => c.toLowerCase() === s);
  if (exact) return exact;
  const words = s.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const matches = codes.filter((c) => {
    const name = COMPONENT_NAMES[c].toLowerCase();
    return words.length > 0 && words.every((w) => name.includes(w) || c.toLowerCase().includes(w));
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Ambiguous (e.g. "switch"): prefer the one that is actually short here.
    const shortHere = shortComponents(data, site);
    const pick = matches.filter((m) => shortHere.has(m));
    if (pick.length === 1) return pick[0];
  }
  return null;
}

function shortComponents(data: PlanningData, site: Site) {
  const result = checkMaterialReadiness(data, 8);
  const set = new Set<string>();
  for (const b of result.builds) {
    if (b.site === SITE_NAMES[site]) for (const s of b.shortages) set.add(s.component);
  }
  return set;
}

function outcomeOf(b: BuildReadiness): BuildOutcome {
  const builtWeek = b.status === "ready" ? b.week : b.recoveryWeek;
  const weeksLate = builtWeek === null ? null : builtWeek - b.week;
  const result =
    builtWeek === null
      ? "not built within the plan"
      : weeksLate === 0
        ? `on time (week ${builtWeek})`
        : `week ${builtWeek} (${weeksLate} week(s) late)`;
  return {
    id: b.id,
    destination: b.destination,
    priority: b.priority,
    plannedWeek: b.week,
    builtWeek,
    weeksLate,
    result
  };
}

export function proposeAllocation(
  data: PlanningData,
  componentInput: string,
  siteInput: string
): AllocationResult {
  const site = resolveSite(siteInput);
  if (!site) {
    return {
      constrained: false,
      message: `Unknown site "${siteInput}". Valid sites: ${Object.values(SITE_NAMES).join(", ")}.`
    };
  }
  const component = resolveComponent(componentInput, data, site);
  if (!component) {
    return {
      constrained: false,
      message: `Unknown component "${componentInput}". Valid components: ${Object.entries(
        COMPONENT_NAMES
      )
        .map(([c, n]) => `${c} (${n})`)
        .join(", ")}.`
    };
  }
  const siteName = SITE_NAMES[site];
  const componentName = COMPONENT_NAMES[component];

  // Baseline: the plan as it stands (serve by priority).
  const baseline = checkMaterialReadiness(data, 8);
  const shortBuilds = baseline.builds.filter(
    (b) => b.site === siteName && b.shortages.some((s) => s.component === component)
  );
  if (shortBuilds.length === 0) {
    return {
      constrained: false,
      message: `${componentName} (${component}) is not short at ${siteName} in the 8-week plan. No allocation decision is needed.`
    };
  }

  // Builds affected: everything at this site that uses this component,
  // from the first short week through the last recovery week.
  const usesComponent = new Set(
    data.bom.filter((l) => l.component === component).map((l) => l.rack_type)
  );
  const firstWeek = Math.min(...shortBuilds.map((b) => b.week));
  const lastWeek = Math.max(...shortBuilds.map((b) => b.recoveryWeek ?? 8));
  const affectedIds = data.builds
    .filter(
      (b) =>
        b.site === site &&
        usesComponent.has(b.rack_type) &&
        b.week >= firstWeek &&
        b.week <= lastWeek
    )
    .map((b) => b.id);

  const outcomesIn = (scenario: PlanningData) => {
    const r = checkMaterialReadiness(scenario, 8);
    return affectedIds.map((id) => outcomeOf(r.builds.find((b) => b.id === id)!));
  };
  const totalShort = shortBuilds.reduce(
    (sum, b) => sum + b.shortages.find((s) => s.component === component)!.shortBy,
    0
  );

  const options: AllocationOption[] = [];

  // Option 1: serve by priority (the current plan).
  const priorityOutcomes = outcomesIn(data);
  options.push({
    option: 1,
    name: "Serve builds by priority",
    action: `Keep the current plan. Higher-priority builds get the ${component} supply first; the rest wait for inbound supply. ${effectOf(priorityOutcomes)}`,
    outcomes: priorityOutcomes,
    tradeoff: "No extra cost or effort, but lower-priority builds slip until supply lands."
  });

  // Option 2: transfer spare stock from the other site.
  const other: Site = site === "TX" ? "MY" : "TX";
  const otherName = SITE_NAMES[other];
  const otherSupply =
    data.inventory
      .filter((i) => i.site === other && i.component === component)
      .reduce((s, i) => s + i.on_hand, 0) +
    data.inbound
      .filter((p) => p.site === other && p.component === component)
      .reduce((s, p) => s + p.quantity, 0);
  const otherDemand = data.builds
    .filter((b) => b.site === other)
    .reduce((sum, b) => {
      const line = data.bom.find(
        (l) => l.rack_type === b.rack_type && l.component === component
      );
      return sum + (line ? line.qty_per_rack * b.quantity : 0);
    }, 0);
  const spare = otherSupply - otherDemand;
  if (spare > 0) {
    const qty = Math.min(spare, totalShort);
    const arrives = CURRENT_WEEK + TRANSFER_LEAD_WEEKS;
    const scenario: PlanningData = {
      ...data,
      inventory: data.inventory.map((i) =>
        i.site === other && i.component === component
          ? { ...i, on_hand: i.on_hand - qty }
          : i
      ),
      inbound: [
        ...data.inbound,
        {
          id: "TRANSFER",
          component,
          site,
          quantity: qty,
          expected_week: arrives,
          supplier: `Transfer from ${otherName}`
        }
      ]
    };
    const otherStillReady = checkMaterialReadiness(scenario, 8).builds
      .filter((b) => b.site === otherName)
      .every((b) => b.status === "ready");
    const transferOutcomes = outcomesIn(scenario);
    options.push({
      option: 2,
      name: `Transfer stock from ${otherName}`,
      action: `Ship ${qty} x ${component} from ${otherName} to ${siteName} now, arriving week ${arrives}. ${otherName} has ${spare} more than its own 8-week plan needs. ${effectOf(transferOutcomes)}`,
      outcomes: transferOutcomes,
      tradeoff: `Freight cost and handling. ${otherName} spare drops from ${spare} to ${spare - qty}. ${otherName} builds ${otherStillReady ? "all stay ready" : "would NOT all stay ready"}.`
    });
  }

  // Option 3: expedite the inbound order that fixes the shortage.
  const late = data.inbound
    .filter(
      (p) => p.site === site && p.component === component && p.expected_week > firstWeek
    )
    .sort((a, b) => a.expected_week - b.expected_week)[0];
  if (late) {
    const scenario: PlanningData = {
      ...data,
      inbound: data.inbound.map((p) =>
        p.id === late.id ? { ...p, expected_week: firstWeek } : p
      )
    };
    const expediteOutcomes = outcomesIn(scenario);
    options.push({
      option: options.length + 1,
      name: `Expedite ${late.id} from ${late.supplier}`,
      action: `Ask ${late.supplier} to pull ${late.id} (${late.quantity} x ${component}) in from week ${late.expected_week} to week ${firstWeek}. ${effectOf(expediteOutcomes)}`,
      outcomes: expediteOutcomes,
      tradeoff: "Depends on the supplier agreeing; expedite fees are likely and not guaranteed to land on time."
    });
  }

  const summary =
    `${componentName} (${component}) is short at ${siteName}: ${shortBuilds
      .map((b) => b.id)
      .join(", ")} short ${totalShort} in total. Options: ` +
    options
      .map((o) => `(${o.option}) ${o.name}. ${o.action} Tradeoff: ${o.tradeoff}`)
      .join(" ");

  return {
    constrained: true,
    component,
    componentName,
    site: siteName,
    shortBuilds: shortBuilds.map((b) => b.id),
    options,
    summary,
    assumptions: [
      `Current week is week ${CURRENT_WEEK}.`,
      `A transfer between sites takes ${TRANSFER_LEAD_WEEKS} week door to door.`
    ],
    note: "Mock data for demo purposes."
  };
}
