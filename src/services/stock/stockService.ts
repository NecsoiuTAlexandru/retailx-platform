/**
 * Serviciul Stoc — US-01 (stoc verificat) și US-02 (rezervare la plată).
 *
 * Reguli (FR-01, FR-02, BR-04, validate cu expertul în domeniu în S1):
 *  - stocul online e confirmat doar dacă ultima confirmare din sistemul central are ≤ 5 minute;
 *    altfel clientul vede „disponibilitate neconfirmată”, niciodată „în stoc”;
 *  - stoc de siguranță: 2 bucăți pe magazin nu se vând online (aprobat de PO, Daily 5 martie);
 *  - la inițierea plății cantitatea se rezervă 15 minute; rezervarea e „totul sau nimic”.
 */
import type { Clock } from "../../core/clock.js";
import { MINUTE } from "../../core/clock.js";
import type { CentralSystemSimulator, SaleEvent } from "../../central/centralSystem.js";
import type { StocMagazin } from "../../domain/model.js";
import { SaleEventProcessor } from "./eventProcessor.js";

export const PRAG_CONFIRMARE_MS = 5 * MINUTE;
export const STOC_SIGURANTA = 2;
export const DURATA_REZERVARE_MS = 15 * MINUTE;

export type EtichetaDisponibilitate = "in_stoc" | "indisponibil" | "neconfirmat";

export interface Disponibilitate {
  idMagazin: string;
  codProdus: string;
  eticheta: EtichetaDisponibilitate;
  /** Bucăți vandabile online (după stocul de siguranță și rezervări); null dacă e neconfirmat. */
  disponibil: number | null;
  /** Vechimea datelor, în secunde — se afișează clientului („confirmat acum 3 min”). */
  vechimeSecunde: number;
}

export interface LinieRezervare {
  codProdus: string;
  cantitate: number;
}

export interface RezervareStoc {
  id: string;
  idMagazin: string;
  linii: LinieRezervare[];
  creata: number;
  /** Infinity după confirmarea comenzii: stocul rămâne alocat până la culegere. */
  expira: number;
  nrComanda?: string;
}

export class StocInsuficientError extends Error {
  constructor(public readonly lipsa: { codProdus: string; ceruta: number; disponibila: number }[]) {
    super("Produsul nu mai este disponibil în cantitatea cerută");
  }
}

export class StockService {
  private cache = new Map<string, StocMagazin>();
  /** Ultima confirmare de la sistemul central, pe magazin. */
  private confirmare = new Map<string, number>();
  private watermark = 0;
  private rezervari = new Map<string, RezervareStoc>();
  private nextId = 1;
  readonly processor: SaleEventProcessor;

  constructor(
    private readonly clock: Clock,
    private readonly central: CentralSystemSimulator,
    processor?: SaleEventProcessor,
  ) {
    this.processor = processor ?? new SaleEventProcessor(clock, (e, at) => this.aplica(e, at));
    central.onSale((e) => this.processor.enqueue(e));
  }

  /** Încărcarea inițială prin API (o dată la pornire, respectând limita de 1 apel/min/magazin). */
  incarcaInitial(): void {
    const now = this.clock.now();
    this.watermark = this.central.lastSeq();
    for (const idMagazin of this.central.magazine.keys()) {
      for (const s of this.central.getStocMagazin(idMagazin)) {
        this.cache.set(key(idMagazin, s.codProdus), {
          idMagazin,
          codProdus: s.codProdus,
          cantitate: s.cantitate,
          ultimaActualizare: now,
        });
      }
      this.confirmare.set(idMagazin, now);
    }
  }

  private aplica(e: SaleEvent, _appliedAt: number): void {
    if (e.seq <= this.watermark) return; // deja inclus în încărcarea inițială
    if (e.tip === "vanzare") {
      const s = this.cache.get(key(e.idMagazin, e.codProdus));
      if (s) {
        s.cantitate = Math.max(0, s.cantitate - e.cantitate);
        s.ultimaActualizare = e.at;
      }
    }
    // Starea magazinului e la zi până la momentul evenimentului procesat.
    const prev = this.confirmare.get(e.idMagazin) ?? 0;
    this.confirmare.set(e.idMagazin, Math.max(prev, e.at));
  }

