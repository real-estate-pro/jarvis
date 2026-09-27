import { useCallback, useEffect, useState } from "react";
import { useChatStore } from "./chatStore";
import { Conversation, HistoryDrawer } from "./Conversation";
import { InputBar } from "./InputBar";

export function ChatLayer() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  useEffect(() => {
    useChatStore
      .getState()
      .loadHistory()
      .catch((err: Error) => useChatStore.setState({ notice: err.message }));
  }, []);

  return (
    <div className="chat-layer">
      <Conversation />
      <InputBar onOpenHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={closeHistory} />
    </div>
  );
}
