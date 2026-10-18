/**
 * Procesatorul evenimentelor din sistemul central.
 *
 * Fiecare eveniment costă un timp de procesare (apel în baza de date, invalidare cache).
 * Un eveniment începe după ce s-a terminat cel dinaintea lui pe aceeași bandă și se aplică
 * abia când procesarea lui s-a încheiat.
 *
 * Istoric:
 *  - S1: o singură bandă pentru toate magazinele (procesare secvențială). La vârf coada creștea
 *    și stocul online rămânea în urmă 12 minute (DEF-01).
 *  - S2 (remedierea DEF-01): câte o bandă pentru fiecare magazin, procesate în paralel.
 *    Ordinea evenimentelor se păstrează în interiorul aceluiași magazin, singura ordine care contează
 *    pentru stocul lui.
 */
import type { Clock } from "../../core/clock.js";
import type { SaleEvent } from "../../central/centralSystem.js";

export const COST_PROCESARE_MS = 600;

interface Pending {
  e: SaleEvent;
  doneAt: number;
}

interface Lane {
  busyUntil: number;
  queue: Pending[];
}

export class SaleEventProcessor {
  private lanes = new Map<string, Lane>();

  constructor(
    private readonly clock: Clock,
    private readonly apply: (e: SaleEvent, appliedAt: number) => void,
    private readonly costMs = COST_PROCESARE_MS,
  ) {}

  enqueue(e: SaleEvent): void {
    let lane = this.lanes.get(e.idMagazin);
    if (!lane) {
      lane = { busyUntil: 0, queue: [] };
      this.lanes.set(e.idMagazin, lane);
    }
    const start = Math.max(lane.busyUntil, this.clock.now());
    const doneAt = start + this.costMs;
    lane.busyUntil = doneAt;
    lane.queue.push({ e, doneAt });
  }

  /** Aplică toate evenimentele a căror procesare s-a încheiat până acum. */
  drain(): void {
    const now = this.clock.now();
    for (const lane of this.lanes.values()) {
      while (lane.queue.length && lane.queue[0].doneAt <= now) {
        const p = lane.queue.shift()!;
        this.apply(p.e, p.doneAt);
      }
    }
  }

  pending(): number {
    let n = 0;
    for (const l of this.lanes.values()) n += l.queue.length;
    return n;
  }
}
