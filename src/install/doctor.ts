import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { CLAUDE_SETTINGS_FILE, INSTALLED_HOOK_SCRIPT, INSTALLED_FOCUS_SCRIPT, MIRANTE_LIVE_DIR } from "../core/paths.js";
import { hasMiranteHooks, type Settings } from "./settingsMerge.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}
export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    // `command -v` is a bash builtin, so run it through bash. `cmd` is a fixed
    // literal here (no user input), so the interpolation is safe.
    await execFileAsync("bash", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

/** Run all read-only diagnostics and return a structured report. */
export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. settings.json parseable + mirante hooks wired
  let settings: Settings | null = null;
  try {
    settings = JSON.parse(await readFile(CLAUDE_SETTINGS_FILE, "utf8")) as Settings;
    checks.push({ id: "settings-readable", label: "settings.json is readable", ok: true, detail: CLAUDE_SETTINGS_FILE });
  } catch {
    checks.push({ id: "settings-readable", label: "settings.json is readable", ok: false, detail: `cannot read/parse ${CLAUDE_SETTINGS_FILE}` });
  }
  const wired = settings ? hasMiranteHooks(settings) : false;
  checks.push({ id: "hooks-wired", label: "Mirante hooks are wired in settings.json", ok: wired, detail: wired ? "found" : "run `mirante install`" });

  // 2. hook script present
  let scriptOk = false;
  try {
    await access(INSTALLED_HOOK_SCRIPT);
    scriptOk = true;
  } catch {
    scriptOk = false;
  }
  checks.push({ id: "hook-script-present", label: "hook script installed", ok: scriptOk, detail: INSTALLED_HOOK_SCRIPT });

  // 3. jq present (hooks need it to parse stdin)
  const jqOk = await commandExists("jq");
  checks.push({ id: "jq-present", label: "jq is installed", ok: jqOk, detail: jqOk ? "found" : "brew install jq" });

  // 4. live dir present — informational (absent is fine before the first hook fires)
  let liveOk = true;
  try {
    await access(MIRANTE_LIVE_DIR);
  } catch {
    liveOk = false;
  }
  checks.push({ id: "live-dir", label: "live/ directory exists", ok: liveOk, detail: liveOk ? MIRANTE_LIVE_DIR : "created on first hook event" });

  // 5. focus helper present (installed alongside the hook)
  let focusOk = false;
  try {
    await access(INSTALLED_FOCUS_SCRIPT);
    focusOk = true;
  } catch {
    focusOk = false;
  }
  checks.push({
    id: "focus-script-present",
    label: "click-to-focus helper installed",
    ok: focusOk,
    detail: focusOk ? INSTALLED_FOCUS_SCRIPT : "run `mirante install`",
  });

  // 6. terminal-notifier (informational — osascript fallback works without it)
  const tnOk = await commandExists("terminal-notifier");
  checks.push({
    id: "terminal-notifier",
    label: "terminal-notifier installed (clickable notifications)",
    ok: tnOk,
    detail: tnOk ? "found" : "optional: brew install terminal-notifier (falls back to osascript)",
  });

  const informational = new Set(["live-dir", "terminal-notifier"]);
  const ok = checks.filter((c) => !informational.has(c.id)).every((c) => c.ok);
  return { ok, checks };
}
