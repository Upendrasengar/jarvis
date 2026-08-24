// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Command-center overview, redesign v2: left instrument stack (focus + KPI
// tiles), the neural core center with a stats band beneath, right column of
// needs-attention cards, today's meetings, and a live activity feed.
// All behavior identical to main — presentation only.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import * as S from "@jarvis/shared";
import { NeuralCore } from "./NeuralCore";
import { useCalls, callTitle } from "../calls/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { attentionBucket, rankAttention, type Triage } from "../../lib/attention";
import { idKey } from "../../lib/actionClusters";

function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async () => S.Stats.parse(await (await fetch("/api/stats")).json()),
  });
}
function useLatestDigest() {
  return useQuery({
    queryKey: ["digest", "latest"],
    queryFn: async () => S.Digest.parse(await (await fetch("/api/digest")).json()),
  });
}
function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await fetch("/api/agents")).json() as Promise<any[]>,
    refetchInterval: 8000,
  });
}

function Card({ title, tag, children, className = "" }: {
  title: string; tag?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`min-h-0 overflow-auto rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 [box-shadow:var(--shadow)] ${className}`}>
      <h3 className="mb-3 flex items-baseline justify-between text-[10px] uppercase tracking-[2px] text-[var(--dim)]">
        <span className="text-[var(--text)]">{title}</span>
        <span>{tag}</span>
      </h3>
      {children}
    </div>
  );
}

const Quiet = ({ children }: { children: React.ReactNode }) => (
  <div className="py-1 font-sans text-[12.5px] leading-relaxed text-[var(--dim)]">{children}</div>
);

