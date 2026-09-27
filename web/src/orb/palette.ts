import { Color } from "three";

// Hex values are sRGB; three's color management converts them to linear for the shaders.
export const palette = {
  core: new Color("#FFB02E"),
  mid: new Color("#FF8A00"),
  highlight: new Color("#FFE2A1"),
  hot: new Color("#FFF6E0"),
  bgInner: new Color("#0b1420"),
  bgOuter: new Color("#05080d"),
};
