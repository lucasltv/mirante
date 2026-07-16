import { fileURLToPath } from "node:url";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CLAUDE_SETTINGS_FILE,
  CLAUDE_HOOKS_DIR,
  INSTALLED_HOOK_SCRIPT,
} from "../core/paths.js";
import { mergeMiranteHooks, removeMiranteHooks, type Settings } from "./settingsMerge.js";

export interface InstallResult {
  /** Path of the settings backup, or null when there was nothing to back up. */
  backupPath: string | null;
  hookInstalledAt: string;
}

/** Default source of the hook script, resolved relative to the built module. */
export function defaultHookSource(): string {
  // dist/install/installer.js -> dist/collect/hooks/mirante-hook.sh
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "collect", "hooks", "mirante-hook.sh");
}

interface SettingsRead {
  /** Parsed settings, or null when the file exists but is not valid JSON. */
  settings: Settings | null;
  /** Whether a settings.json is on disk at all (valid or not). */
  existed: boolean;
  /** Raw contents when the file exists, kept for backup. */
  raw: string | null;
}

async function readSettings(): Promise<SettingsRead> {
  let raw: string;
  try {
    raw = await readFile(CLAUDE_SETTINGS_FILE, "utf8");
  } catch {
    // No file (or unreadable): a fresh install target.
    return { settings: {}, existed: false, raw: null };
  }
  try {
    return { settings: JSON.parse(raw) as Settings, existed: true, raw };
  } catch {
    // Present but corrupt — surface it; never silently clobber the user's file.
    return { settings: null, existed: true, raw };
  }
}

/** Back up raw settings to a timestamped file so no earlier backup is lost. */
async function backup(raw: string | null): Promise<string | null> {
  if (raw === null) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${CLAUDE_SETTINGS_FILE}.mirante-${stamp}.bak`;
  await writeFile(backupPath, raw);
  return backupPath;
}

const CORRUPT_MSG =
  "settings.json exists but is not valid JSON; a backup was saved alongside it — fix the file, then re-run.";

async function writeSettingsAtomic(settings: Settings): Promise<void> {
  await mkdir(dirname(CLAUDE_SETTINGS_FILE), { recursive: true });
  const tmp = `${CLAUDE_SETTINGS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n");
  await rename(tmp, CLAUDE_SETTINGS_FILE);
}

/** Install Mirante's hooks: back up, merge, copy the hook script into place. */
export async function install(hookSource: string = defaultHookSource()): Promise<InstallResult> {
  const { settings, raw } = await readSettings();
  const backupPath = await backup(raw);
  if (settings === null) throw new Error(CORRUPT_MSG);

  await mkdir(CLAUDE_HOOKS_DIR, { recursive: true });
  await copyFile(hookSource, INSTALLED_HOOK_SCRIPT);
  await chmod(INSTALLED_HOOK_SCRIPT, 0o755);

  const merged = mergeMiranteHooks(settings, INSTALLED_HOOK_SCRIPT);
  await writeSettingsAtomic(merged);

  return { backupPath, hookInstalledAt: INSTALLED_HOOK_SCRIPT };
}

/** Remove only Mirante's hooks from settings.json (leaves the copied script). */
export async function uninstall(): Promise<{ backupPath: string | null }> {
  const { settings, raw, existed } = await readSettings();
  if (!existed) return { backupPath: null };
  const backupPath = await backup(raw);
  if (settings === null) throw new Error(CORRUPT_MSG);
  const cleaned = removeMiranteHooks(settings);
  await writeSettingsAtomic(cleaned);
  return { backupPath };
}
