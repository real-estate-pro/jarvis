import { cpus, freemem, totalmem, uptime } from "node:os";
import { Hono } from "hono";
import { hermes } from "./hermes.js";

/** CPU busy fraction since the previous call (first call measures since boot). */
let lastCpu = cpus().map((c) => ({ ...c.times }));
function cpuUsage(): number {
  const now = cpus().map((c) => ({ ...c.times }));
  let busy = 0;
  let total = 0;
  now.forEach((t, i) => {
    const p = lastCpu[i] ?? { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const b = t.user - p.user + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq);
    busy += b;
    total += b + (t.idle - p.idle);
  });
  lastCpu = now;
  return total > 0 ? busy / total : 0;
}

export const status = new Hono();

status.get("/", async (c) => {
  const hermesUp = await hermes.health();
  return c.json({
    hermes: { online: hermesUp, mode: hermes.mode },
    system: {
      uptimeSec: Math.round(uptime()),
      cpu: Number(cpuUsage().toFixed(3)),
      memUsed: Number((1 - freemem() / totalmem()).toFixed(3)),
      memTotalGb: Number((totalmem() / 1024 ** 3).toFixed(1)),
    },
  });
});
