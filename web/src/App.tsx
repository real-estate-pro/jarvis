import { useEffect } from "react";
import { ChatLayer } from "./chat/ChatLayer";
import { Hud } from "./hud/Hud";
import { ToolTags } from "./hud/ToolTags";
import { startOrbDirector } from "./orb/director";
import { Scene } from "./orb/Scene";
import { startVoice } from "./voice/voice";

export function App() {
  useEffect(() => {
    startOrbDirector();
    startVoice();
  }, []);
  return (
    <>
      <Scene />
      <Hud />
      <ToolTags />
      <ChatLayer />
    </>
  );
}
