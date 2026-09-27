import type { ReactNode } from "react";

/**
 * A small markdown subset for replies: fenced code, headings, bullet / numbered lists,
 * **bold**, *italic*, `code` and [links](https://…). Built as React elements (never
 * innerHTML), and tolerant of half-streamed input: unclosed markers just show as text.
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/```/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="msg-code">
            {part.replace(/^[\w+-]*\n/, "").replace(/\n$/, "")}
          </pre>
        ) : (
          <Blocks key={i} text={part.replace(/^\n+|\n+$/g, "")} />
        ),
      )}
    </>
  );
}

function Blocks({ text }: { text: string }) {
  if (!text) return null;
  return (
    <>
      {text.split("\n").map((line, i) => {
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) {
          return (
            <div key={i} className="md-h">
              {inline(heading[1])}
            </div>
          );
        }
        const bullet = line.match(/^(\s*)[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="md-li" style={{ paddingLeft: `${1.2 + bullet[1].length * 0.5}em` }}>
              <span className="md-marker">▸</span>
              {inline(bullet[2])}
            </div>
          );
        }
        const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
        if (numbered) {
          return (
            <div key={i} className="md-li" style={{ paddingLeft: `${1.2 + numbered[1].length * 0.5}em` }}>
              <span className="md-marker">{numbered[2]}.</span>
              {inline(numbered[3])}
            </div>
          );
        }
        if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) return <div key={i} className="md-rule" />;
        if (!line.trim()) return <div key={i} className="md-gap" />;
        return <div key={i}>{inline(line)}</div>;
      })}
    </>
  );
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\s][^*\n]*\*)|(\b_[^_\n]+_\b)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (m[1]) {
      out.push(
        <code key={key++} className="md-code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (m[2] || m[3]) {
      out.push(<strong key={key++}>{inline(tok.slice(2, -2))}</strong>);
    } else if (m[4] || m[5]) {
      out.push(<em key={key++}>{inline(tok.slice(1, -1))}</em>);
    } else if (m[6]) {
      const [, label, href] = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      out.push(
        /^https?:\/\//i.test(href ?? "") ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
