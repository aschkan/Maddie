export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function level(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in ORDER ? (raw as LogLevel) : "info";
}

function emit(at: LogLevel, scope: string, message: string, extra?: unknown): void {
  if (ORDER[at] < ORDER[level()]) return;
  const line = `[maddie:${scope}] ${message}`;
  if (at === "error") console.error(line, extra ?? "");
  else if (at === "warn") console.warn(line, extra ?? "");
  else console.log(line, extra ?? "");
}

export function logger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => emit("debug", scope, message, extra),
    info: (message: string, extra?: unknown) => emit("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => emit("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => emit("error", scope, message, extra),
  };
}
