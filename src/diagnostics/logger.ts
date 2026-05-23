type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = "extension" | "selection" | "style" | "export" | "diagnostics";

export type ClickDeckLogger = {
  debug: (message: string, details?: unknown) => void;
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
};

export function createLogger(context: LogContext): ClickDeckLogger {
  return {
    debug: (message, details) => writeLog("debug", context, message, details),
    info: (message, details) => writeLog("info", context, message, details),
    warn: (message, details) => writeLog("warn", context, message, details),
    error: (message, details) => writeLog("error", context, message, details)
  };
}

function writeLog(level: LogLevel, context: LogContext, message: string, details?: unknown): void {
  const payload = [`[ClickDeck:${context}] ${message}`];

  if (details === undefined) {
    console[level](payload[0]);
    return;
  }

  console[level](payload[0], details);
}
