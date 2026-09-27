import { useEffect, useState } from "react";
import { perfStats } from "../orb/perf";
import { useOrbStore } from "../state/orbStore";

function useInterval(fn: () => void, ms: number) {
  useEffect(() => {
    fn();
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }, [ms]);
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useInterval(() => setNow(new Date()), 1000);
  return (
    <span className="hud-mono">
      {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
    </span>
  );
}

function FpsMeter() {
  const [stats, setStats] = useState({ fps: 0, ms: 0 });
  const quality = useOrbStore((s) => s.quality);
  useInterval(() => setStats({ fps: perfStats.fps, ms: perfStats.frameMs }), 500);
  return (
    <span className="hud-mono">
      FPS {stats.fps.toFixed(0).padStart(3, " ")} · {stats.ms.toFixed(1)}ms · Q{Math.round(quality * 100)}
    </span>
  );
}

function ServerLink() {
  const [ok, setOk] = useState<boolean | null>(null);
  useInterval(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => setOk(r.ok))
      .catch(() => setOk(false));
  }, 10_000);
  return (
    <span>
      <span className={`dot${ok ? " on" : ""}`} />
      LINK {ok === null ? "…" : ok ? "ONLINE" : "OFFLINE"}
    </span>
  );
}

export function Hud() {
  return (
    <div className="hud">
      <div className="hud-corner tl">
        <span className="hud-title">J.A.R.V.I.S.</span>
        <span className="hud-rule" />
        <ServerLink />
      </div>
      <div className="hud-corner tr">
        <Clock />
      </div>
      <div className="hud-corner bl">
        <FpsMeter />
      </div>
    </div>
  );
}
