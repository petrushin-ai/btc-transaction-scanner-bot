import fs from "fs";
import path from "path";
import dotenv from "dotenv";

function fileExists(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function loadEnvFiles(cwd: string = process.cwd()): void {
  const envFromProcess = process.env.NODE_ENV || process.env.APP_ENV || "development";
  const env = envFromProcess.trim();

  const candidates = [
    path.join(cwd, ".env"),
    path.join(cwd, ".env.local"),
    path.join(cwd, `.env.${env}`),
    path.join(cwd, `.env.${env}.local`),
  ];

  for (const p of candidates) {
    if (!fileExists(p)) continue;
    // Do not override existing process env variables; external env takes precedence
    dotenv.config({ path: p, override: false });
  }
}

