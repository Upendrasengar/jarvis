// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
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
import { ago, parseStamp } from "../../lib/time";
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

// D3 — the latest digest's ledger renders as LIVE age buckets computed from
// the actions API (exact ids — no text matching needed), replacing the
// snapshot's per-source sections. History keeps the faithful markdown.
function splitLedger(md: string): { before: string; after: string; hasLedger: boolean } {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^## open action items/i.test(l));
  if (start < 0) return { before: md, after: "", hasLedger: false };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (/^## /.test(lines[i])) { end = i; break; }
  return { before: lines.slice(0, start).join("\n"), after: lines.slice(end).join("\n"), hasLedger: true };
}

const DAY_MS = 86_400_000;

function LedgerBuckets({ actions, triage, onToggle }: {
  actions: any[]; triage?: Triage; onToggle: (a: any) => void;
}) {
  const todayISO = new Date().toLocaleDateString("sv-SE");
  const now = Date.now();
  const dl = (a: any) => triage?.deadlines?.[idKey(a)];
  const ageDays = (a: any) =>
    Math.max(0, Math.floor((now - Date.parse(a.callStarted.slice(0, 10) + "T12:00:00")) / DAY_MS));
  const open = actions.filter((a) => !a.done && a.text);
  const overdue = open.filter((a) => dl(a) && dl(a)! < todayISO)
    .sort((x, y) => (dl(x)! < dl(y)! ? -1 : 1));
  const ageing = open.filter((a) => !overdue.includes(a) && ageDays(a) >= 4)
    .sort((x, y) => ageDays(y) - ageDays(x));
  const rest = open.filter((a) => !overdue.includes(a) && !ageing.includes(a))
    .sort((x, y) => y.callStarted.localeCompare(x.callStarted));
  const cleared = actions.filter((a) => a.done && a.text && ageDays(a) <= 7);

  const srcLink = (a: any) =>
    a.callId.startsWith("note:") ? `/notes/${encodeURIComponent(a.callId.slice(5))}` : `/calls/${a.callId}`;

  const Item = ({ a, done = false }: { a: any; done?: boolean }) => {
    const d = dl(a);
    return (
      <div className={`mb-2 flex items-start gap-2 rounded-lg bg-[var(--surf-2)] px-3 py-[8px] ${done ? "opacity-45" : ""}`}>
        <button onClick={() => onToggle(a)} className="cursor-pointer text-[var(--cyan)]">
          {done ? "☑" : "☐"}
        </button>
        <span className="min-w-0 flex-1 font-sans text-[13px] leading-relaxed text-[var(--text)]">
          <span className={done ? "line-through" : ""}>
            {a.owner && <b className="text-[var(--bright)]">{a.owner}: </b>}
            {a.text.replace(/\*\*/g, "")}
          </span>
          <span className="mt-[3px] flex flex-wrap items-center gap-x-2 text-[10px] tracking-[0.5px] text-[var(--dim)]">
            {d && !done && (
              <span className={`font-medium ${d < todayISO ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                DUE {d.slice(5)}
              </span>
            )}
            {!d && !done && ageDays(a) >= 2 && <span>open {ageDays(a)}d</span>}
            <Link to={srcLink(a)} title={a.callTitle}
              className="text-[var(--cyan-dim)] no-underline hover:text-[var(--cyan)]">
              {a.callTitle ? a.callTitle.slice(0, 44) : a.callId} ↗
            </Link>
          </span>
          {(a.comments ?? []).slice(-2).map((c: string, i: number) => {
            const { when, text } = parseStamp(c);
            return (
              <span key={i} className="mt-[2px] block text-[11.5px] leading-snug text-[var(--dim)]">
                <span className="mr-1 text-[var(--cyan-dim)]">↳</span>{text}
                {when && <span className="ml-1 text-[9.5px] opacity-70">· {ago(when)}</span>}
              </span>
            );
          })}
        </span>
      </div>
    );
  };

  const Section = ({ label, tone, items, done = false }: {
    label: string; tone: string; items: any[]; done?: boolean;
  }) =>
    items.length ? (
      <div className="mb-5">
        <div className={`mb-2 text-[10px] uppercase tracking-[2px] ${tone}`}>
          {label} <span className="text-[var(--dim)]">· {items.length}</span>
        </div>
        {items.map((a) => <Item key={idKey(a)} a={a} done={done} />)}
      </div>
    ) : null;

  return (
    <div className="mb-6">
      <Section label="Likely overdue" tone="text-[var(--red)]" items={overdue} />
      <Section label="Ageing" tone="text-[var(--amber)]" items={ageing} />
      <Section label="Open" tone="text-[var(--dim)]" items={rest} />
      <Section label="Cleared this week" tone="text-[var(--green)]" items={cleared} done />
      {!open.length && !cleared.length && (
        <div className="font-sans text-[12.5px] text-[var(--dim)]">All clear.</div>
      )}
    </div>
  );
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
      <aside className="w-[280px] min-w-[280px] overflow-auto border-r border-[var(--line)] bg-[var(--surf)] p-3">
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
                className={`mb-[3px] w-full rounded-xl border px-3 py-2 text-left transition ${
                  d.date === selected
                    ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
                    : "border-transparent hover:bg-[var(--surf-2)]"
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
          viewingLatest && splitLedger(digest.md).hasLedger ? (
            (() => {
              const { before, after } = splitLedger(digest.md);
              return (
                <>
                  <Markdown md={before} ledgerState={ledgerState} ledgerTitle={ledgerTitle} />
                  <h2 className="mb-2 mt-5 max-w-[760px] text-[11px] uppercase tracking-[1.5px] text-[var(--cyan)]">
                    Open action items <span className="ml-2 text-[9px] text-[var(--dim)]">LIVE LEDGER</span>
                  </h2>
                  <div className="max-w-[760px]">
                    <AttentionPanel bucket={bucket} generatedAt={triage?.generatedAt ?? null} onToggleAll={toggleAll} />
                    <LedgerBuckets actions={liveActions ?? []} triage={triage} onToggle={(a) => toggleAll([a])} />
                  </div>
                  <Markdown md={after} ledgerState={ledgerState} ledgerTitle={ledgerTitle} />
                </>
              );
            })()
          ) : (
            <Markdown
              md={digest.md}
              onLedgerToggle={ledgerToggle}
              ledgerState={ledgerState}
              ledgerTitle={ledgerTitle}
            />
          )
        ) : (
          <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>
        )}
      </section>
    </div>
  );
}
