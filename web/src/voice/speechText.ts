/**
 * Turns streamed reply text into speakable sentences: code blocks become a single
 * "I've put the code on screen.", markdown and emoji are stripped, URLs are read as their
 * domain. Feed it deltas; it hands back sentences as soon as they're complete.
 */
const CODE_LINE = "I've put the code on screen.";
/** Merge tiny fragments ("Friday: High 82°F.") so each TTS call carries some weight. */
const MIN_CHUNK = 60;
const MAX_CHUNK = 400;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const URL_RE = /\bhttps?:\/\/[^\s)<>\]]+/gi;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function cleanForSpeech(text: string): string {
  return (
    text
      // [label](url) → label
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1")
      // Read URLs as their domain, keeping any sentence punctuation that followed them.
      .replace(URL_RE, (u) => {
        const tail = u.match(/[.,!?;:]+$/)?.[0] ?? "";
        return domainOf(u.slice(0, u.length - tail.length)) + tail;
      })
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*•]\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\*\*|__|~~/g, "")
      .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2")
      .replace(/^\s*(---+|\*\*\*+)\s*$/gm, "")
      .replace(/\|/g, ", ")
      .replace(EMOJI, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([.,!?;:])/g, "$1")
      .trim()
  );
}

/** Index just past the last sentence boundary in `s`, or 0 if there is none yet. */
function lastBoundary(s: string): number {
  let end = 0;
  const re = /[.!?]+["')\]]*(?=\s)|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) end = m.index + m[0].length;
  return end;
}

function splitSentences(s: string): string[] {
  return s
    .split(/(?<=[.!?]["')\]]*)\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export class SentenceStream {
  private pending = "";
  private inCode = false;
  private carry = "";
  private emitted = 0;

  constructor(private readonly onSentence: (text: string) => void) {}

  push(delta: string) {
    this.pending += delta;
    this.drain(false);
  }

  /** End of reply: speak whatever is left. */
  end() {
    this.drain(true);
    this.flushCarry(true);
  }

  private drain(final: boolean) {
    while (true) {
      if (this.inCode) {
        const close = this.pending.indexOf("```");
        if (close === -1) {
          if (final) {
            this.pending = "";
            this.queue(CODE_LINE, true);
          }
          return;
        }
        this.pending = this.pending.slice(close + 3);
        this.inCode = false;
        this.queue(CODE_LINE, true);
        continue;
      }
      const open = this.pending.indexOf("```");
      if (open !== -1) {
        this.take(this.pending.slice(0, open), true);
        this.pending = this.pending.slice(open + 3);
        this.inCode = true;
        continue;
      }
      if (final) {
        this.take(this.pending, true);
        this.pending = "";
        return;
      }
      // Hold back a trailing "`" or "``" in case it's the start of a fence.
      const hold = this.pending.match(/`{1,2}$/)?.[0].length ?? 0;
      const usable = this.pending.slice(0, this.pending.length - hold);
      const cut = lastBoundary(usable);
      if (cut > 0) {
        this.take(usable.slice(0, cut), false);
        this.pending = this.pending.slice(cut);
      }
      return;
    }
  }

  private take(text: string, complete: boolean) {
    for (const s of splitSentences(text)) {
      let clean = cleanForSpeech(s);
      if (!/[\p{L}\p{N}]/u.test(clean)) continue;
      // Headings and list items often lack punctuation; give them a spoken pause.
      if (!/[.!?:;,]$/.test(clean)) clean += ".";
      this.queue(clean, false);
    }
    if (complete) this.flushCarry(false);
  }

  private queue(sentence: string, force: boolean) {
    this.carry = this.carry ? `${this.carry} ${sentence}` : sentence;
    // The very first sentence goes out immediately so speech starts fast.
    if (force || this.emitted === 0 || this.carry.length >= MIN_CHUNK) this.flushCarry(true);
  }

  private flushCarry(force: boolean) {
    if (!this.carry || (!force && this.carry.length < MIN_CHUNK)) return;
    let text = this.carry;
    this.carry = "";
    while (text.length > MAX_CHUNK) {
      const cut = text.lastIndexOf(" ", MAX_CHUNK);
      const at = cut > 0 ? cut : MAX_CHUNK;
      this.emit(text.slice(0, at));
      text = text.slice(at).trim();
    }
    if (text) this.emit(text);
  }

  private emit(text: string) {
    this.emitted++;
    this.onSentence(text);
  }
}
