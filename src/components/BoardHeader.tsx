"use client";

/**
 * The line across the top of every board: the title, what kind of data is on
 * the screen, the board's own one-line instruction, and the way to the others.
 *
 * The subtitle is not decoration. "Synthetic example data" is printed whenever
 * anything invented is on screen — the dashboard spec's rule that every caveat
 * lives on the page itself.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";

import { useEvidence } from "@/components/EvidenceProvider";

const BOARDS = [
  { href: "/", label: "Explore" },
  { href: "/compare", label: "Compare routes" },
  { href: "/area", label: "Area detail" },
];

export default function BoardHeader({ title, note, kind }: { title: string; note: React.ReactNode; kind: string }) {
  const { usingExamples, tone, toggleTheme } = useEvidence();
  const path = usePathname();
  return (
    <header className="board-head">
      <div className="board-title">
        <h1>Maddie — {title}</h1>
        <p className="board-sub">
          {usingExamples ? <>CONCEPT MOCKUP <span aria-hidden>•</span> {kind}</> : <>Community reports · OpenStreetMap</>}
        </p>
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
