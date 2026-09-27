/**
 * Dev-only view switches, read from the URL: `?fx=0` disables post-processing and
 * `?layers=shell,globe` renders only the named orb layers.
 */
const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const layerList = params.get("layers");

export const debug = {
  postFx: params.get("fx") !== "0",
  showLayer: (name: string) => !layerList || layerList.split(",").includes(name),
};
