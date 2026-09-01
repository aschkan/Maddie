import Link from "next/link";

const LINKS = [
  { href: "/", label: "Explore" },
  { href: "/route", label: "Route" },
  { href: "/report", label: "Report" },
  { href: "/interviews", label: "Interviews" },
  { href: "/guardian", label: "Guardian" },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-ink)]/95 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-3">
        <Link href="/" className="mr-4 text-sm font-semibold tracking-tight">
          Maddie
        </Link>
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-full px-3 py-1.5 text-sm text-[var(--color-muted)] transition hover:bg-[var(--color-ink-soft)] hover:text-[var(--color-paper)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
