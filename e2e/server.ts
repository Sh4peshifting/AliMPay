import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const build = Bun.spawn([process.execPath, "run", "build"], { stdout: "inherit", stderr: "inherit" });
if (await build.exited !== 0) process.exit(1);

const prefix = join(resolve(tmpdir()), "alimpay-e2e-");
const directory = mkdtempSync(prefix);
const server = Bun.spawn([process.execPath, "src/server/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, DATA_DIR: directory, NODE_ENV: "development", PORT: "3100", PUBLIC_BASE_URL: "http://127.0.0.1:3100" },
});
process.on("SIGINT", () => server.kill());
process.on("SIGTERM", () => server.kill());
try {
  process.exitCode = await server.exited;
} finally {
  if (resolve(directory).startsWith(prefix)) rmSync(directory, { recursive: true, force: true });
}
