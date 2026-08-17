import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CallDetail } from "./CallDetail";
import { CallList } from "./CallList";
import { useCalls } from "./hooks";

export function CallsPage() {
  const { data: calls = [], isLoading } = useCalls();
  const { id } = useParams();
  const navigate = useNavigate();

  const selected = calls.find((c) => c.id === id) ?? calls[0] ?? null;

  // normalize the URL to the selected call (deep links stay shareable)
  useEffect(() => {
    if (selected && selected.id !== id) navigate(`/calls/${selected.id}`, { replace: true });
  }, [selected?.id, id]);

  if (isLoading)
    return <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>;

  return (
    <div className="flex h-full">
      <CallList
        calls={calls}
        selected={selected?.id ?? null}
        onSelect={(cid) => navigate(`/calls/${cid}`)}
      />
      <section className="min-w-0 flex-1">
        <CallDetail call={selected} onDeleted={() => navigate("/calls", { replace: true })} />
      </section>
    </div>
  );
}
