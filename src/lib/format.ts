/** Distances and durations, written the way a person would say them. */

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  // One decimal up to 10 km, none above: "9.4 km" is useful, "23.7 km" is noise.
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds / 60);
  if (total < 1) return "under a minute";
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