export function OverviewPage() {
  const { data: s } = useStats();
  const { data: calls = [] } = useCalls();
  const { data: dig } = useLatestDigest();
  const { data: agents = [] } = useAgents();
  const navigate = useNavigate();

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todaysCalls = calls.filter((c) => c.id.startsWith(today) && c.status !== "empty");
  const openActions = calls.reduce((n, c) => n + ((c.notes.match(/- \[ \]/g)) ?? []).length, 0);
  const recording = calls.find((c) => c.status === "recording");
  const working = agents.filter((a) => a.status === "working" && !a.silent);

  const qc = useQueryClient();
  const { data: liveActions } = useQuery<any[]>({
    queryKey: ["actions"],
    queryFn: async () => (await fetch("/api/actions")).json(),
    staleTime: 30_000,
  });
  const { data: triage } = useQuery<Triage>({
    queryKey: ["triage"],
    queryFn: async () => (await fetch("/api/triage")).json(),
    staleTime: 60_000,
  });
  const bucket = attentionBucket(rankAttention(liveActions ?? [], triage).ranked, 5);
  // optional calendar adapter — card renders only when configured
  const { data: cal } = useQuery<{ enabled: boolean; events: any[] }>({
    queryKey: ["calendar"],
    queryFn: async () => (await fetch("/api/calendar")).json(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const todayISO = new Date().toLocaleDateString("sv-SE");
  // feed timestamps are UTC — compare and display in LOCAL time
  const localDay = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");
  const localTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const meetings = (cal?.enabled ? cal.events : []).filter((e) => e.start && localDay(e.start) === todayISO);
  const prepMe = (e: any) => {
    const att = (e.attendees ?? []).slice(0, 10).join(", ");
    sessionStorage.setItem("jarvis_pending", JSON.stringify({
      text:
        `Prep me for my "${e.subject}" meeting at ${localTime(e.start)} today` +
        (att ? ` with ${att}` : "") +
        (e.description ? `. The invite says: "${String(e.description).slice(0, 500)}"` : "") +
        `. Search my calls, notes, and topic graph for previous meetings with this title or these people, ` +
        `list open action items involving them (flag anything overdue), and tell me what I should raise.`,
      voice: false,
    }));
    navigate("/chat");
  };
  const toggleCluster = async (items: any[]) => {
    for (const a of items)
      await fetch("/api/actions/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: a.callId, index: a.index }),
      }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["actions"] });
  };

  // structured focus items: '**Title** — why it matters. (due: YYYY-MM-DD)';
  // pre-structure digests fall back to a plain-text card
  const focus = ((dig?.md ?? "").split(/## Suggested focuses/i)[1] ?? "").split(/\n## /)[0]
    .split("\n").filter((l) => /^\s*(\d+\.|[-*])\s+/.test(l))
    .map((l) => {
      const raw = l.replace(/^\s*(\d+\.|[-*])\s+/, "").trim();
      const due = raw.match(/\(due:\s*(\d{4}-\d{2}-\d{2})\)\s*$/)?.[1];
      const body = raw.replace(/\s*\(due:[^)]*\)\s*$/, "").trim();
      const tm = body.match(/^\*\*(.+?)\*\*\s*[—–-]?\s*/);
      return {
        title: tm?.[1],
        desc: (tm ? body.slice(tm[0].length) : body).replace(/\*\*/g, "").trim(),
        due,
      };
    }).slice(0, 3);
  const dueMeta = (due: string) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((new Date(due + "T00:00:00").getTime() - today.getTime()) / 86_400_000);
    const label = new Date(due + "T12:00:00")
      .toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
    return { days, label };
  };

  const overdueCount = bucket.filter((r) => r.chips.some((c) => c.kind === "overdue")).length;
  const tiles: Array<[string, string | number, string, string, string]> = [
    ["Active Projects", s?.stats.activeProjects ?? "…", `of ${s?.stats.totalProjects ?? "…"}`, "/projects",
      "M3 6h6l2 2h10v11H3z"],
    ["Open Actions", openActions, "from calls", "/actions", "M13 2 6 14h5l-1 8 7-12h-5z"],
    ["Overdue", overdueCount, overdueCount ? "needs action" : "all clear", "/actions",
      "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8v4l3 2"],
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="grid min-h-0 flex-1 grid-cols-[300px_1fr_320px] gap-3">
        {/* ── left: focus + instrument stack ── */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card title="Today's Focus" tag="FROM DIGEST" className="flex-1">
            {focus.length
              ? focus.map((f, i) => {
                  const meta = f.due ? dueMeta(f.due) : null;
                  const urgent = meta !== null && meta.days <= 5;
                  return (
                    <Link
                      key={i}
                      to="/digest"
                      className={`group mb-2 block rounded-lg border-l-2 bg-[var(--surf-2)] px-3 py-[8px] no-underline transition ${
                        urgent ? "border-[var(--red)]" : "border-[var(--cyan-3)] hover:border-[var(--cyan)]"}`}
                    >
                      {f.title && (
                        <span className="block font-sans text-[12.5px] font-semibold leading-snug text-[var(--bright)]">
                          {f.title}
                        </span>
                      )}
                      <span className={`block font-sans text-[12px] leading-relaxed ${f.title ? "text-[var(--dim)]" : "text-[var(--text)]"}`}>
                        {f.desc}
                      </span>
                      {meta && (
                        <span className={`mt-[6px] inline-block rounded border px-[7px] py-[2px] text-[8.5px] tracking-[1.2px] ${
                          urgent
                            ? "border-[rgba(255,107,132,.4)] bg-[rgba(255,107,132,.1)] text-[var(--red)]"
                            : "border-[var(--line)] text-[var(--dim)]"}`}>
                          {meta.days < 0 ? `OVERDUE · WAS ${meta.label}` :
                           meta.days === 0 ? `DUE TODAY` :
                           `DUE ${meta.label} · ${meta.days} DAY${meta.days === 1 ? "" : "S"}`}
                        </span>
                      )}
                    </Link>
                  );
                })
              : <Quiet>No digest yet — ask Jarvis for one.</Quiet>}
          </Card>
          {tiles.map(([lbl, val, sub, to, icon]) => (
            <button
              key={lbl}
              onClick={() => navigate(to)}
              className="flex shrink-0 items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 text-left transition [box-shadow:var(--shadow)] hover:border-[var(--cyan-3)]"
            >
              <span>
                <span className="block text-[9.5px] uppercase tracking-[2px] text-[var(--dim)]">{lbl}</span>
                <span className="mt-1 flex items-baseline gap-2">
                  <span className="text-[28px] font-semibold leading-none text-[var(--bright)] [font-family:var(--display)]">{val}</span>
                  <span className="font-sans text-[11px] text-[var(--dim)]">{sub}</span>
                </span>
              </span>
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-[var(--indigo-2)] text-[var(--indigo)]">
                <svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                  <path d={icon} />
                </svg>
              </span>
            </button>
          ))}
        </div>

        {/* ── center: the core (untouched per D1) ── */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surf)] [box-shadow:var(--shadow)]">
          <div className="relative min-h-0 flex-1">
            <NeuralCore
              status={{
                recording: !!recording,
                processing: calls.some((c) => c.status === "processing"),
                agents: working.length,
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--line)] bg-[var(--surf)] px-5 py-3">
            {[
              ["COMMITS 7D", String(s?.stats.commits7d ?? "…")],
              ["CALLS TODAY", String(todaysCalls.length)],
              ["BRAIN NOTES", `${s?.stats.notes ?? "…"} · ${s?.stats.links ?? "…"} links`],
            ].map(([k, v]) => (
              <span key={k} className="text-[9.5px] tracking-[1.5px] text-[var(--dim)]">
                {k} <b className="ml-1 text-[12px] font-semibold text-[var(--text)] [font-family:var(--display)]">{v}</b>
              </span>
            ))}
            <span className="ml-auto flex gap-2">
              <button
                onClick={() => navigate("/chat")}
                className="rounded-full border border-[var(--line-2)] px-4 py-[6px] text-[10px] tracking-[1.5px] text-[var(--text)] transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
              >
                ASK JARVIS
              </button>
              <button
                onClick={() => fetch("/api/calls/startrec", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {})}
                className="rounded-full bg-[var(--cyan-2)] px-4 py-[6px] text-[10px] tracking-[1.5px] text-[var(--cyan)] outline outline-1 outline-[var(--cyan-3)] transition hover:bg-[var(--cyan-3)]"
              >
                ● RECORD A CALL
              </button>
            </span>
          </div>
        </div>

        {/* ── right: attention, meetings, activity ── */}
        <div className="flex min-h-0 flex-col gap-3">
          <Card title="Needs Attention" tag={bucket.length ? <span className="rounded-full bg-[rgba(255,107,132,.12)] px-2 py-[2px] text-[9px] tracking-[1.5px] text-[var(--red)]">{bucket.length} TASKS</span> : undefined} className="flex-1">
            {bucket.length
              ? bucket.map((r) => {
                  // design anatomy: bold title, dim reason, one filled chip;
                  // red accent only when a deadline is live
                  const due = r.chips.find((c) => c.kind === "overdue" || c.kind === "due");
                  const blocked = r.chips.find((c) => c.kind === "blocked");
                  const recur = r.chips.find((c) => c.kind === "recur");
                  const hot = !!due;
                  const chip = [due?.label, blocked?.label, recur?.label]
                    .filter(Boolean).join(" · ").toUpperCase();
                  return (
                    <div key={idKey(r.item)} className={`mb-2 flex items-start gap-2.5 rounded-xl border-l-2 bg-[var(--surf-2)] px-3 py-[9px] ${hot ? "border-[var(--red)]" : "border-[var(--line-2)]"}`}>
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => toggleCluster(r.cluster)}
                        title={r.cluster.length > 1 ? `Check off in all ${r.cluster.length} sources` : "Check off"}
                        className="chk mt-[2px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-sans text-[12.5px] font-semibold leading-snug text-[var(--bright)]">
                          {r.item.text.replace(/\*\*/g, "").slice(0, 110)}
                        </span>
                        {r.reason && (
                          <span className="mt-[2px] block font-sans text-[11.5px] leading-snug text-[var(--dim)]">
                            {r.reason}
                          </span>
                        )}
                        {chip && (
                          <span className={`mt-[6px] inline-block max-w-full truncate rounded px-[7px] py-[2px] text-[8.5px] tracking-[1.2px] ${
                            hot ? "bg-[rgba(255,107,132,.12)] text-[var(--red)]" : "bg-[var(--surf)] text-[var(--dim)]"}`}>
                            {chip}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })
              : <Quiet>Nothing urgent — the ledger is calm.</Quiet>}
          </Card>

          {cal?.enabled && (
            <Card
              title="Today"
              tag={
                <span className="flex items-center gap-1.5">
                  {meetings.length > 0 && (
                    <span className="rounded-full border border-[var(--line)] bg-[var(--surf-2)] px-2 py-[1px] text-[9px] tracking-[1px] text-[var(--dim)]">
                      {meetings.length} MEETING{meetings.length === 1 ? "" : "S"}
                    </span>
                  )}
                  <button
                    onClick={async (e) => {
                      const el = e.currentTarget.querySelector("svg");
                      el?.classList.add("animate-spin");
                      await fetch("/api/calendar/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
                      qc.invalidateQueries({ queryKey: ["calendar"] });
                      el?.classList.remove("animate-spin");
                    }}
                    title="Resync the calendar feed now"
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[var(--line)] text-[var(--dim)] transition hover:border-[var(--cyan-3)] hover:text-[var(--cyan)]"
                  >
                    <svg viewBox="0 0 24 24" className="h-[11px] w-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <path d="M21 3v6h-6" />
                    </svg>
                  </button>
                </span>
              }
              className="flex-1"
            >
              {(() => {
                if (!meetings.length) return <Quiet>No meetings today.</Quiet>;
                const now = Date.now();
                const phase = (e: any) =>
                  now > Date.parse(e.end || e.start) ? 2 : now >= Date.parse(e.start) ? 0 : 1;
                const ordered = [...meetings].sort((a, b) =>
                  phase(a) - phase(b) || a.start.localeCompare(b.start));
                const nextUp = ordered.find((e) => phase(e) === 1);
                const dur = (e: any) => {
                  const m = Math.round((Date.parse(e.end || e.start) - Date.parse(e.start)) / 60_000);
                  return m >= 60 ? `${+(m / 60).toFixed(1)}h`.replace(".0", "") : `${m}m`;
                };
                const inLabel = (e: any) => {
                  const m = Math.round((Date.parse(e.start) - now) / 60_000);
                  return m < 60 ? `in ${m}m` : `in ${Math.round(m / 60)}h`;
                };
                return ordered.map((e, i) => {
                  const ph = phase(e);
                  const bar =
                    ph === 0 ? "bg-[var(--red)]"
                    : e === nextUp ? "bg-[var(--amber)]"
                    : ph === 1 ? "bg-[var(--cyan-3)]"
                    : "bg-[var(--line)]";
                  return (
                    <div
                      key={i}
                      onClick={() => prepMe(e)}
                      className={`flex cursor-pointer gap-2 rounded-lg px-1 py-[6px] transition hover:bg-[var(--surf-2)] ${ph === 2 ? "opacity-40" : ""}`}
                    >
                      <span className="w-[42px] shrink-0 text-right">
                        <b className="block text-[11.5px] leading-tight text-[var(--text)] [font-family:var(--display)]">{localTime(e.start)}</b>
                        <span className="block text-[9.5px] text-[var(--dim)]">{dur(e)}</span>
                      </span>
                      <span className={`w-[3px] shrink-0 self-stretch rounded-full ${bar}`} />
                      <span className="min-w-0 flex-1 font-sans text-[12.5px] leading-snug text-[var(--text)]">
                        <span className="block truncate">{e.subject}</span>
                        <span className="block text-[10px] text-[var(--dim)]">
                          {ph === 0 && <span className="blip font-medium text-[var(--red)]">now</span>}
                          {ph === 1 && e === nextUp && <span className="font-medium text-[var(--amber)]">{inLabel(e)}</span>}
                          {(ph === 0 || (ph === 1 && e === nextUp)) && e.attendees?.length > 0 && " · "}
                          {e.attendees?.length > 0 && `${e.attendees.length} people`}
                        </span>
                      </span>
                    </div>
                  );
                });
              })()}
            </Card>
          )}

          <Card title="Activity" tag={working.length ? `${working.length} LIVE` : undefined} className="flex-1">
            {recording && (
              <div
                onClick={() => navigate(`/calls/${recording.id}`)}
                className="blip mb-2 cursor-pointer rounded-lg border-l-2 border-[var(--red)] bg-[var(--surf-2)] px-3 py-2 font-sans text-[11.5px] text-[var(--red)]"
              >
                ● recording a call now — tap to open
              </div>
            )}
            {working.map((a) => (
              <div key={a.id} className="mb-1.5 flex gap-2 font-sans text-[12px] leading-relaxed">
                <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--cyan)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                  <b>{a.project}</b> · {a.task.slice(0, 46)}
                </span>
              </div>
            ))}
            {todaysCalls.slice(0, 4).map((c) => {
              const open = ((c.notes.match(/- \[ \]/g)) ?? []).length;
              return (
                <div key={c.id} onClick={() => navigate(`/calls/${c.id}`)}
                  className="mb-1.5 flex cursor-pointer gap-2 font-sans text-[12px] leading-relaxed hover:text-[var(--cyan)]">
                  <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--green)]" />
                  <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                    {callTitle(c).slice(0, 38)}
                    <span className="ml-1 text-[10px] text-[var(--dim)]">{c.started.slice(11, 16)}{open ? ` · ${open} open` : ""}</span>
                  </span>
                </div>
              );
            })}
            {(s?.activity ?? []).slice(0, 3).map((a, i) => (
              <div key={i} className="mb-1.5 flex gap-2 font-sans text-[12px] leading-relaxed">
                <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--indigo)]" />
                <span className="min-w-0 flex-1 truncate text-[var(--dim)]">{a.slice(0, 70)}</span>
              </div>
            ))}
            {!working.length && !todaysCalls.length && !(s?.activity ?? []).length && (
              <Quiet>Quiet so far — no agents, calls, or commits today.</Quiet>
            )}
          </Card>
        </div>
      </div>

      {/* ── status footer: the promise, always visible ── */}
      <div className="flex shrink-0 items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--surf)] px-4 py-[6px] text-[9px] tracking-[1.5px] text-[var(--dim)]">
        <span>
          <b className="text-[var(--green)]">●</b> SYNCED · WHISPER {String((s as any)?.stats?.whisper ?? "LOCAL")} · AUDIO RETAINED LOCALLY
        </span>
        <span>LOCAL ONLY — NOTHING LEAVES THE MACHINE</span>
      </div>
    </div>
  );
}
