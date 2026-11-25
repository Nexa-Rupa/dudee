import { Cron } from "croner";
import type { Runtime } from "./runtime.js";
import { errorText } from "./runtime.js";

/** Runs every enabled routine on its cron schedule. Each run is an ordinary turn. */
export class Scheduler {
  private jobs: Cron[] = [];
  private unsubscribe?: () => void;

  constructor(
    private runtime: Runtime,
    private log: (line: string) => void = () => {}
  ) {}

  start() {
    this.runtime.store.closeOpenRuns();
    this.reload();
    this.unsubscribe = this.runtime.on((e) => {
      if (e.type === "routines-changed" || e.type === "team-changed") this.reload();
    });
  }

  stop() {
    this.unsubscribe?.();
    for (const j of this.jobs) j.stop();
    this.jobs = [];
  }

  reload() {
    for (const j of this.jobs) j.stop();
    this.jobs = [];
    for (const r of this.runtime.store.routines()) {
      if (!r.enabled) continue;
      const hire = this.runtime.findHire(r.hireId);
      if (!hire || hire.paused) continue;
      try {
        const job = new Cron(r.cron, { protect: true }, async () => {
          this.log(`▶ ${hire.name}: routine ${r.id}`);
          try {
            await this.runtime.runRoutine(hire.id, r.id, { trigger: "schedule" });
            this.log(`✓ ${hire.name}: routine ${r.id} done`);
          } catch (err) {
            this.log(`✗ ${hire.name}: routine ${r.id} failed: ${errorText(err)}`);
          }
        });
        this.jobs.push(job);
      } catch (err) {
        this.log(`✗ ${hire.name}: routine ${r.id} has a bad schedule "${r.cron}": ${errorText(err)}`);
      }
    }
  }

  upcoming() {
    return this.jobs.map((j) => j.nextRun()).filter(Boolean) as Date[];
  }
}
