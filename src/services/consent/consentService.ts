/**
 * Consimțăminte — NFR-03 / BR-05 (GDPR).
 *
 * Consimțământ SEPARAT pentru marketing și pentru recomandări personalizate (clasa Consimțământ
 * din diagrama de clase). Implicit: niciun acord. Notificările despre comandă sunt tranzacționale
 * și nu au nevoie de acord, dar nu pot conține oferte.
 */
import type { Clock } from "../../core/clock.js";

export type TipConsimtamant = "marketing" | "recomandari";

export interface Consimtamant {
  idClient: string;
  tip: TipConsimtamant;
  acordat: boolean;
  dataAcord: number;
}

export class ConsentService {
  private date = new Map<string, Consimtamant>();
  /** Istoricul complet (cine, ce, când) — dovada acordului cerută de art. 7 GDPR. */
  readonly jurnal: Consimtamant[] = [];

  constructor(private readonly clock: Clock) {}

  seteaza(idClient: string, tip: TipConsimtamant, acordat: boolean): Consimtamant {
    const c: Consimtamant = { idClient, tip, acordat, dataAcord: this.clock.now() };
    this.date.set(`${idClient}|${tip}`, c);
    this.jurnal.push(c);
    return c;
  }

  acorda(idClient: string, tip: TipConsimtamant): Consimtamant {
    return this.seteaza(idClient, tip, true);
  }

  retrage(idClient: string, tip: TipConsimtamant): Consimtamant {
    return this.seteaza(idClient, tip, false);
  }

  are(idClient: string | undefined, tip: TipConsimtamant): boolean {
    if (!idClient) return false;
    return this.date.get(`${idClient}|${tip}`)?.acordat ?? false;
  }

  ale(idClient: string): Record<TipConsimtamant, boolean> {
    return { marketing: this.are(idClient, "marketing"), recomandari: this.are(idClient, "recomandari") };
  }
}
