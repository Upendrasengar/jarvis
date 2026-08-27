// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// @-mention source for the chat box: the owner's notes and calls, searchable
// by title. Only the REFERENCE travels with the message — never the file's
// contents (see ChatRef in @jarvis/shared).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Call, NoteMeta, type ChatRef } from "@jarvis/shared";
import { callTitle } from "../calls/hooks";
import { ago } from "../../lib/time";

export type Mention = ChatRef & { sub: string; when: number };

const MAX = 8;

export function useMentions() {
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: async () => NoteMeta.array().parse(await (await fetch("/api/notes")).json()),
    staleTime: 30_000,
  });
  const { data: calls = [] } = useQuery({
    queryKey: ["calls"],
    queryFn: async () => Call.array().parse(await (await fetch("/api/calls")).json()),
    staleTime: 30_000,
  });

  const all = useMemo<Mention[]>(() => {
    const n: Mention[] = notes.map((x) => ({
      kind: "note", id: x.id, title: x.title,
      sub: `note · ${ago(x.updated)}`, when: x.updated,
    }));
    // A call still transcribing has no notes file to point a worker at yet.
    const c: Mention[] = calls
      .filter((x) => x.status === "done" && x.notes.trim())
      .map((x) => ({
        kind: "call", id: x.id, title: callTitle(x),
        sub: `call · ${x.started.slice(0, 10)}`,
        when: Date.parse(x.started) || 0,
      }));
    return [...n, ...c].sort((a, b) => b.when - a.when);
  }, [notes, calls]);

  // Empty query lists the most recent — an @ with nothing typed should still
  // be useful. Ranks title-prefix matches above mid-string ones.
  const search = useMemo(
    () => (q: string): Mention[] => {
      const s = q.trim().toLowerCase();
      if (!s) return all.slice(0, MAX);
      const hits = all.filter((m) => m.title.toLowerCase().includes(s) || m.id.toLowerCase().includes(s));
      return hits
        .sort((a, b) => {
          const ap = a.title.toLowerCase().startsWith(s) ? 0 : 1;
          const bp = b.title.toLowerCase().startsWith(s) ? 0 : 1;
          return ap - bp || b.when - a.when;
        })
        .slice(0, MAX);
    },
    [all],
  );

  return { search, ready: all.length > 0 };
}

// The token that stands in for a mention inside the message text. Kept in one
// place so insertion and the drop-if-deleted check below cannot disagree.
export const refToken = (m: { title: string }) => `@${m.title}`;

// Refs the user has since deleted from the text should not travel with the
// message — otherwise editing a mention away still sends the file.
export function liveRefs(text: string, refs: ChatRef[]): ChatRef[] {
  return refs.filter((r) => text.includes(refToken(r)));
}
