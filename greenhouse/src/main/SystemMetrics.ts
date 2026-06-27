// Host system load sampler. CPU busy fraction needs two cpu-times snapshots a
// tick apart (Node has no instantaneous reading), so this holds the previous
// snapshot and reports the delta on each sample(). loadavg/memory are point reads.

import * as os from 'node:os';

export interface SystemSample {
  cpu: number; // busy fraction across all cores since the last sample (0..1)
  load: number; // 1-min loadavg normalised by core count (1.0 = fully loaded)
  loadRaw: number; // raw 1-min loadavg
  mem: number; // used memory fraction (0..1)
  cores: number;
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

export class SystemMetrics {
  private prev = cpuTimes();

  sample(): SystemSample {
    const now = cpuTimes();
    const idleD = now.idle - this.prev.idle;
    const totalD = now.total - this.prev.total;
    this.prev = now;
    const cpu = totalD > 0 ? 1 - idleD / totalD : 0;
    const cores = os.cpus().length || 1;
    const loadRaw = os.loadavg()[0];
    const mem = 1 - os.freemem() / os.totalmem();
    return { cpu, load: loadRaw / cores, loadRaw, mem, cores };
  }
}
