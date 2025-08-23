import { describe, expect, test } from "bun:test";
import path from "path";

import { logger } from "@/infrastructure/logger";
import { findProjectRoot } from "@/infrastructure/logger/helpers";
import { getFileStorage } from "@/infrastructure/storage/FileStorageService";

const storage = getFileStorage();

function projectLogsDir(): string {
  const root = findProjectRoot(process.cwd());
  return path.join(root, "logs");
}

describe("Logger file outputs (JSON and NDJSON)", () => {
  test("writes JSON array records to logs/output.json and secondary file", () => {
    const logsDir = projectLogsDir();
    const mainFile = path.join(logsDir, "output.json");
    const secondaryFile = path.join(logsDir, "unit-json.json");

    storage.ensureDir(logsDir);
    storage.writeFile(mainFile, "[]\n");
    storage.writeFile(secondaryFile, "[]\n");

    const log = logger({ fileName: "unit-json", ndjson: false });
    log.info({ type: "test.file", marker: "json", num: 1 });
    log.warn({ type: "test.file", marker: "json", num: 2 });

    const readAndFilter = (file: string) => {
      const asArray = JSON.parse(storage.readFile(file));
      return (asArray as any[]).filter((r) => r && r.type === "test.file" && r.marker === "json");
    };

    const mainRecords = readAndFilter(mainFile);
    const secondaryRecords = readAndFilter(secondaryFile);

    expect(mainRecords.length).toBe(2);
    expect(secondaryRecords.length).toBe(2);

    for (const r of [...mainRecords, ...secondaryRecords]) {
      expect(typeof r.level).toBe("string");
      expect(typeof r.time === "string" || typeof r.time === "number").toBe(true);
    }
  });

  test("writes NDJSON line records to logs/output.ndjson and secondary file", async () => {
    const logsDir = projectLogsDir();
    const mainFile = path.join(logsDir, "output.ndjson");
    const secondaryFile = path.join(logsDir, "unit-nd.ndjson");

    storage.ensureDir(logsDir);
    storage.writeFile(mainFile, "");
    storage.writeFile(secondaryFile, "");

    const log = logger({ fileName: "unit-nd", ndjson: true });
    log.info({ type: "test.ndjson", marker: "ndjson", num: 1 });
    log.warn({ type: "test.ndjson", marker: "ndjson", num: 2 });

    // In NDJSON mode, file writes may be async (non-sync destination in non-development env)
    await Bun.sleep(50);

    const readAndFilter = (file: string) => {
      const content = storage.readFile(file);
      const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const objs = lines.map((l) => JSON.parse(l));
      return objs.filter((r) => r && r.type === "test.ndjson" && r.marker === "ndjson");
    };

    const mainRecords = readAndFilter(mainFile);
    const secondaryRecords = readAndFilter(secondaryFile);

    expect(mainRecords.length).toBe(2);
    expect(secondaryRecords.length).toBe(2);

    for (const r of [...mainRecords, ...secondaryRecords]) {
      expect(typeof r.level).toBe("string");
      expect(typeof r.time === "string" || typeof r.time === "number").toBe(true);
    }
  });
});


