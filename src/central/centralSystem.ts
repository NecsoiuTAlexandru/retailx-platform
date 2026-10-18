/**
 * Simulatorul sistemului central de gestiune RetailX.
 *
 * BRD: sistemul central NU se înlocuiește; platforma se integrează prin API și evenimente.
 * Ce simulăm (constatări din Sprint 0 și din Daily-ul din 5 martie 2027):
 *  - API-ul de stoc permite UN apel pe minut pentru fiecare magazin (rate limit);
 *  - sistemul poate trimite evenimente de vânzare de la casă;
 *  - sistemul poate fi indisponibil (alternativa C din UC „Plasează comanda”).
 */
import type { Clock } from "../core/clock.js";
import { MINUTE } from "../core/clock.js";
import type { Magazin, Produs } from "../domain/model.js";

/**
 * Eveniment din sistemul central. „vanzare” = vânzare la casă;
 * „heartbeat” = confirmarea periodică (o dată pe minut) că starea magazinului e la zi.
 * Ambele trec prin același flux, deci o întârziere de procesare le afectează pe amândouă.
 */
export interface SaleEvent {
  seq: number;
  tip: "vanzare" | "heartbeat";
  idMagazin: string;
  codProdus: string;
  cantitate: number;
  /** Momentul la care starea din sistemul central era cea descrisă de eveniment. */
  at: number;
}

export class CentralUnavailableError extends Error {
  constructor() {
    super("Sistemul central de gestiune nu răspunde");
  }
}

export class RateLimitError extends Error {
  constructor(public readonly idMagazin: string, public readonly retryAfterMs: number) {
    super(`Limita API: un apel pe minut pentru magazinul ${idMagazin}`);
  }
}

type SaleHandler = (e: SaleEvent) => void;

export class CentralSystemSimulator {
  readonly magazine = new Map<string, Magazin>();
  readonly produse = new Map<string, Produs>();
  private stoc = new Map<string, number>();
  private lastApiCall = new Map<string, number>();
  private saleHandlers: SaleHandler[] = [];
  private buffered: SaleEvent[] = [];
  private seq = 0;
  private online = true;

  constructor(private readonly clock: Clock, private readonly rateLimitMs = MINUTE) {}

  addMagazin(m: Magazin): void {
    this.magazine.set(m.idMagazin, m);
  }

  addProdus(p: Produs): void {
    this.produse.set(p.cod, p);
  }

  setStoc(idMagazin: string, codProdus: string, cantitate: number): void {
    this.stoc.set(key(idMagazin, codProdus), cantitate);
  }

  /** Stocul fizic „adevărat” din sistem (folosit doar de teste și de culegere). */
  stocReal(idMagazin: string, codProdus: string): number {
    return this.stoc.get(key(idMagazin, codProdus)) ?? 0;
  }

  setOnline(online: boolean): void {
    this.online = online;
    if (online) {
      const pending = this.buffered;
      this.buffered = [];
      pending.forEach((e) => this.dispatch(e));
    }
  }

  isOnline(): boolean {
    return this.online;
  }

  // ---------- API (pull) ----------

  /** GET /stores/{id}/stock — limitat la un apel pe minut pentru fiecare magazin. */
  getStocMagazin(idMagazin: string): { codProdus: string; cantitate: number }[] {
    if (!this.online) throw new CentralUnavailableError();
    const now = this.clock.now();
    const last = this.lastApiCall.get(idMagazin);
    if (last !== undefined && now - last < this.rateLimitMs) {
      throw new RateLimitError(idMagazin, this.rateLimitMs - (now - last));
    }
    this.lastApiCall.set(idMagazin, now);
    const out: { codProdus: string; cantitate: number }[] = [];
    for (const [k, cantitate] of this.stoc) {
      const [m, p] = k.split("|");
      if (m === idMagazin) out.push({ codProdus: p, cantitate });
    }
    return out;
  }

  // ---------- Evenimente (push) ----------

  onSale(handler: SaleHandler): () => void {
    this.saleHandlers.push(handler);
    return () => {
      this.saleHandlers = this.saleHandlers.filter((h) => h !== handler);
    };
  }

  /** O vânzare la casa magazinului: scade stocul și emite evenimentul de vânzare. */
  vindeLaCasa(idMagazin: string, codProdus: string, cantitate = 1): SaleEvent {
    const k = key(idMagazin, codProdus);
    this.stoc.set(k, Math.max(0, (this.stoc.get(k) ?? 0) - cantitate));
    const e: SaleEvent = { seq: ++this.seq, tip: "vanzare", idMagazin, codProdus, cantitate, at: this.clock.now() };
    if (this.online) this.dispatch(e);
    else this.buffered.push(e);
    return e;
  }

  /** Heartbeat pentru toate magazinele (în producție: la fiecare minut). Offline nu se emite nimic. */
  heartbeat(): void {
    if (!this.online) return;
    for (const idMagazin of this.magazine.keys()) {
      this.dispatch({ seq: ++this.seq, tip: "heartbeat", idMagazin, codProdus: "", cantitate: 0, at: this.clock.now() });
    }
  }

  /** Ultimul număr de secvență emis — folosit ca „watermark” la încărcarea inițială. */
  lastSeq(): number {
    return this.seq;
  }

  /** Scade stocul pentru produsele culese pentru o comandă online (nu emite eveniment de casă). */
  scadeStocComanda(idMagazin: string, codProdus: string, cantitate: number): void {
    const k = key(idMagazin, codProdus);
    this.stoc.set(k, Math.max(0, (this.stoc.get(k) ?? 0) - cantitate));
  }

  private dispatch(e: SaleEvent): void {
    this.saleHandlers.forEach((h) => h(e));
  }
}

const key = (m: string, p: string) => `${m}|${p}`;
