import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(workspaceDir);

const mode = process.argv[2] ?? "dev";

if (mode === "test") {
  const fs = await import("node:fs");
  const testsDir = path.join(workspaceDir, "tests");
  const testFiles = fs.readdirSync(testsDir)
    .filter((f) => f.endsWith(".test.mjs"))
    .map((f) => path.join(testsDir, f));

  const child = spawn(
    process.execPath,
    ["--test", ...testFiles],
    { cwd: workspaceDir, stdio: "inherit" },
  );
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  if (mode === "build") {
    process.argv = [process.argv[0], path.join(workspaceDir, "node_modules", "vite", "bin", "vite.js"), "build"];
  } else if (mode === "preview") {
    process.argv = [process.argv[0], path.join(workspaceDir, "node_modules", "vite", "bin", "vite.js"), "preview"];
  } else {
    process.argv = [process.argv[0], path.join(workspaceDir, "node_modules", "vite", "bin", "vite.js")];
  }
  await import(pathToFileURL(path.join(workspaceDir, "node_modules", "vite", "bin", "vite.js")).href);
}
