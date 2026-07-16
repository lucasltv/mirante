#!/usr/bin/env node
/**
 * Mirante CLI — the npx entrypoint.
 *
 *   mirante install     merge hooks into settings.json (backup + idempotent),
 *                       install SwiftBar if missing, drop the plugin, offer
 *                       notify-focus migration, optionally install the skill
 *   mirante uninstall   remove only Mirante's hooks (safe restore)
 *   mirante config      open the config UI (ephemeral localhost server)
 *   mirante doctor      validate permissions, deps, hook wiring, data access
 *
 * Command implementations follow the plan; this is the dispatch skeleton.
 */

import { loadConfig } from "../core/config.js";
import { buildSessionViews } from "../collect/enrich.js";
import { install, uninstall } from "../install/installer.js";
import { runDoctor } from "../install/doctor.js";

type Command = "install" | "uninstall" | "config" | "doctor";

const COMMANDS: Record<Command, string> = {
  install: "Set up hooks, widget, and (optionally) the skill.",
  uninstall: "Remove only Mirante's hooks.",
  config: "Open the configuration UI.",
  doctor: "Diagnose the installation.",
};

function usage(): void {
  process.stdout.write("mirante <command>\n\n");
  for (const [name, desc] of Object.entries(COMMANDS)) {
    process.stdout.write(`  ${name.padEnd(10)} ${desc}\n`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "install": {
      const result = await install();
      process.stdout.write(`mirante: hooks installed (${result.hookInstalledAt}).\n`);
      if (result.backupPath) process.stdout.write(`mirante: settings backed up to ${result.backupPath}.\n`);
      process.stdout.write("mirante: restart your Claude sessions for hooks to take effect.\n");
      return;
    }
    case "uninstall": {
      const result = await uninstall();
      process.stdout.write("mirante: hooks removed from settings.json.\n");
      if (result.backupPath) process.stdout.write(`mirante: settings backed up to ${result.backupPath}.\n`);
      return;
    }
    case "doctor": {
      const report = await runDoctor();
      for (const c of report.checks) {
        process.stdout.write(`${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}\n`);
      }
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    case "config":
      process.stdout.write("mirante config: not implemented yet\n");
      process.exitCode = 1;
      return;
    case "status": {
      // Hidden debug command: print the enriched SessionViews as JSON so the
      // collector can be eyeballed before the SwiftBar widget exists.
      const config = await loadConfig();
      const views = await buildSessionViews(config);
      process.stdout.write(JSON.stringify(views, null, 2) + "\n");
      return;
    }
    default:
      usage();
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  process.stderr.write(`mirante: ${String(err)}\n`);
  process.exitCode = 1;
});
