import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureTask {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string | null;
}

/** A synthetic Claude home. Call `cleanup()` when done. */
export interface Fixture {
  home: string;
  addTasks(sessionId: string, tasks: FixtureTask[]): void;
  /** Write raw JSONL lines as the transcript for a project/session. */
  addTranscript(project: string, sessionId: string, lines: object[]): void;
  addLiveRecord(sessionId: string, record: object): void;
  cleanup(): void;
}

export function makeFixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), "mirante-fix-"));
  return {
    home,
    addTasks(sessionId, tasks) {
      const dir = join(home, "tasks", sessionId);
      mkdirSync(dir, { recursive: true });
      for (const t of tasks) {
        writeFileSync(join(dir, `${t.id}.json`), JSON.stringify(t));
      }
    },
    addTranscript(project, sessionId, lines) {
      const dir = join(home, "projects", project);
      mkdirSync(dir, { recursive: true });
      const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      writeFileSync(join(dir, `${sessionId}.jsonl`), body);
    },
    addLiveRecord(sessionId, record) {
      const dir = join(home, "mirante", "live");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(record));
    },
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
