import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { files, localPath, workspacePaths } from "./files.ts";

const WEATHER_SMOKE_TIMEOUT_MS = 5_000;
const root = resolve(".");
for (const workspace of workspacePaths(root)) {
  rmSync(join(workspace, "dist"), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(workspace, "tsconfig.build.json")],
    { stdio: "inherit" },
  );
  for (const path of files(join(workspace, "src")).filter((path) => path.endsWith(".md"))) {
    const target = join(workspace, "dist", localPath(join(workspace, "src"), path));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
  }
}
const temporary = mkdtempSync(join(tmpdir(), "mcp-lab-build-"));
try {
  for (const args of [["help"], ["config", "show"]]) {
    execFileSync(process.execPath, [join(root, "apps/host/dist/app/main.js"), ...args], {
      cwd: temporary,
      env: {},
      stdio: "pipe",
    });
  }
  const filesystemRoot = join(temporary, "filesystem");
  mkdirSync(filesystemRoot);
  const output = execFileSync(
    process.execPath,
    [join(root, "apps/host/dist/app/main.js"), "--mcp-filesystem-root", filesystemRoot, "mcp", "tools"],
    { cwd: temporary, encoding: "utf8", env: {}, stdio: "pipe" },
  );
  for (const name of ["read_text_file", "list_directory", "write_file"]) {
    if (!output.includes(name)) throw new Error(`В собранном выводе отсутствует ${name}.`);
  }
  console.log("Сборка и запуск CLI из другого каталога: OK.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const weatherTemporary = mkdtempSync(join(tmpdir(), "mcp-lab-build-weather-"));
try {
  const output = execFileSync(process.execPath, [join(root, "servers/open-meteo/dist/app/main.js")], {
    cwd: weatherTemporary,
    input: "",
    env: {},
    timeout: WEATHER_SMOKE_TIMEOUT_MS,
    encoding: "utf8",
  });
  if (output.trim()) throw new Error("Open-Meteo MCP server smoke: посторонний вывод в stdout.");
  console.log("Запуск собранного Open-Meteo MCP server из другого каталога: OK.");
} finally {
  rmSync(weatherTemporary, { recursive: true, force: true });
}