  // ---------- US-01: disponibilitate ----------

  disponibilitate(idMagazin: string, codProdus: string): Disponibilitate {
    this.processor.drain();
    this.expiraRezervari();
    const now = this.clock.now();
    const confirmat = this.confirmare.get(idMagazin) ?? 0;
    const vechime = now - confirmat;
    const vechimeSecunde = Math.max(0, Math.round(vechime / 1000));
    if (!this.confirmare.has(idMagazin) || vechime > PRAG_CONFIRMARE_MS) {
      return { idMagazin, codProdus, eticheta: "neconfirmat", disponibil: null, vechimeSecunde };
    }
    const disponibil = this.vandabil(idMagazin, codProdus);
    return {
      idMagazin,
      codProdus,
      eticheta: disponibil > 0 ? "in_stoc" : "indisponibil",
      disponibil,
      vechimeSecunde,
    };
  }

  disponibilitateToateMagazinele(codProdus: string): Disponibilitate[] {
    return [...this.central.magazine.keys()].map((m) => this.disponibilitate(m, codProdus));
  }

  private vandabil(idMagazin: string, codProdus: string): number {
    const fizic = this.cache.get(key(idMagazin, codProdus))?.cantitate ?? 0;
    return Math.max(0, fizic - STOC_SIGURANTA - this.rezervat(idMagazin, codProdus));
  }

  private rezervat(idMagazin: string, codProdus: string): number {
    let total = 0;
    for (const r of this.rezervari.values()) {
      if (r.idMagazin !== idMagazin) continue;
      for (const l of r.linii) if (l.codProdus === codProdus) total += l.cantitate;
    }
    return total;
  }

  // ---------- US-02: rezervare la plată ----------

  rezerva(idMagazin: string, linii: LinieRezervare[]): RezervareStoc {
    const lipsa = [];
    for (const l of linii) {
      const d = this.disponibilitate(idMagazin, l.codProdus);
      // BR-04: nu rezervăm pe stoc neconfirmat
      const disponibila = d.eticheta === "neconfirmat" ? 0 : d.disponibil ?? 0;
      if (disponibila < l.cantitate) lipsa.push({ codProdus: l.codProdus, ceruta: l.cantitate, disponibila });
    }
    if (lipsa.length) throw new StocInsuficientError(lipsa);
    const now = this.clock.now();
    const r: RezervareStoc = {
      id: `REZ-${this.nextId++}`,
      idMagazin,
      linii: linii.map((l) => ({ ...l })),
      creata: now,
      expira: now + DURATA_REZERVARE_MS,
    };
    this.rezervari.set(r.id, r);
    return r;
  }

  rezervare(id: string): RezervareStoc | undefined {
    this.expiraRezervari();
    return this.rezervari.get(id);
  }

  elibereaza(id: string): boolean {
    return this.rezervari.delete(id);
  }

  /** Plata autorizată: rezervarea devine alocare pentru comandă și nu mai expiră. */
  confirma(id: string, nrComanda: string): void {
    const r = this.rezervari.get(id);
    if (!r) throw new Error(`Rezervare inexistentă sau expirată: ${id}`);
    r.expira = Number.POSITIVE_INFINITY;
    r.nrComanda = nrComanda;
  }

  /** Rezervarea mai e valabilă (nu a expirat)? */
  esteValida(id: string): boolean {
    return this.rezervare(id) !== undefined;
  }

  private expiraRezervari(): void {
    const now = this.clock.now();
    for (const [id, r] of this.rezervari) if (r.expira <= now) this.rezervari.delete(id);
  }
}

const key = (m: string, p: string) => `${m}|${p}`;
