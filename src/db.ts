/**
 * RackReady database: creates the mock data tables in the agent's own SQLite
 * storage and seeds them on first run.
 */
import {
  SEED_BOM,
  SEED_BUILDS,
  SEED_INBOUND,
  SEED_INVENTORY,
  SITE_NAMES,
  type BomLine,
  type Build,
  type InboundRow,
  type InventoryRow
} from "./data";
import type { PlanningData } from "./readiness";

/** The agent's `this.sql` tagged template (Agents SDK). */
export type Sql = <T = Record<string, string | number | boolean | null>>(
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null)[]
) => T[];

/** Create the tables if they don't exist, then seed them if empty. */
export function setupDatabase(sql: Sql) {
  sql`CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    week INTEGER NOT NULL,
    site TEXT NOT NULL,
    rack_type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    region TEXT NOT NULL,
    priority INTEGER NOT NULL
  )`;
  sql`CREATE TABLE IF NOT EXISTS bom (
    rack_type TEXT NOT NULL,
    component TEXT NOT NULL,
    qty_per_rack INTEGER NOT NULL,
    PRIMARY KEY (rack_type, component)
  )`;
  sql`CREATE TABLE IF NOT EXISTS inventory (
    component TEXT NOT NULL,
    site TEXT NOT NULL,
    on_hand INTEGER NOT NULL,
    PRIMARY KEY (component, site)
  )`;
  sql`CREATE TABLE IF NOT EXISTS inbound (
    id TEXT PRIMARY KEY,
    component TEXT NOT NULL,
    site TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    expected_week INTEGER NOT NULL,
    supplier TEXT NOT NULL
  )`;

  // Seed only once: if builds already has rows, the data is already there.
  const [{ n }] = sql<{ n: number }>`SELECT COUNT(*) AS n FROM builds`;
  if (n > 0) return;

  for (const b of SEED_BUILDS) {
    sql`INSERT INTO builds (id, week, site, rack_type, quantity, region, priority)
        VALUES (${b.id}, ${b.week}, ${b.site}, ${b.rack_type}, ${b.quantity}, ${b.region}, ${b.priority})`;
  }
  for (const l of SEED_BOM) {
    sql`INSERT INTO bom (rack_type, component, qty_per_rack)
        VALUES (${l.rack_type}, ${l.component}, ${l.qty_per_rack})`;
  }
  for (const i of SEED_INVENTORY) {
    sql`INSERT INTO inventory (component, site, on_hand)
        VALUES (${i.component}, ${i.site}, ${i.on_hand})`;
  }
  for (const p of SEED_INBOUND) {
    sql`INSERT INTO inbound (id, component, site, quantity, expected_week, supplier)
        VALUES (${p.id}, ${p.component}, ${p.site}, ${p.quantity}, ${p.expected_week}, ${p.supplier})`;
  }
}

/** Read every planning table from SQLite for the readiness calculation. */
export function loadPlanningData(sql: Sql): PlanningData {
  return {
    builds: sql<Build>`SELECT id, week, site, rack_type, quantity, region, priority FROM builds`,
    bom: sql<BomLine>`SELECT rack_type, component, qty_per_rack FROM bom`,
    inventory: sql<InventoryRow>`SELECT component, site, on_hand FROM inventory`,
    inbound: sql<InboundRow>`SELECT id, component, site, quantity, expected_week, supplier FROM inbound`
  };
}

/**
 * getBuildPlan: planned builds for weeks 1..weeks. All totals are computed
 * here in code so the model never has to add anything up.
 */
export function getBuildPlan(sql: Sql, weeks: number) {
  const builds = sql<Build>`SELECT id, week, site, rack_type, quantity, region, priority
    FROM builds WHERE week <= ${weeks} ORDER BY week, priority, id`;

  const totalRacks = builds.reduce((sum, b) => sum + b.quantity, 0);
  const racksBySite: Record<string, number> = {};
  for (const b of builds) {
    const name = SITE_NAMES[b.site];
    racksBySite[name] = (racksBySite[name] ?? 0) + b.quantity;
  }

  return {
    horizon: `weeks 1 to ${weeks}`,
    buildCount: builds.length,
    totalRacks,
    racksBySite,
    builds: builds.map((b) => ({
      id: b.id,
      week: b.week,
      site: SITE_NAMES[b.site],
      rackType: b.rack_type,
      racks: b.quantity,
      destination: b.region,
      priority: b.priority
    })),
    note: "Mock data for demo purposes."
  };
}
