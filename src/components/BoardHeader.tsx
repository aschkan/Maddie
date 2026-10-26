"use client";

/**
 * The line across the top of every board — title, where the data comes from,
 * the board's one-line instruction, the way to the others — and `Sources`,
 * the line under every board that credits the data.
 *
 * The credit is not decoration: Pointer's data may only be shown with its
 * source cited ("Onveilige Plekken kaart 2026, Pointer (KRO-NCRV) i.s.m. het
 * AD en de regionale titels"), so every board that draws it prints it.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";

import { useEvidence } from "@/components/EvidenceProvider";
import { POINTER_CREDIT } from "@/lib/pointer";

const BOARDS = [
  { href: "/", label: "Explore" },
  { href: "/compare", label: "Compare routes" },
  { href: "/area", label: "Area detail" },
];

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function BoardHeader({ title, note }: { title: string; note: React.ReactNode }) {
  const { tone, toggleTheme } = useEvidence();
  const path = usePathname();
  return (
    <header className="board-head">
      <div className="board-title">
        <h1>Maddie — {title}</h1>
        <p className="board-sub">Pointer survey · community reports · OpenStreetMap</p>
      </div>
      <p className="board-note">{note}</p>
      <nav className="board-nav" aria-label="Boards">
        {BOARDS.map((board) => (
          <Link
            key={board.href}
            href={board.href}
            className={path === board.href ? "on" : undefined}
            aria-current={path === board.href ? "page" : undefined}
          >
            {board.label}
          </Link>
        ))}
        <button type="button" className="theme" onClick={toggleTheme} aria-label="Switch light or dark">
          {tone === "night" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </nav>
    </header>
  );
}

/** The credit line every board ends with. */
export function Sources() {
  const { datasets, backend, reportError, reports, reportsLoading, city } = useEvidence();
  const pointer = datasets.find((set) => set.id === "pointer");
  return (
    <footer className="sources">
      <p>
        <b>Reports:</b>{" "}
        {reportsLoading
          ? "loading…"
          : `${reports.length.toLocaleString("en-GB")} within 9 km of ${city.name}`}
        {backend === "browser" && " — no database on this server, so only this browser's own reports"}
        {reportError && <span className="warn"> — {reportError}</span>}
      </p>
      <p>
        <b>Source:</b> {POINTER_CREDIT}
        {pointer?.exportedAt && <> (export of {DATE.format(new Date(pointer.exportedAt))})</>}. Places
        respondents marked in a national survey, with the reason they gave; not incidents, and not a measure of
        risk. Not for commercial use.
      </p>
      <p><b>Streets, lighting and places:</b> © OpenStreetMap contributors.</p>
    </footer>
  );
}
