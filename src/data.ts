/**
 * RackReady mock data. ALL OF THIS IS MADE UP for the demo.
 *
 * Weeks are relative to "now": week 1 is this week, week 8 is the end of the
 * planning horizon. Supplier names are fictional.
 *
 * The story the data is built to tell (see BUILD_BRIEF.md):
 * - Servers are fine at both sites.
 * - Top-of-rack switches (SW-TOR-48) run short at Texas in week 3:
 *   Texas starts with 10, weeks 1 and 2 use 8, so only 2 are left for the
 *   week 3 builds, which need 6. Build B-05 (priority 1) gets the 2,
 *   build B-06 (priority 2) is short 4.
 * - A late inbound shipment of 8 switches lands at Texas in week 5 and
 *   covers the gap.
 * - Malaysia has spare top-of-rack switches, so a transfer is an option.
 */

export type Site = "TX" | "MY";
export type RackType = "compute" | "network";

export const SITE_NAMES: Record<Site, string> = {
  TX: "Texas",
  MY: "Malaysia"
};

export const COMPONENT_NAMES: Record<string, string> = {
  "SRV-C1": "Compute server",
  "SW-TOR-48": "Top-of-rack switch (48-port)",
  "SW-SPN-32": "Spine switch (32-port)",
  "PDU-3P": "Power distribution unit",
  "CBL-KIT": "Cable kit"
};

export interface Build {
  id: string;
  week: number;
  site: Site;
  rack_type: RackType;
  quantity: number; // number of racks
  region: string; // destination data center region
  priority: number; // 1 = highest, 3 = lowest
}

export interface BomLine {
  rack_type: RackType;
  component: string;
  qty_per_rack: number;
}

export interface InventoryRow {
  component: string;
  site: Site;
  on_hand: number;
}

export interface InboundRow {
  id: string;
  component: string;
  site: Site;
  quantity: number;
  expected_week: number;
  supplier: string;
}

export const SEED_BUILDS: Build[] = [
  { id: "B-01", week: 1, site: "TX", rack_type: "compute", quantity: 2, region: "US-East", priority: 1 },
  { id: "B-02", week: 1, site: "MY", rack_type: "network", quantity: 1, region: "APAC-Singapore", priority: 2 },
  { id: "B-03", week: 2, site: "TX", rack_type: "compute", quantity: 2, region: "US-West", priority: 2 },
  { id: "B-04", week: 2, site: "MY", rack_type: "compute", quantity: 2, region: "APAC-Tokyo", priority: 1 },
  { id: "B-05", week: 3, site: "TX", rack_type: "compute", quantity: 1, region: "US-East", priority: 1 },
  { id: "B-06", week: 3, site: "TX", rack_type: "compute", quantity: 2, region: "US-Central", priority: 2 },
  { id: "B-07", week: 3, site: "MY", rack_type: "compute", quantity: 1, region: "APAC-Sydney", priority: 3 },
  { id: "B-08", week: 4, site: "TX", rack_type: "network", quantity: 1, region: "US-East", priority: 1 },
  { id: "B-09", week: 5, site: "TX", rack_type: "compute", quantity: 2, region: "US-West", priority: 2 },
  { id: "B-10", week: 6, site: "MY", rack_type: "compute", quantity: 2, region: "APAC-Singapore", priority: 2 },
  { id: "B-11", week: 7, site: "TX", rack_type: "compute", quantity: 2, region: "US-East", priority: 1 },
  { id: "B-12", week: 8, site: "MY", rack_type: "network", quantity: 1, region: "APAC-Tokyo", priority: 3 }
];

// Bill of materials: what one rack of each type needs.
export const SEED_BOM: BomLine[] = [
  { rack_type: "compute", component: "SRV-C1", qty_per_rack: 20 },
  { rack_type: "compute", component: "SW-TOR-48", qty_per_rack: 2 },
  { rack_type: "compute", component: "PDU-3P", qty_per_rack: 2 },
  { rack_type: "compute", component: "CBL-KIT", qty_per_rack: 1 },
  { rack_type: "network", component: "SW-SPN-32", qty_per_rack: 4 },
  { rack_type: "network", component: "PDU-3P", qty_per_rack: 2 },
  { rack_type: "network", component: "CBL-KIT", qty_per_rack: 1 }
];

// On-hand stock at each integrator site at the start of week 1.
export const SEED_INVENTORY: InventoryRow[] = [
  { component: "SRV-C1", site: "TX", on_hand: 160 },
  { component: "SW-TOR-48", site: "TX", on_hand: 10 },
  { component: "SW-SPN-32", site: "TX", on_hand: 6 },
  { component: "PDU-3P", site: "TX", on_hand: 30 },
  { component: "CBL-KIT", site: "TX", on_hand: 15 },
  { component: "SRV-C1", site: "MY", on_hand: 120 },
  { component: "SW-TOR-48", site: "MY", on_hand: 16 },
  { component: "SW-SPN-32", site: "MY", on_hand: 4 },
  { component: "PDU-3P", site: "MY", on_hand: 20 },
  { component: "CBL-KIT", site: "MY", on_hand: 10 }
];

// Purchase orders in transit. Stock lands at the start of expected_week.
export const SEED_INBOUND: InboundRow[] = [
  { id: "PO-101", component: "SRV-C1", site: "TX", quantity: 120, expected_week: 4, supplier: "Orbis Systems" },
  { id: "PO-102", component: "SW-TOR-48", site: "TX", quantity: 8, expected_week: 5, supplier: "Vela Networks" },
  { id: "PO-103", component: "SW-TOR-48", site: "TX", quantity: 6, expected_week: 6, supplier: "Vela Networks" },
  { id: "PO-104", component: "SW-SPN-32", site: "MY", quantity: 4, expected_week: 6, supplier: "Vela Networks" },
  { id: "PO-105", component: "SRV-C1", site: "MY", quantity: 40, expected_week: 5, supplier: "Orbis Systems" }
];
