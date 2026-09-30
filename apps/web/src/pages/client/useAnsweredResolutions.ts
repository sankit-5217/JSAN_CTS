import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";
import type { TicketProgress } from "./clientTicket";

/**
 * Ids of RESOLVED tickets the customer has already answered "is it fixed?"
 * for. Those stay RESOLVED until the desk closes or reopens them, but no
 * longer need the customer. One progress read per resolved ticket, which is
 * a handful at most; a failed read just leaves the ticket flagged.
 */
export function useAnsweredResolutions(
  incidents: { id: string; status: string }[] | null,
): Set<string> {
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const resolvedKey = (incidents ?? [])
    .filter((i) => i.status === "RESOLVED")
    .map((i) => i.id)
    .join(",");

  useEffect(() => {
    if (!resolvedKey) {
      setAnswered(new Set());
      return;
    }
    let cancelled = false;
    Promise.all(
      resolvedKey.split(",").map((id) =>
        apiGet<TicketProgress>(`/incidents/${id}/progress`)
          .then((p) => (p.feedback ? id : null))
          .catch(() => null),
      ),
    ).then((ids) => {
      if (!cancelled) setAnswered(new Set(ids.filter((id): id is string => id !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedKey]);

  return answered;
}
