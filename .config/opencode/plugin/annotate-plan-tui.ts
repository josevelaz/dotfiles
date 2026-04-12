import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logPath = join(tmpdir(), "opencode-annotate-plan.log");
appendFileSync(
  logPath,
  `${new Date().toISOString()} [wrapper] annotate-plan-tui.ts TOP\n`,
);

const home = process.env.HOME;
const tuiPath = `file://${home}/projects/opencode-annotator.nvim/dist/tui.js`;
// @ts-ignore dynamic import
const tuiModule = await import(tuiPath);

appendFileSync(
  logPath,
  `${new Date().toISOString()} [wrapper] import OK, keys=${JSON.stringify(Object.keys(tuiModule))}\n`,
);

export default tuiModule.default ?? tuiModule;
