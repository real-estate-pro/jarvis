import { useChatStore } from "./chatStore";

const LABELS: Record<string, string> = {
  once: "ALLOW ONCE",
  session: "ALLOW FOR SESSION",
  always: "ALWAYS ALLOW",
  deny: "DENY",
};

/** Hermes paused a flagged command (e.g. a destructive terminal call) for a human decision. */
export function ApprovalCard() {
  const approval = useChatStore((s) => s.approval);
  const answer = useChatStore((s) => s.answerApproval);
  if (!approval) return null;
  return (
    <div className="approval" role="alertdialog" aria-label="Authorization required">
      <div className="approval-title">AUTHORIZATION REQUIRED</div>
      {approval.description && <div className="approval-desc">{approval.description}</div>}
      {approval.command && <pre className="msg-code">{approval.command}</pre>}
      <div className="approval-actions">
        {approval.choices.map((c) => (
          <button key={c} className={`hud-btn${c === "deny" ? "" : " primary"}`} onClick={() => answer(c)}>
            {LABELS[c] ?? c.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
