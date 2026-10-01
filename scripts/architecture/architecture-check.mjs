#!/usr/bin/env node
import {
  checkArchitecture,
  changedFilesFromGit,
  formatMarkdownReport,
  formatReport,
  generateContext,
  updateBaseline,
} from "./index.mjs";

const args = process.argv.slice(2);
const command = args[0] ?? "check";
const cwd = process.cwd();

if (command === "context") {
  const moduleId = args[1];
  if (!moduleId) throw new Error("usage: pnpm architecture:context <module-id>");
  console.log(await generateContext({ cwd, moduleId }));
  process.exit(0);
}

const changed = args.includes("--changed") ? await changedFilesFromGit(cwd) : null;
const result = await checkArchitecture({ cwd, changedFiles: changed });

if (command === "baseline:update") {
  await updateBaseline({ cwd, violations: result.violations });
  console.log(`baseline updated: ${result.violations.length} violations`);
  process.exit(0);
}

if (command === "report") {
  console.log(
    args.includes("--markdown") ? formatMarkdownReport(result) : JSON.stringify(result, null, 2),
  );
  process.exit(result.newViolations.length > 0 ? 1 : 0);
}

console.log(formatReport(result));
process.exit(result.newViolations.length > 0 ? 1 : 0);
