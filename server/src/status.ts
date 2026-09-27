import { execFile } from "node:child_process";
import { cpus, freemem, totalmem, uptime } from "node:os";
import { promisify } from "node:util";
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

const run = promisify(execFile);

/**
 * Fraction of RAM in use. On macOS, os.freemem() leaves out cached and inactive pages,
 * so it reads ~98% all the time; use vm_stat and count what Activity Monitor calls
 * "Memory Used" (app memory + wired + compressed) instead.
 */
async function memoryUsed(): Promise<number> {
  const total = totalmem();
  if (process.platform === "darwin") {
    try {
      const { stdout } = await run("vm_stat", [], { timeout: 2000 });
      const pageSize = Number(stdout.match(/page size of (\d+) bytes/)?.[1] ?? 16384);
      const pages = (label: string) => Number(stdout.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? NaN);
      const anonymous = pages("Anonymous pages");
      const purgeable = pages("Pages purgeable");
      const wired = pages("Pages wired down");
      const compressed = pages("Pages occupied by compressor");
      const app = Number.isFinite(anonymous) ? anonymous - (purgeable || 0) : pages("Pages active");
      const used = (app + wired + compressed) * pageSize;
      if (Number.isFinite(used) && used > 0) return Math.min(1, used / total);
    } catch {
      // fall through
    }
  }
  return 1 - freemem() / total;
}

export const status = new Hono();

status.get("/", async (c) => {
  const hermesUp = await hermes.health();
  return c.json({
    hermes: { online: hermesUp, mode: hermes.mode },
    system: {
      uptimeSec: Math.round(uptime()),
      cpu: Number(cpuUsage().toFixed(3)),
      memUsed: Number((await memoryUsed()).toFixed(3)),
      memTotalGb: Number((totalmem() / 1024 ** 3).toFixed(1)),
    },
  });
});
