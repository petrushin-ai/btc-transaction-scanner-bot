// Pretty summary of collected metrics at the end of the test run
function pad(str: string, len: number): string {
  if (str.length >= len) return str;
  return str + " ".repeat(len - str.length);
}

function formatRow(cols: string[], widths: number[]): string {
  return cols.map((c, i) => pad(c, widths[i])).join("  ");
}

function printTable(rows: Array<Record<string, string | number>>): void {
  const headers = Object.keys(rows[0] ?? { suite: "suite", name: "name", value: 0, unit: "unit" });
  const widths = headers.map((h) => Math.max(h.length, ...rows.map((r) => String(r[h] ?? "").length)));
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  console.log("");
  console.log("=== Metrics Summary ===");
  console.log(formatRow(headers, widths));
  console.log(sep);
  for (const r of rows) console.log(formatRow(headers.map((h) => String(r[h] ?? "")), widths));
  console.log("");
}

let printed = false;
function onExit(): void {
  if (printed) return;
  const globalAny = globalThis as any;
  const metrics: any[] = Array.isArray(globalAny.__TEST_METRICS__) ? globalAny.__TEST_METRICS__ : [];
  if (metrics.length === 0) return;
  const rows = metrics.map((m) => ({ suite: m.suite, name: m.name, value: m.value, unit: m.unit }));
  printTable(rows);
  printed = true;
}

// Bun supports lifecycle hooks via --preload; register on process exit
process.on("beforeExit", onExit);
process.on("exit", onExit);


