"use client";

/* Rule-trace explainability: highlight every matched trigger phrase in the
 * report text, keyed to the rule tags that fired. Longest-match-first so
 * overlapping phrases don't double-render. */
import type { RuleTag } from "@/lib/api";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function RuleTrace({ text, tags }: { text: string; tags: RuleTag[] }) {
  const phrases: { phrase: string; rule: string }[] = [];
  for (const t of tags) {
    for (const p of t.matched_phrases ?? []) {
      if (p && p.length > 2) phrases.push({ phrase: p, rule: t.rule });
    }
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  if (!phrases.length) {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--dim)]">{text}</p>;
  }

  const pattern = new RegExp(`(${phrases.map((p) => escapeRe(p.phrase)).join("|")})`, "gi");
  // Track which phrase list entry matched (case-insensitive) for the title attr.
  const lookup = new Map(phrases.map((p) => [p.phrase.toLowerCase(), p]));

  const parts = text.split(pattern);
  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--dim)]">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const hit = lookup.get(part.toLowerCase());
          return (
            <mark key={i} className="trigger" title={hit ? `rule: ${hit.rule}` : undefined}>
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  );
}
