import { useEffect } from "react";
import { ChatLayer } from "./chat/ChatLayer";
import { Hud } from "./hud/Hud";
import { ToolTags } from "./hud/ToolTags";
import { startOrbDirector } from "./orb/director";
import { Scene } from "./orb/Scene";

export function App() {
  useEffect(startOrbDirector, []);
  return (
    <>
      <Scene />
      <Hud />
      <ToolTags />
      <ChatLayer />
    </>
  );
}
