import { Fragment } from "react";

/** Plain text with fenced code blocks set apart. Deliberately not a full markdown renderer. */
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
          <Fragment key={i}>{part.replace(/^\n+|\n+$/g, "")}</Fragment>
        ),
      )}
    </>
  );
}
