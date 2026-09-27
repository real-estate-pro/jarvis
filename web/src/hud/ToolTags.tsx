import { toolLabel } from "../chat/Conversation";
import { useOrbStore } from "../state/orbStore";

/** Tool-name tags that appear beside the orb while Hermes runs a tool. */
export function ToolTags() {
  const tags = useOrbStore((s) => s.toolTags);
  const { x, y, radius } = useOrbStore((s) => s.layout);
  if (!tags.length || !radius) return null;
  // Anchor just off the orb's upper-right shoulder.
  const left = x + radius * 0.78;
  const top = y - radius * 0.86;
  return (
    <div className="tool-tags" style={{ left, top }}>
      {tags.map((t) => (
        <div key={t.id} className={`orb-tag ${t.phase}`}>
          <span className="orb-tag-rule" />
          <span className="orb-tag-name">{toolLabel(t.name)}</span>
          {t.label && <span className="orb-tag-label">{t.label}</span>}
        </div>
      ))}
    </div>
  );
}
