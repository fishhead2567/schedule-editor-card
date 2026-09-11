#!/usr/bin/env node
// Seeds a handful of schedule.* helpers into a dev Home Assistant instance,
// covering the edge cases the card needs to render/edit correctly.
//
// Usage: HA_HOST=localhost:8124 HA_TOKEN=... node dev/seed-schedules.mjs

const HA_HOST = process.env.HA_HOST || "localhost:8124";
const HA_TOKEN = process.env.HA_TOKEN;

if (!HA_TOKEN) {
  console.error("Set HA_TOKEN to a long-lived access token from the dev instance.");
  process.exit(1);
}

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

const emptyDays = () => ({
  monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
});

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
  const fixtures = [
    { name: "Empty Schedule", icon: "mdi:calendar-blank", days: emptyDays() },
    {
      name: "Every Day - One Block",
      icon: "mdi:lightbulb",
      days: { ...emptyDays(), monday: [{ from: "18:00:00", to: "22:00:00" }], tuesday: [{ from: "18:00:00", to: "22:00:00" }], wednesday: [{ from: "18:00:00", to: "22:00:00" }], thursday: [{ from: "18:00:00", to: "22:00:00" }], friday: [{ from: "18:00:00", to: "22:00:00" }], saturday: [{ from: "18:00:00", to: "22:00:00" }], sunday: [{ from: "18:00:00", to: "22:00:00" }] },
    },
    {
      name: "New Sod Watering (tue/thu/fri/sun, 2 blocks)",
      icon: "mdi:sprinkler",
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
      days: { ...emptyDays(), saturday: [{ from: "23:30:00", to: "23:59:59" }] },
    },
  ];

  for (const fx of fixtures) {
    const res = await call(ws, { id: id++, type: "schedule/create", name: fx.name, icon: fx.icon, ...fx.days });
    console.log(fx.name, "->", res.success ? "ok" : res.error);
  }

  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
