export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = "extension" | "selection" | "style" | "export" | "diagnostics";

export type LogEntry = {
  id: string;
  level: LogLevel;
  context: LogContext;
  message: string;
  details?: unknown;
  createdAt: number;
};

const MAX_LOGS = 100;
const buffer: LogEntry[] = [];

export function getRecentLogs(): LogEntry[] {
  return [...buffer];
}

export function clearLogs(): void {
  buffer.length = 0;
}

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

  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    level,
    context,
    message,
    details,
    createdAt: Date.now()
  };

  buffer.push(entry);
  if (buffer.length > MAX_LOGS) {
    buffer.shift();
  }

  if (details === undefined) {
    console[level](payload[0]);
    return;
  }

  console[level](payload[0], details);
}
