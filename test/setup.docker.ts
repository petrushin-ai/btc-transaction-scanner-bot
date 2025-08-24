// Redirect local `bun test` to run the suite inside a single Docker container.
// Opt-out: set SKIP_DOCKER=1. Inside the container we set IN_DOCKER=1.

import { execFileSync } from "node:child_process";

const inDocker = String(process.env.IN_DOCKER || "").trim() === "1";
const skipDocker = String(process.env.SKIP_DOCKER || "").trim() === "1";

if (!inDocker && !skipDocker) {
  try {
    // Build and run tests in the test image with mounted logs/cache
    const cmd = [
      "docker build -f Dockerfile.test -t btc-transaction-scanner-bot:test .",
      "docker run --rm -e APP_ENV=production -e IN_DOCKER=1 -v $(pwd)/cache:/app/cache -v $(pwd)/logs:/app/logs btc-transaction-scanner-bot:test",
    ].join(" && ");
    execFileSync("sh", [ "-lc", cmd ], { stdio: "inherit" });
    // Exit after container run completes; prevent local tests from running
    process.exit(0);
  } catch (err) {
    // Propagate non-zero exit codes
    process.exit(typeof (err as any)?.status === "number" ? (err as any).status : 1);
  }
}


