"use client";

import { useEffect, useRef, useState } from "react";
import { MapView } from "@/components/MapView";
import { Card, Field, GapNotice, buttonClass, inputClass } from "@/components/ui";
import { DEFAULT_CENTRE, copyText, getJson, postJson } from "@/lib/client";
import type { GeoPlace } from "@/lib/sources/pdok";

interface CreateBody {
  token?: string;
  watchUrl?: string;
  expiresAt?: string;
  note?: string | null;
  message?: string;
}

interface GeocodeBody {
  places: GeoPlace[];
  note: string | null;
}

export default function GuardianPage() {
  const [from, setFrom] = useState(DEFAULT_CENTRE);
  const [to, setTo] = useState({ lat: DEFAULT_CENTRE.lat + 0.01, lng: DEFAULT_CENTRE.lng + 0.01 });
  const [toText, setToText] = useState("");
  const [watcherName, setWatcherName] = useState("");
  const [expectedMinutes, setExpectedMinutes] = useState(30);
  const [created, setCreated] = useState<CreateBody | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const watcher = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (watcher.current !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watcher.current);
      }
    },
    [],
  );

  const locate = async (): Promise<void> => {
    if (toText.trim() === "") return;
    const { body } = await getJson<GeocodeBody>(`/api/geocode?q=${encodeURIComponent(toText)}`);
    const first = body.places[0];
    if (first !== undefined) setTo(first.point);
    else setFailure(body.note ?? "That address could not be found.");
  };

  const create = async (): Promise<void> => {
    setFailure(null);
    try {
      const { ok, body } = await postJson<CreateBody>("/api/guardian", {
        from,
        to,
        fromLabel: "",
        toLabel: toText,
        watcherName,
        expectedMinutes,
      });
      if (!ok) setFailure(body.message ?? "The link could not be created.");
      else setCreated(body);
    } catch {
      setFailure("The server could not be reached, so no link was created.");
    }
  };

  const startSharing = (token: string): void => {
    if (typeof navigator === "undefined" || navigator.geolocation === undefined) {
      setFailure("This browser will not share a position, so the link will show the route but not where you are.");
      return;
    }
    setSharing(true);
    watcher.current = navigator.geolocation.watchPosition(
      (position) => {
        void postJson(`/api/guardian/${token}`, {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          status: "walking",
          note: "",
        });
      },
      () => setFailure("Position sharing was refused, so the link shows the route but not where you are."),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  };

  const arrive = async (token: string): Promise<void> => {
    if (watcher.current !== null) navigator.geolocation.clearWatch(watcher.current);
    watcher.current = null;
    setSharing(false);
    await postJson(`/api/guardian/${token}`, { lat: to.lat, lng: to.lng, status: "arrived", note: "" });
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Someone to watch the walk</h1>
        <p className="text-sm text-[var(--color-muted)]">
          A link you send to one person. It shows where you are going and, if you let it, where you are. It expires
          on its own — a watch link that never expires is a tracking link.
        </p>
      </header>

      <MapView
        centre={from}
        markers={[
          { lat: from.lat, lng: from.lng, colour: "#ffffff" },
          { lat: to.lat, lng: to.lng, colour: "#b98cff" },
        ]}
        onPick={setTo}
      />

      <Card className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Going to">
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="address, or click the map"
                value={toText}
                onChange={(event) => setToText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void locate();
                }}
              />
              <button type="button" onClick={() => void locate()} className="rounded-lg border border-[var(--color-line)] px-3 text-xs">
                Find
              </button>
            </div>
          </Field>
          <Field label="Who is watching">
            <input
              className={inputClass}
              placeholder="a first name, for them"
              value={watcherName}
              onChange={(event) => setWatcherName(event.target.value)}
            />
          </Field>
          <Field label="Expected to take">
            <select
              className={inputClass}
              value={expectedMinutes}
              onChange={(event) => setExpectedMinutes(Number(event.target.value))}
            >
              {[10, 15, 20, 30, 45, 60, 90, 120].map((option) => (
                <option key={option} value={option}>
                  {option} minutes
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            if (typeof navigator !== "undefined" && navigator.geolocation !== undefined) {
              navigator.geolocation.getCurrentPosition((position) =>
                setFrom({ lat: position.coords.latitude, lng: position.coords.longitude }),
              );
            }
            void create();
          }}
        >
          Make a watch link
        </button>
      </Card>

      {failure !== null ? <GapNotice gaps={[failure]} title="Worth knowing" /> : null}

      {created?.watchUrl !== undefined ? (
        <Card className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Send this to them</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-xs">
              {created.watchUrl}
            </code>
            <button
              type="button"
              className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs"
              onClick={() => {
                void copyText(created.watchUrl!).then(setCopied);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            Expires {created.expiresAt === undefined ? "shortly" : new Date(created.expiresAt).toLocaleString()}.
          </p>
          {created.note !== null && created.note !== undefined ? (
            <GapNotice gaps={[created.note]} title="Before you rely on this" />
          ) : null}
          <div className="flex gap-2">
            {sharing ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--color-good)] px-4 py-2 text-sm text-[var(--color-good)]"
                onClick={() => void arrive(created.token!)}
              >
                I have arrived
              </button>
            ) : (
              <button type="button" className={buttonClass} onClick={() => startSharing(created.token!)}>
                Start sharing where I am
              </button>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
