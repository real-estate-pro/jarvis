import { useEffect } from "react";
import { useAuthStore } from "./auth/authStore";
import { LockScreen } from "./auth/LockScreen";
import { ChatLayer } from "./chat/ChatLayer";
import { Hud } from "./hud/Hud";
import { ToolTags } from "./hud/ToolTags";
import { startOrbDirector } from "./orb/director";
import { Scene } from "./orb/Scene";
import { startVoice } from "./voice/voice";

export function App() {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    startOrbDirector();
    void useAuthStore.getState().check();
  }, []);

  useEffect(() => {
    if (status === "welcome" || status === "unlocked") startVoice();
  }, [status]);

  return (
    <>
      <Scene />
      {status === "unlocked" ? (
        <>
          <Hud />
          <ToolTags />
          <ChatLayer />
        </>
      ) : (
        <LockScreen />
      )}
    </>
  );
}
