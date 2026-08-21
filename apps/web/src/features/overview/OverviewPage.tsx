// Command-center overview: daily-moving KPIs (each a door to its tab),
// today's focus from the digest, git activity, live agents + recording,
// today's calls, git activity — around the neural-core globe.
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

function Panel({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 backdrop-blur-lg">
      <h3 className="mb-2 flex justify-between text-[10px] uppercase tracking-[1.5px] text-[var(--cyan)]">
        {title} <span className="text-[var(--dim)]">{tag}</span>
      </h3>
      {children}
    </div>
  );
}

const Row = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
  <div
    onClick={onClick}
    className={`truncate border-b border-dashed border-[rgba(60,140,220,.1)] py-[5px] font-sans text-[12.5px] leading-relaxed text-[var(--text)] ${onClick ? "cursor-pointer hover:text-[var(--cyan)]" : ""}`}
  >
    {children}
  </div>
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
  const meetings = (cal?.enabled ? cal.events : []).filter((e) => e.start?.startsWith(todayISO));
  const prepMe = (e: any) => {
    const att = (e.attendees ?? []).slice(0, 10).join(", ");
    sessionStorage.setItem("jarvis_pending", JSON.stringify({
      text:
        `Prep me for my "${e.subject}" meeting at ${e.start.slice(11, 16)} today` +
        (att ? ` with ${att}` : "") +
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

  const focus = ((dig?.md ?? "").split(/## Suggested focuses/i)[1] ?? "").split(/\n## /)[0]
    .split("\n").filter((l) => /^\s*(\d+\.|[-*])\s+/.test(l))
    .map((l) => l.replace(/^\s*(\d+\.|[-*])\s+/, "").replace(/\*\*/g, "").trim()).slice(0, 3);

  const kpis: Array<[string, string | number, string, string]> = [
    ["Active Projects", s?.stats.activeProjects ?? "…", `of ${s?.stats.totalProjects ?? "…"}`, "/projects"],
    ["Commits", s?.stats.commits7d ?? "…", "7 days", "/digest"],
    ["Calls", todaysCalls.length, "today", "/calls"],
    ["Open Actions", openActions, "from calls", "/actions"],
    ["Brain Notes", s?.stats.notes ?? "…", `${s?.stats.links ?? "…"} links`, "/brain"],
    ["Overdue", bucket.filter((r) => r.chips.some((c) => c.kind === "overdue")).length, "needs action", "/actions"],
  ];

  return (
    <div className="grid h-full grid-cols-[300px_1fr_300px] grid-rows-[auto_1fr] gap-3 p-3">
      <div className="col-span-3 grid grid-cols-6 gap-2">
        {kpis.map(([lbl, val, sub, to]) => (
          <button
            key={lbl}
            onClick={() => navigate(to)}
            className="relative overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] p-[10px] text-left transition hover:-translate-y-[2px] hover:border-[rgba(57,215,255,.45)]"
          >
            <div className="text-[9px] uppercase tracking-[1.5px] text-[var(--dim)]">{lbl}</div>
            <div className="mt-[2px] text-xl font-bold text-[var(--bright)]">{val}</div>
            <div className="text-[10px] text-[var(--green)]">{sub}</div>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        <Panel title="A-01 · Today's Focus" tag="FROM DIGEST">
          {focus.length
            ? focus.map((f, i) => (
                <Link
                  key={i}
                  to="/digest"
                  className="block whitespace-normal border-b border-dashed border-[rgba(60,140,220,.1)] py-[6px] font-sans text-[12.5px] leading-relaxed text-[var(--text)] no-underline hover:text-[var(--cyan)]"
                >
                  <b className="mr-2 text-[var(--cyan)]">{i + 1}</b>{f}
                </Link>
              ))
            : <Row>No digest yet — ask Jarvis for one.</Row>}
        </Panel>
        <Panel title="A-02 · Needs Attention" tag="LIVE">
          {bucket.length
            ? bucket.map((r) => {
                const urgent = r.chips.find((c) => c.kind === "overdue" || c.kind === "due" || c.kind === "blocked");
                return (
                  <div key={idKey(r.item)} className="flex items-start gap-2 border-b border-dashed border-[rgba(60,140,220,.1)] py-[6px] font-sans text-[12.5px] leading-relaxed text-[var(--text)]">
                    <button
                      onClick={() => toggleCluster(r.cluster)}
                      title={r.cluster.length > 1 ? `Check off in all ${r.cluster.length} sources` : "Check off"}
                      className="cursor-pointer text-[var(--cyan)]"
                    >☐</button>
                    <span className="min-w-0 flex-1">
                      <b className="text-[var(--bright)]">{r.item.owner}:</b> {r.item.text.replace(/\*\*/g, "").slice(0, 110)}
                      {urgent && (
                        <span className={`ml-1 text-[10px] font-medium ${urgent.kind === "overdue" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                          {urgent.label}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })
            : <Row>Nothing urgent — the ledger is calm.</Row>}
        </Panel>
      </div>

      <div className="relative min-h-0">
        <NeuralCore
          status={{
            recording: !!recording,
            processing: calls.some((c) => c.status === "processing"),
            agents: working.length,
          }}
        />
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        {cal?.enabled && (
          <Panel title="Z-00 · Today" tag={String(meetings.length || "—")}>
            {meetings.length
              ? meetings.map((e, i) => {
                  const past = Date.parse(e.end || e.start) < Date.now();
                  return (
                    <Row key={i} onClick={() => prepMe(e)}>
                      <span className={past ? "opacity-50" : ""}>
                        <b className="text-[var(--text)]">{e.start.slice(11, 16)}</b>{" "}
                        {e.subject.slice(0, 40)}
                        {!past && <span className="ml-1 text-[9px] text-[var(--cyan)]">prep ↗</span>}
                      </span>
                    </Row>
                  );
                })
              : <Row>No meetings today.</Row>}
          </Panel>
        )}
        <Panel title="Z-01 · Live Now" tag={`${working.length}/${agents.length}`}>
          {recording && (
            <div
              onClick={() => navigate(`/calls/${recording.id}`)}
              className="blip mb-2 cursor-pointer rounded-lg border border-[rgba(255,92,122,.4)] bg-[rgba(255,92,122,.08)] px-3 py-2 text-[11px] text-[var(--red)]"
            >
              ● recording a call now — tap to open
            </div>
          )}
          {working.length
            ? working.map((a) => (
                <Row key={a.id}><b className="text-[var(--text)]">{a.project}</b> · {a.task.slice(0, 50)}</Row>
              ))
            : <Row>No active agents. Ask Jarvis to "work on &lt;project&gt;".</Row>}
        </Panel>
        <Panel title="Z-02 · Calls Today" tag={String(todaysCalls.length || "—")}>
          {todaysCalls.length
            ? todaysCalls.slice(0, 5).map((c) => {
                const open = ((c.notes.match(/- \[ \]/g)) ?? []).length;
                return (
                  <Row key={c.id} onClick={() => navigate(`/calls/${c.id}`)}>
                    <b className="text-[var(--text)]">{callTitle(c).slice(0, 34)}</b> · {c.started.slice(11, 16)}
                    {open ? <span className="text-[var(--amber)]"> · {open} open</span> : null}
                  </Row>
                );
              })
            : <Row>No calls captured today.</Row>}
        </Panel>
        <Panel title="Z-03 · Recent Git Activity" tag="7D">
          {(s?.activity.length ? s.activity : ["no commits in the last window — quiet repo day"])
            .map((a, i) => <Row key={i}>{a.slice(0, 80)}</Row>)}
        </Panel>
      </div>
    </div>
  );
}
