"use client";

import { use, useCallback, useEffect, useState } from "react";
import { MapView } from "@/components/MapView";
import { Card, GapNotice } from "@/components/ui";
import { getJson, metres } from "@/lib/client";
import { haversineMetres } from "@/lib/geo/distance";
import type { Journey } from "@/lib/domain";

interface WatchBody {
  journey?: Journey;
  message?: string;
}

export default function WatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { ok, body } = await getJson<WatchBody>(`/api/guardian/${encodeURIComponent(token)}`);
      if (!ok || body.journey === undefined) {
        setFailure(body.message ?? "That link is not valid.");
        setJourney(null);
      } else {
        setJourney(body.journey);
        setFailure(null);
      }
    } catch {
      // The watcher's own connection failed. Say so — an empty map here reads
      // as "she has not moved", which is the worst possible wrong answer.
      setFailure("This page could not reach the server just now, so what you can see may be out of date. It is not a sign that anything has happened.");
    }
  }, [token]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const last = journey?.pings.at(-1) ?? null;
  const remaining =
    last === null || journey === null ? null : Math.round(haversineMetres(last, journey.to));

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {journey?.watcherName === undefined || journey.watcherName === "" ? "Watching a walk" : `${journey.watcherName}, watching a walk`}
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          This page refreshes itself every 15 seconds. If it stops updating, that means this page lost the server —
          not that anything has happened.
        </p>
      </header>

      {failure !== null ? <GapNotice gaps={[failure]} title="What this page can see" /> : null}

      {journey !== null ? (
        <>
          <MapView
            centre={last ?? journey.from}
            markers={[
              { lat: journey.from.lat, lng: journey.from.lng, colour: "#ffffff" },
              { lat: journey.to.lat, lng: journey.to.lng, colour: "#b98cff" },
              ...(last === null ? [] : [{ lat: last.lat, lng: last.lng, colour: "#4ade80" }]),
            ]}
            lines={
              journey.pings.length > 1
                ? [{ points: journey.pings.map((ping) => ({ lat: ping.lat, lng: ping.lng })), colour: "#4ade80" }]
                : []
            }
            height="24rem"
          />

          <Card className="space-y-2">
            <p className="text-sm">
              Status: <strong>{statusWord(journey.status)}</strong>
            </p>
            {last === null ? (
              <p className="text-sm text-[var(--color-muted)]">
                No position has been shared yet. She may have chosen not to share one — the link works either way.
              </p>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">
                Last update {new Date(last.at).toLocaleTimeString()}
                {remaining === null ? "" : `, about ${metres(remaining)} from where she is going`}.
              </p>
            )}
            <p className="text-xs text-[var(--color-muted)]">
              Expected to take {journey.expectedMinutes} minutes. This link expires{" "}
              {new Date(journey.expiresAt).toLocaleString()}.
            </p>
          </Card>

          {journey.status === "help" ? (
            <div className="rounded-xl border border-[var(--color-poor)] bg-[var(--color-poor)]/10 p-4">
              <p className="text-sm font-semibold text-[var(--color-poor)]">She has asked for help.</p>
              <p className="mt-1 text-sm">Call her. If you cannot reach her, call the emergency number.</p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function statusWord(status: Journey["status"]): string {
  switch (status) {
    case "walking":
      return "walking";
    case "arrived":
      return "arrived";
    case "help":
      return "asking for help";
    case "expired":
      return "this link has expired";
  }
}
