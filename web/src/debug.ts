import type { OrbMode } from "./orb/drive";

/**
 * Dev-only view switches, read from the URL: `?fx=0` disables post-processing,
 * `?layers=shell,globe` renders only the named orb layers, and `?mode=thinking` pins the
 * orb in one state (idle, attentive, listening, thinking, responding, speaking, error).
 */
const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const layerList = params.get("layers");

export const debug = {
  postFx: params.get("fx") !== "0",
  showLayer: (name: string) => !layerList || layerList.split(",").includes(name),
  forceMode: (params.get("mode") as OrbMode | null) ?? undefined,
};
