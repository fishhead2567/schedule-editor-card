#!/usr/bin/env node
// Canonical dev-instance fixture set. This is the single source of truth
// for what a freshly-seeded dev instance looks like - re-run any time
// (after `docker compose down -v && up -d` for a truly clean slate, or
// just on top of an existing instance; each fixture is looked up by name
// first and skipped if it already exists, so re-running is safe and won't
// create duplicates).
//
// Usage: HA_HOST=localhost:8124 HA_TOKEN=... node dev/seed-schedules.mjs
//
// Includes a deliberately dense set for UI-scale testing: two independent
// "always covered" layers (see buildCoverageLayer below) that together
// guarantee at least 2 schedules are active at every moment of every day,
// plus a handful of varied, realistic-shaped fixtures (empty, sparse,
// multi-block) for testing how the card renders a mix, not just a wall of
// identical entries.

const HA_HOST = process.env.HA_HOST || "localhost:8124";
const HA_TOKEN = process.env.HA_TOKEN;

if (!HA_TOKEN) {
  console.error("Set HA_TOKEN to a long-lived access token from the dev instance.");
  process.exit(1);
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function call(ws, msg) {
  return new Promise((resolve) => {
    const handler = (event) => {
      const parsed = JSON.parse(event.data.toString());
      if (parsed.id === msg.id) {
        ws.removeEventListener("message", handler);
        resolve(parsed);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify(msg));
  });
}

const emptyDays = () => Object.fromEntries(DAYS.map((d) => [d, []]));
const everyDay = (block) => Object.fromEntries(DAYS.map((d) => [d, [block]]));
const pad2 = (n) => String(n).padStart(2, "0");
const hm = (totalMinutes) => `${pad2(Math.floor(totalMinutes / 60) % 24)}:${pad2(totalMinutes % 60)}:00`;
const hmLabel = (totalMinutes) => hm(totalMinutes).slice(0, 5);

/**
 * A set of N schedules, each `slotMinutes` wide, tiled edge-to-edge across
 * the full 24h day with zero gaps, every day of the week. Any one such
 * layer alone guarantees "exactly one of these N schedules is active" at
 * every instant. Two layers with independently-full coverage - regardless
 * of whether their slot boundaries line up - therefore guarantee at least
 * 2 schedules active at every moment, which is the actual requirement
 * ("I want 2 schedules going at all times"), not just "lots of schedules."
 */
function buildCoverageLayer({ namePrefix, icon, colorPalette, slotMinutes }) {
  const count = 1440 / slotMinutes;
  if (!Number.isInteger(count)) throw new Error(`slotMinutes ${slotMinutes} must evenly divide 1440`);
  const fixtures = [];
  for (let i = 0; i < count; i++) {
    const start = i * slotMinutes;
    const end = start + slotMinutes;
    // The native schedule domain has no way to express "until midnight" as
    // 00:00:00 (it validates to > from on the same day) - use 23:59:59 for
    // the last slot, same trick the "Near Midnight Block" fixture already
    // relies on. Costs one second of "gap" out of 86400, not worth caring
    // about for a coverage guarantee that only needs to hold "practically."
    const toLabel = end >= 1440 ? "23:59:59" : hm(end);
    fixtures.push({
      name: `${namePrefix} ${hmLabel(start)}-${hmLabel(end)}`,
      icon,
      color: colorPalette[i % colorPalette.length],
      days: everyDay({ from: hm(start), to: toLabel }),
    });
  }
  return fixtures;
}

const layerA = buildCoverageLayer({
  namePrefix: "Security Lighting",
  icon: "mdi:shield-home",
  colorPalette: ["#e74c3c", "#c0392b"],
  slotMinutes: 4 * 60, // 6 schedules
});

const layerB = buildCoverageLayer({
  namePrefix: "Perimeter Sensors Armed",
  icon: "mdi:motion-sensor",
  colorPalette: ["#2980b9", "#3498db"],
  slotMinutes: 3 * 60, // 8 schedules
});

// Varied, realistic-shaped fixtures for testing how the card renders a mix
// - not everything in a real setup is part of a dense always-on layer.
const curated = [
  { name: "Empty Schedule", icon: "mdi:calendar-blank", color: null, days: emptyDays() },
  {
    name: "Every Day - One Block",
    icon: "mdi:lightbulb",
    color: "#f39c12",
    days: everyDay({ from: "18:00:00", to: "22:00:00" }),
  },
  {
    name: "New Sod Watering (tue/thu/fri/sun, 2 blocks)",
    icon: "mdi:sprinkler",
    color: "#2ecc71",
    days: {
      ...emptyDays(),
      tuesday: [{ from: "00:15:00", to: "00:35:00" }, { from: "05:00:00", to: "05:20:00" }],
      thursday: [{ from: "00:15:00", to: "00:35:00" }, { from: "05:00:00", to: "05:20:00" }],
      friday: [{ from: "00:15:00", to: "00:35:00" }, { from: "05:00:00", to: "05:20:00" }],
      sunday: [{ from: "00:15:00", to: "00:35:00" }, { from: "05:00:00", to: "05:20:00" }],
    },
  },
  {
    name: "Near Midnight Block",
    icon: "mdi:weather-night",
    color: "#9b59b6",
    days: { ...emptyDays(), saturday: [{ from: "23:30:00", to: "23:59:59" }] },
  },
  {
    name: "Weekend Evening Lights",
    icon: "mdi:string-lights",
    color: "#e67e22",
    days: { ...emptyDays(), friday: [{ from: "18:00:00", to: "23:00:00" }], saturday: [{ from: "18:00:00", to: "23:00:00" }] },
  },
];

const fixtures = [...layerA, ...layerB, ...curated];

async function main() {
  const ws = new WebSocket(`ws://${HA_HOST}/api/websocket`);
  await new Promise((resolve, reject) => {
    ws.addEventListener("message", function onMsg(event) {
      const parsed = JSON.parse(event.data.toString());
      if (parsed.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
      else if (parsed.type === "auth_ok") { ws.removeEventListener("message", onMsg); resolve(); }
      else if (parsed.type === "auth_invalid") reject(new Error("auth invalid"));
    });
    ws.addEventListener("error", reject);
  });

  let id = 1;
  const existing = await call(ws, { id: id++, type: "schedule/list" });
  const existingByName = new Map(existing.result.map((s) => [s.name, s]));

  const colorUpdates = {};
  let created = 0;
  let skipped = 0;

  for (const fx of fixtures) {
    if (existingByName.has(fx.name)) {
      console.log(fx.name, "-> already exists, skipped");
      skipped++;
      if (fx.color) colorUpdates[existingByName.get(fx.name).id] = fx.color;
      continue;
    }
    const res = await call(ws, { id: id++, type: "schedule/create", name: fx.name, icon: fx.icon, ...fx.days });
    if (res.success) {
      created++;
      if (fx.color) colorUpdates[res.result.id] = fx.color;
      console.log(fx.name, "-> created");
    } else {
      console.log(fx.name, "-> FAILED:", JSON.stringify(res.error));
    }
  }

  if (Object.keys(colorUpdates).length > 0) {
    const current = await call(ws, { id: id++, type: "frontend/get_user_data", key: "schedule_editor_card_colors" });
    const merged = { ...(current.result.value ?? {}), ...colorUpdates };
    await call(ws, { id: id++, type: "frontend/set_user_data", key: "schedule_editor_card_colors", value: merged });
    console.log(`Set colors for ${Object.keys(colorUpdates).length} schedules.`);
  }

  console.log(`\n${created} created, ${skipped} already present, ${fixtures.length} total fixtures.`);
  console.log(`Coverage layers: ${layerA.length} x ${1440 / layerA.length / 60}h + ${layerB.length} x ${1440 / layerB.length / 60}h`);
  console.log("These two layers independently tile all 24h with no gaps, every day - at least 2 schedules will show active at any moment.");

  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
