// Digest history browser — date sidebar + reading pane, deep-linked at
// /digest/:date.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as S from "@jarvis/shared";
import { Markdown } from "../../components/Markdown";

// The digest file is a frozen snapshot; the actions API is the live truth.
// matchAction maps a ledger line back to its source item — used both to
// TOGGLE on click and to RENDER the real checked-state after a reload.
function matchAction(actions: any[], source: string, line: string): any | null {
  const callId = source.startsWith("call-notes-")
    ? source.replace(/^call-notes-/, "").replace(/\.md$/, "")
    : "note:" + source.replace(/\.md$/, "");
  const norm = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const L = norm(line);
  const cands = actions.filter(
    (a: any) => a.callId === callId && a.text && L.includes(norm(a.text)),
  );
  if (cands.length === 1) return cands[0];
  return cands.find((a: any) => L === norm(`${a.owner}: ${a.text}`)) ?? cands[0] ?? null;
}

async function toggleMatched(actions: any[], source: string, line: string): Promise<boolean> {
  const hit = matchAction(actions, source, line);
  if (!hit) return false;
  const r = await fetch("/api/actions/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId: hit.callId, index: hit.index }),
  });
  return r.ok;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function useDigests() {
  return useQuery({
    queryKey: ["digests"],
    queryFn: async () => S.DigestEntry.array().parse(await (await fetch("/api/digests")).json()),
  });
}

function useDigest(date: string | null) {
  return useQuery({
    queryKey: ["digest", date],
    enabled: !!date,
    queryFn: async () =>
      S.Digest.parse(await (await fetch(`/api/digest?date=${date}`)).json()),
  });
}

export function DigestPage() {
  const qc = useQueryClient();
  const { data: liveActions } = useQuery({
    queryKey: ["actions"],
    queryFn: async () => (await fetch("/api/actions")).json(),
    staleTime: 10_000,
  });
  const ledgerState = (source: string, line: string): boolean | undefined =>
    liveActions ? matchAction(liveActions, source, line)?.done : undefined;
  const ledgerToggle = async (source: string, line: string) => {
    const ok = await toggleMatched(
      liveActions ?? (await (await fetch("/api/actions")).json()), source, line);
    if (ok) qc.invalidateQueries({ queryKey: ["actions"] });
    return ok;
  };
  const { data: list = [] } = useDigests();
  const { date } = useParams();
  const navigate = useNavigate();
  const selected = list.find((d) => d.date === date)?.date ?? list[0]?.date ?? null;
  const { data: digest } = useDigest(selected);

  useEffect(() => {
    if (selected && selected !== date) navigate(`/digest/${selected}`, { replace: true });
  }, [selected, date]);

  let lastMonth = "";
  return (
    <div className="flex h-full">
      <aside className="w-[280px] min-w-[280px] overflow-auto border-r border-[var(--line)] bg-[var(--chipbg)] p-3 backdrop-blur-lg">
        {list.map((d) => {
          const month = d.date.slice(0, 7);
          const header = month !== lastMonth ? (lastMonth = month) : null;
          const latest = d.date === list[0]?.date;
          return (
            <div key={d.date}>
              {header && (
                <div className="mx-1 mb-1 mt-3 text-[9px] uppercase tracking-[2px] text-[var(--dim)]">
                  {header}
                </div>
              )}
              <button
                onClick={() => navigate(`/digest/${d.date}`)}
                className={`mb-[3px] w-full rounded-lg border px-3 py-2 text-left transition ${
                  d.date === selected
                    ? "border-[rgba(57,215,255,.35)] bg-[rgba(57,215,255,.08)]"
                    : "border-transparent hover:bg-[rgba(57,215,255,.05)]"
                }`}
              >
                <div className="font-sans text-xs font-semibold text-[var(--bright)]">
                  {DAYS[new Date(d.date + "T12:00:00").getDay()]} · {d.date}
                </div>
                <div className="mt-[2px] flex items-center gap-2 text-[10px] text-[var(--dim)]">
                  {latest && <span className="h-[7px] w-[7px] rounded-full bg-[var(--green)]" />}
                  {latest ? "latest" : "daily digest"}
                </div>
              </button>
            </div>
          );
        })}
      </aside>
      <section className="min-w-0 flex-1 overflow-auto px-10 py-8">
        {digest ? (
          <Markdown md={digest.md} onLedgerToggle={ledgerToggle} ledgerState={ledgerState} />
        ) : (
          <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>
        )}
      </section>
    </div>
  );
}
