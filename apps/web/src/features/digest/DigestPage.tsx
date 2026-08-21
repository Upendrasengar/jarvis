// Digest history browser — date sidebar + reading pane, deep-linked at
// /digest/:date.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as S from "@jarvis/shared";
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { buildClusters, idKey, shortDate, type Cluster } from "../../lib/actionClusters";

// One recurring cluster: canonical phrasing, one checkbox that completes
// EVERY instance, and a chip per call it was raised in.
function RecurringRow({ c, onToggleAll }: { c: Cluster; onToggleAll: (c: Cluster) => Promise<boolean> }) {
  const [state, setState] = useState<"open" | "busy" | "done">("open");
  const click = async () => {
    if (state !== "open") return;
    setState("busy");
    setState((await onToggleAll(c)) ? "done" : "open");
  };
  return (
    <div className="mb-2 flex items-start gap-2">
      <button
        onClick={click}
        title={`Check off in all ${c.items.length} calls`}
        className={`cursor-pointer text-[var(--cyan)] ${state === "busy" ? "animate-pulse" : ""}`}
      >
        {state === "done" ? "☑" : "☐"}
      </button>
      <span className={`min-w-0 flex-1 ${state === "done" ? "text-[var(--dim)] line-through" : ""}`}>
        <b className="text-[var(--bright)]">{c.canonical.owner}:</b>{" "}
        {c.canonical.text.replace(/\*\*/g, "")}
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[var(--dim)]">raised in {c.items.length} calls:</span>
          {c.items.map((a) => (
            <Link
              key={idKey(a)}
              to={a.callId.startsWith("note:") ? `/notes/${encodeURIComponent(a.callId.slice(5))}` : `/calls/${a.callId}`}
              title={a.callTitle}
              className="rounded-full border border-[var(--line)] bg-[var(--chipbg)] px-2 py-[1px] text-[10px] text-[var(--cyan)] no-underline hover:border-[var(--cyan)]"
            >
              {a.callId.startsWith("note:") ? "📝" : "📞"} {shortDate(a.callStarted)}
            </Link>
          ))}
        </span>
      </span>
    </div>
  );
}

function RecurringPanel({ clusters, onToggleAll }: {
  clusters: Cluster[]; onToggleAll: (c: Cluster) => Promise<boolean>;
}) {
  if (!clusters.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--chipbg)] p-3">
      <div className="mb-2 text-[10px] tracking-[2px] text-[var(--amber)]">
        ⟳ RECURRING — RAISED IN MULTIPLE CALLS
      </div>
      {clusters.map((c) => (
        <RecurringRow key={c.key} c={c} onToggleAll={onToggleAll} />
      ))}
      <div className="text-[9.5px] text-[var(--dim)]">Checking an item here completes it in every call it appears in.</div>
    </div>
  );
}

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
  const ledgerTitle = (source: string): string | undefined => {
    if (!liveActions) return undefined;
    const callId = source.startsWith("call-notes-")
      ? source.replace(/^call-notes-/, "").replace(/\.md$/, "")
      : "note:" + source.replace(/\.md$/, "");
    return liveActions.find((a: any) => a.callId === callId)?.callTitle || undefined;
  };
  const { clusters, byId } = useMemo(
    () => buildClusters(liveActions ?? []),
    [liveActions],
  );
  const ledgerDupe = (source: string, line: string): boolean => {
    if (!liveActions) return false;
    const a = matchAction(liveActions, source, line);
    return a ? byId.has(idKey(a)) : false;
  };
  const toggleAll = async (c: Cluster): Promise<boolean> => {
    let allOk = true;
    for (const a of c.items) {
      const r = await fetch("/api/actions/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: a.callId, index: a.index }),
      }).catch(() => null);
      if (!r?.ok) allOk = false;
    }
    qc.invalidateQueries({ queryKey: ["actions"] });
    return allOk;
  };
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
          <Markdown
            md={digest.md}
            onLedgerToggle={ledgerToggle}
            ledgerState={ledgerState}
            ledgerTitle={ledgerTitle}
            ledgerDupe={ledgerDupe}
            afterH2={{
              pattern: /open action items/i,
              node: <RecurringPanel clusters={clusters} onToggleAll={toggleAll} />,
            }}
          />
        ) : (
          <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>
        )}
      </section>
    </div>
  );
}
