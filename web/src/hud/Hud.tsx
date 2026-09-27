import { useEffect, useState } from "react";
import { perfStats } from "../orb/perf";
import { useOrbStore } from "../state/orbStore";
import { useVoiceStore } from "../voice/voice";

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

interface Status {
  hermes: { online: boolean };
  system: { uptimeSec: number; cpu: number; memUsed: number };
}

function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}D ${h}H` : h ? `${h}H ${m}M` : `${m}M`;
}

function useStatus() {
  const [status, setStatus] = useState<Status | null | "down">(null);
  useInterval(() => {
    fetch("/api/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setStatus("down"));
  }, 10_000);
  return status;
}

function HermesStatus({ status }: { status: Status | null | "down" }) {
  const online = status !== null && status !== "down" && status.hermes.online;
  const label = status === null ? "…" : status === "down" ? "LINK DOWN" : online ? "ONLINE" : "OFFLINE";
  return (
    <span>
      <span className={`dot${online ? " on" : ""}`} />
      HERMES {label}
    </span>
  );
}

function SystemStats({ status }: { status: Status | null | "down" }) {
  if (!status || status === "down") return null;
  const { cpu, memUsed, uptimeSec } = status.system;
  return (
    <span className="hud-mono">
      CPU {Math.round(cpu * 100)}% · MEM {Math.round(memUsed * 100)}% · UP {formatUptime(uptimeSec)}
    </span>
  );
}

function VoiceToggle() {
  const { enabled, available, toggle } = useVoiceStore();
  return (
    <button
      className={`hud-toggle${enabled ? " on" : ""}`}
      onClick={toggle}
      disabled={!available && !enabled}
      aria-pressed={enabled}
      title={available ? "Speak replies aloud" : "Voice isn't configured on the server"}
    >
      VOICE <span className="hud-toggle-glyph">{enabled ? "◉" : "○"}</span> {enabled ? "ON" : "OFF"}
    </button>
  );
}

export function Hud() {
  const status = useStatus();
  return (
    <div className="hud">
      <div className="hud-corner tl">
        <span className="hud-title">J.A.R.V.I.S.</span>
        <span className="hud-rule" />
        <HermesStatus status={status} />
        <FpsMeter />
      </div>
      <div className="hud-corner tr">
        <Clock />
        <SystemStats status={status} />
        <VoiceToggle />
      </div>
    </div>
  );
}
