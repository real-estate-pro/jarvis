import { useEffect, useMemo } from "react";
import { buildRibbonGeometry, createRibbonMaterial, type RibbonCurve } from "../ribbons";

interface Props {
  build: () => RibbonCurve[];
  core?: boolean;
  gain?: number;
  spreadWeight?: number;
}

export function RibbonLayer({ build, core, gain, spreadWeight }: Props) {
  const geometry = useMemo(() => buildRibbonGeometry(build()), [build]);
  const material = useMemo(
    () => createRibbonMaterial({ core, gain, spreadWeight }),
    [core, gain, spreadWeight],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
