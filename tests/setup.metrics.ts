import { afterAll } from "bun:test";
import "./_metrics-preload";

type Metric = {
  suite: string;
  name: string;
  value: number;
  unit: string;
  details?: Record<string, unknown>;
  ts?: string;
};

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
};

function color(text: string, c: keyof typeof colors): string {
  return `${colors[c]}${text}${colors.reset}`;
}

function formatDetails(d?: Record<string, unknown>): string {
  if (!d) return "";
  const entries = Object.entries(d);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "number" ? v : JSON.stringify(v)}`)
    .join(" ");
}

function printPretty(metrics: Metric[]): void {
  if (!metrics || metrics.length === 0) return;
  const bySuite = new Map<string, Metric[]>();
  for (const m of metrics) {
    const arr = bySuite.get(m.suite) || [];
    arr.push(m);
    bySuite.set(m.suite, arr);
  }

  const suites = Array.from(bySuite.keys()).sort();
  const total = metrics.length;
  const header = `${color("Metrics Summary", "cyan")} ${color(`(${total} metrics)`, "dim")}`;
  // eslint-disable-next-line no-console
  console.log("\n" + header);
  for (const s of suites) {
    // eslint-disable-next-line no-console
    console.log(color(`\n  ${s}`, "magenta"));
    const rows = (bySuite.get(s) || []).slice();
    rows.sort((a, b) => a.name.localeCompare(b.name));
    for (const m of rows) {
      const left = color(`    ${m.name}`, "green");
      const right = `${m.value} ${m.unit}`.trim();
      const det = formatDetails(m.details);
      // eslint-disable-next-line no-console
      console.log(`${left} ${color("=>", "dim")} ${right}${det ? color("  [" + det + "]", "yellow") : ""}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log();
}

afterAll(() => {
  try {
    const g = globalThis as any;
    const metrics: Metric[] = Array.isArray(g.__TEST_METRICS__) ? g.__TEST_METRICS__ : [];
    printPretty(metrics);
  } catch {
    // ignore
  }
});


