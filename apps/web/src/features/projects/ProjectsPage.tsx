import { useQuery } from "@tanstack/react-query";
import * as S from "@jarvis/shared";

export function ProjectsPage() {
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => S.Project.array().parse(await (await fetch("/api/projects")).json()),
  });
  return (
    <div className="h-full overflow-auto p-5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {projects.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 backdrop-blur-lg transition hover:border-[rgba(57,215,255,.4)]"
          >
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--cyan)]">
              {p.category || "project"}
              {p.status === "active" && (
                <span className="ml-2 rounded-full bg-[rgba(62,224,138,.14)] px-2 py-[1px] text-[9px] text-[var(--green)]">
                  active
                </span>
              )}
            </div>
            <h4 className="mb-1 font-sans text-[13px] font-semibold text-[var(--bright)]">{p.id}</h4>
            <div className="font-sans text-[11px] text-[var(--dim)]">{p.what}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
