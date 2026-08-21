// Digest history browser — date sidebar + reading pane, deep-linked at
// /digest/:date.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as S from "@jarvis/shared";
import { Link } from "react-router-dom";
import { Fragment, useMemo, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { idKey, shortDate } from "../../lib/actionClusters";
import { attentionBucket, rankAttention, type Chip, type Ranked, type Triage } from "../../lib/attention";

// One attention row: the item text is the content; everything else is ONE
// quiet line — a single colored urgency word, the why-now, and plain date
// links. No pills, no emoji per fact.
function AttentionRow({ r, onToggleAll }: { r: Ranked; onToggleAll: (items: Ranked["cluster"]) => Promise<boolean> }) {
  const [state, setState] = useState<"open" | "busy" | "done">("open");
  const click = async () => {
    if (state !== "open") return;
    setState("busy");
    setState((await onToggleAll(r.cluster)) ? "done" : "open");
  };
  const urgency = r.chips.find((c) => c.kind === "overdue") ?? r.chips.find((c) => c.kind === "due");
  const blocked = r.chips.find((c) => c.kind === "blocked");
  const age = r.chips.find((c) => c.kind === "age");
  // one link per distinct source, deduped by date label
  const seen = new Set<string>();
  const sources = r.cluster
    .map((a) => ({
      to: a.callId.startsWith("note:") ? `/notes/${encodeURIComponent(a.callId.slice(5))}` : `/calls/${a.callId}`,
      label: shortDate(a.callStarted),
      title: a.callTitle,
    }))
    .filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
  return (
    <div className="mb-2.5 flex items-start gap-2">
      <button
        onClick={click}
        title={r.cluster.length > 1 ? `Check off in all ${r.cluster.length} sources` : "Check off in the source note"}
        className={`cursor-pointer text-[var(--cyan)] ${state === "busy" ? "animate-pulse" : ""}`}
      >
        {state === "done" ? "☑" : "☐"}
      </button>
      <span className={`min-w-0 flex-1 ${state === "done" ? "text-[var(--dim)] line-through" : ""}`}>
        <b className="text-[var(--bright)]">{r.item.owner}:</b>{" "}
        {r.item.text.replace(/\*\*/g, "")}
        <span className="mt-[2px] block text-[11px] leading-snug text-[var(--dim)]">
          {urgency && (
            <span className={urgency.kind === "overdue" ? "font-medium text-[var(--red)]" : "font-medium text-[var(--amber)]"}>
              {urgency.label}
            </span>
          )}
          {urgency && (blocked || r.reason) && " — "}
          {r.reason ?? blocked?.label}
          {(urgency || r.reason || blocked) && " · "}
          {r.cluster.length > 1 && `raised in ${r.cluster.length} calls · `}
          {!urgency && age && `${age.label} · `}
          {sources.map((src, i) => (
            <Fragment key={i}>
              {i > 0 && ", "}
              <Link to={src.to} title={src.title}
                className="text-[var(--cyan-dim,#5b9ec4)] underline decoration-dotted underline-offset-2 hover:text-[var(--cyan)]">
                {src.label}
              </Link>
            </Fragment>
          ))}
        </span>
      </span>
    </div>
  );
}

function AttentionPanel({ bucket, generatedAt, onToggleAll }: {
  bucket: Ranked[]; generatedAt: string | null;
  onToggleAll: (items: Ranked["cluster"]) => Promise<boolean>;
}) {
  if (!bucket.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--chipbg)] p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span title="Ranked: overdue → yours → blocking → repeated → aging. Checking an item completes it in every source it appears in."
          className="text-[10px] tracking-[2px] text-[var(--amber)]">NEEDS ATTENTION</span>
        {generatedAt && <span className="text-[9px] text-[var(--dim)]">triaged {generatedAt}</span>}
      </div>
      {bucket.map((r) => (
        <AttentionRow key={idKey(r.item)} r={r} onToggleAll={onToggleAll} />
      ))}

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
  const { data: triage } = useQuery<Triage>({
    queryKey: ["triage"],
    queryFn: async () => (await fetch("/api/triage")).json(),
    staleTime: 60_000,
  });
  const attention = useMemo(
    () => rankAttention(liveActions ?? [], triage),
    [liveActions, triage],
  );
  const bucket = useMemo(() => attentionBucket(attention.ranked), [attention]);
  const bucketIds = useMemo(
    () => new Set(bucket.flatMap((r) => r.cluster.map((a: any) => idKey(a)))),
    [bucket],
  );
  const ledgerDupe = (source: string, line: string): boolean => {
    if (!liveActions) return false;
    const a = matchAction(liveActions, source, line);
    // dim ONLY items that actually have a row in the attention panel above —
    // a clustered item that didn't make the capped bucket keeps its checkbox
    return a ? bucketIds.has(idKey(a)) : false;
  };
  const toggleAll = async (items: any[]): Promise<boolean> => {
    let allOk = true;
    for (const a of items) {
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
  // the Recurring panel reflects the CURRENT open-items state — it belongs
  // only on the latest digest, not injected anachronistically into history
  const viewingLatest = selected != null && selected === list[0]?.date;
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
            ledgerDupe={viewingLatest ? ledgerDupe : undefined}
            afterH2={
              viewingLatest
                ? {
                    pattern: /open action items/i,
                    node: <AttentionPanel bucket={bucket} generatedAt={triage?.generatedAt ?? null} onToggleAll={toggleAll} />,
                  }
                : undefined
            }
          />
        ) : (
          <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>
        )}
      </section>
    </div>
  );
}
