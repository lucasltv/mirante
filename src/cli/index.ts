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
  const cmd = process.argv[2] as Command | undefined;
  switch (cmd) {
    case "install":
    case "uninstall":
    case "config":
    case "doctor":
      process.stdout.write(`mirante ${cmd}: not implemented yet\n`);
      process.exitCode = 1;
      return;
    default:
      usage();
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err) => {
  process.stderr.write(`mirante: ${String(err)}\n`);
  process.exitCode = 1;
});
