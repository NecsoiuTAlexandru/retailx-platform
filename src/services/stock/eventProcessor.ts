/**
 * Procesatorul evenimentelor din sistemul central.
 *
 * Fiecare eveniment costă un timp de procesare (apel în baza de date, invalidare cache).
 * Procesatorul ține o „bandă” de lucru: un eveniment începe după ce s-a terminat
 * cel dinaintea lui pe aceeași bandă. Evenimentele se aplică abia când procesarea lor s-a încheiat.
 *
 * Sprint 1: O SINGURĂ bandă pentru toate magazinele (procesare secvențială).
 * La vârf, când toate magazinele trimit vânzările deodată, coada crește și stocul online
 * rămâne în urmă (DEF-01: 12 minute în loc de 5).
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
  private lane: Lane = { busyUntil: 0, queue: [] };

  constructor(
    private readonly clock: Clock,
    private readonly apply: (e: SaleEvent, appliedAt: number) => void,
    private readonly costMs = COST_PROCESARE_MS,
  ) {}

  enqueue(e: SaleEvent): void {
    const start = Math.max(this.lane.busyUntil, this.clock.now());
    const doneAt = start + this.costMs;
    this.lane.busyUntil = doneAt;
    this.lane.queue.push({ e, doneAt });
  }

  /** Aplică toate evenimentele a căror procesare s-a încheiat până acum. */
  drain(): void {
    const now = this.clock.now();
    while (this.lane.queue.length && this.lane.queue[0].doneAt <= now) {
      const p = this.lane.queue.shift()!;
      this.apply(p.e, p.doneAt);
    }
  }

  pending(): number {
    return this.lane.queue.length;
  }
}
