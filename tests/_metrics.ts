import fs from "fs";
import path from "path";

export type Metric = {
  suite: string;
  name: string;
  value: number;
  unit: string;
  details?: Record<string, unknown>;
  ts?: string;
};

const OUT_DIR = path.join(process.cwd(), "logs");
const OUT_FILE = path.join(OUT_DIR, "test-metrics.jsonl");

export function emitMetric(metric: Metric): void {
  const withTs = { ...metric, ts: new Date().toISOString() };
  // Accumulate in a global buffer for pretty summary (preload reads this)
  const globalAny = globalThis as any;
  if (!globalAny.__TEST_METRICS__) globalAny.__TEST_METRICS__ = [] as Metric[];
  try {
    globalAny.__TEST_METRICS__.push(withTs);
  } catch {
    // ignore
  }
  // Persist to file to aggregate across workers/processes
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.appendFileSync(OUT_FILE, JSON.stringify(withTs) + "\n", "utf8");
  } catch {
    // ignore
  }
  // Intentionally do NOT print or write JSON here; only the pretty summary will be shown.
}

export function measureMs<T>(fn: () => T): { ms: number; result: T } {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  return { ms: t1 - t0, result };
}

export function memoryUsageMb(): number {
  const { rss } = process.memoryUsage();
  return Math.round((rss / (1024 * 1024)) * 100) / 100;
}


