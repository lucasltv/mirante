#!/usr/bin/env node
//
// Mirante SwiftBar plugin. SwiftBar runs this on the interval encoded in the
// filename (4s) and renders its stdout in the menu bar. This is the "brain":
// it reads config + live records, computes progress/usage, resolves summaries,
// and prints the SwiftBar menu.
//
// <bitbar.title>Mirante</bitbar.title>
// <bitbar.desc>Glanceable overview of active Claude CLI sessions.</bitbar.desc>
// <bitbar.dependencies>node</bitbar.dependencies>
//
// This file is the packaged entry; it imports the built enricher from dist/.
// Implementation follows the plan — this stub only lays out the shape.

// import { loadConfig } from "../../core/config.js";
// import { buildSessionViews } from "../../collect/enrich.js";

async function main() {
  // const config = await loadConfig();
  // const sessions = await buildSessionViews(config);
  //
  // 1) menu-bar icon: aggregate priority
  //    needs-permission > working > awaiting-input > idle
  // 2) dropdown: one section per session —
  //    title/project · state · progress bar (from progress.ratio) ·
  //    activity/summary · tokens/cost · click-to-focus (focus-terminal.sh)

  process.stdout.write("Mirante\n");
  process.stdout.write("---\n");
  process.stdout.write("Not configured yet · run: npx mirante install\n");
}

main().catch((err) => {
  process.stdout.write("Mirante ⚠️\n---\n");
  process.stdout.write(`error: ${String(err)}\n`);
});
