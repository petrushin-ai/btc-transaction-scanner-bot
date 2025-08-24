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

const OUT_DIR = path.join( process.cwd(), "logs" );
const OUT_FILE = path.join( OUT_DIR, "test-metrics.jsonl" );

export function emitMetric(metric: Metric): void {
  const withTs = { ...metric, ts: new Date().toISOString() };
  // Accumulate in a global buffer for pretty summary (preload reads this)
  const globalAny = globalThis as any;
  if ( !globalAny.__TEST_METRICS__ ) globalAny.__TEST_METRICS__ = [] as Metric[];
  try {
    globalAny.__TEST_METRICS__.push( withTs );
  } catch {
    // ignore
  }
  // Persist to file to aggregate across workers/processes
  try {
    fs.mkdirSync( OUT_DIR, { recursive: true } );
    fs.appendFileSync( OUT_FILE, `${ JSON.stringify( withTs ) }\n`, "utf8" );
  } catch {
    // ignore
  }
}

export function measureMs<T>(fn: () => T): { ms: number; result: T } {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  return { ms: t1 - t0, result };
}

export function memoryUsageMb(): number {
  const { rss } = process.memoryUsage();
  return Math.round( (rss / (1024 * 1024)) * 100 ) / 100;
}


export function peakMemoryUsageMb(): number | undefined {
  try {
    // maxRSS units differ by platform per getrusage semantics:
    // - Linux: kilobytes
    // - macOS (darwin): bytes
    // Convert deterministically by platform to avoid heuristics.
    const ru: any = (process as any).resourceUsage?.();
    if ( ru && typeof ru.maxRSS === "number" && isFinite( ru.maxRSS ) && ru.maxRSS > 0 ) {
      const v = ru.maxRSS;
      let mb: number;
      if ( process.platform === "darwin" ) {
        mb = v / (1024 * 1024);
      } else {
        // Assume kilobytes (Linux and most Unix)
        mb = v / 1024;
      }
      return Math.round( mb * 100 ) / 100;
    }
  } catch {
    // fall through to Linux fallbacks below
  }

  // Fallbacks for Linux environments (e.g., some Bun builds in Docker) where
  // process.resourceUsage().maxRSS may be 0 or unavailable.
  try {
    if ( process.platform === "linux" ) {
      // Prefer process peak RSS from /proc/self/status (VmHWM in kB)
      try {
        const status = fs.readFileSync( "/proc/self/status", "utf8" );
        const m = /VmHWM:\s+(\d+)\s*kB/i.exec( status );
        if ( m ) {
          const kb = Number( m[1] );
          if ( Number.isFinite( kb ) && kb > 0 ) {
            return Math.round( (kb / 1024) * 100 ) / 100;
          }
        }
      } catch {
        // ignore and try cgroup fallbacks
      }

      // cgroup v2 (Docker newer): memory.peak contains bytes
      const cgroupCandidates = [
        "/sys/fs/cgroup/memory.peak", // unified cgroup v2
        "/sys/fs/cgroup/memory/memory.max_usage_in_bytes", // cgroup v1 common
        "/sys/fs/cgroup/memory.max_usage_in_bytes", // alternate mount
      ];
      for ( const p of cgroupCandidates ) {
        try {
          if ( fs.existsSync( p ) ) {
            const raw = fs.readFileSync( p, "utf8" ).trim();
            const bytes = Number( raw );
            if ( Number.isFinite( bytes ) && bytes > 0 ) {
              const mb = bytes / (1024 * 1024);
              return Math.round( mb * 100 ) / 100;
            }
          }
        } catch {
          // try next candidate
        }
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}


