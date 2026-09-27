import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load server/.env regardless of the process's working directory (launchd, npm -w, etc.).
const envFile = resolve(serverRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function bool(name: string): boolean {
  return ["1", "true", "yes"].includes(str(name).toLowerCase());
}

export const config = {
  nodeEnv: str("NODE_ENV", "development"),
  isProduction: str("NODE_ENV", "development") === "production",
  // Always loopback. cloudflared is the only way in; never expose this on the LAN.
  host: "127.0.0.1",
  port: Number(str("PORT", "4100")),
  hermes: {
    url: str("HERMES_API_URL", "http://127.0.0.1:8642").replace(/\/+$/, ""),
    apiKey: str("HERMES_API_KEY"),
  },
  elevenlabs: {
    apiKey: str("ELEVENLABS_API_KEY"),
    voiceId: str("ELEVENLABS_VOICE_ID"),
    modelId: str("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
  },
  auth: {
    passphraseHash: str("DASHBOARD_PASSPHRASE_HASH"),
    sessionSecret: str("SESSION_SECRET"),
  },
  cfAccess: {
    teamDomain: str("CF_ACCESS_TEAM_DOMAIN"),
    aud: str("CF_ACCESS_AUD"),
    devBypass: bool("DEV_BYPASS_ACCESS"),
  },
  paths: {
    serverRoot,
    webDist: resolve(serverRoot, "..", "web", "dist"),
    dataDir: resolve(serverRoot, "data"),
  },
} as const;

export function assertSafeConfig(): void {
  if (config.isProduction && config.cfAccess.devBypass) {
    console.error("[config] DEV_BYPASS_ACCESS=true is not allowed when NODE_ENV=production. Refusing to start.");
    process.exit(1);
  }
  if (!Number.isInteger(config.port) || config.port <= 0) {
    console.error(`[config] Invalid PORT: ${process.env.PORT}`);
    process.exit(1);
  }
}
