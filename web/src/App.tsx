import { ChatLayer } from "./chat/ChatLayer";
import { Hud } from "./hud/Hud";
import { Scene } from "./orb/Scene";

export function App() {
  return (
    <>
      <Scene />
      <Hud />
      <ChatLayer />
    </>
  );
}
