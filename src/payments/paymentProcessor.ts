/**
 * Simulatorul procesatorului de plăți (mediul sandbox) — US-04, NFR-02.
 *
 * Ce simulăm:
 *  - 3-D Secure (autentificarea clientului) înaintea autorizării;
 *  - carduri de test: unul care trece, unul cu fonduri insuficiente, unul cu 3-D Secure eșuat;
 *  - IDEMPOTENȚĂ: aceeași cheie de idempotență întoarce același rezultat și nu mai debitează;
 *  - căderea conexiunii DUPĂ ce procesatorul a debitat (răspunsul se pierde) — cazul TC-07.
 * Platforma nu vede și nu stochează numărul cardului: primește doar un token de card.
 */
import type { Bani } from "../core/money.js";

export const CARDURI_TEST = {
  OK: "tok_visa_ok",
  FONDURI_INSUFICIENTE: "tok_visa_fonduri_insuficiente",
  ESEC_3DS: "tok_visa_3ds_esuat",
} as const;

export interface CerereAutorizare {
  suma: Bani;
  tokenCard: string;
  cheieIdempotenta: string;
  descriere?: string;
}

export interface RezultatAutorizare {
  status: "autorizata" | "refuzata";
  idTranzactie: string;
  motiv?: string;
}

export class ConexiuneIntreruptaError extends Error {
  constructor() {
    super("Conexiunea cu procesatorul s-a întrerupt");
  }
}

export class ProcesatorIndisponibilError extends Error {
  constructor() {
    super("Procesatorul de plăți nu răspunde");
  }
}

export interface Debitare {
  idTranzactie: string;
  suma: Bani;
  cheieIdempotenta: string;
  rambursat: Bani;
}

export class PaymentProcessorSimulator {
  private rezultate = new Map<string, RezultatAutorizare>();
  readonly debitari: Debitare[] = [];
  private nextId = 1;
  /** Câte răspunsuri să „piardă” (conexiune întreruptă după 3-D Secure). */
  intreruperiProgramate = 0;
  disponibil = true;

  autorizeaza(c: CerereAutorizare): RezultatAutorizare {
    if (!this.disponibil) throw new ProcesatorIndisponibilError();
    const existent = this.rezultate.get(c.cheieIdempotenta);
    if (existent) return existent; // retrimitere: același rezultat, fără a doua debitare

    const idTranzactie = `TX-${String(this.nextId++).padStart(6, "0")}`;
    let rezultat: RezultatAutorizare;
    if (c.tokenCard === CARDURI_TEST.ESEC_3DS) {
      rezultat = { status: "refuzata", idTranzactie, motiv: "Autentificarea 3-D Secure nu a reușit" };
    } else if (c.tokenCard === CARDURI_TEST.FONDURI_INSUFICIENTE) {
      rezultat = { status: "refuzata", idTranzactie, motiv: "Fonduri insuficiente" };
    } else {
      rezultat = { status: "autorizata", idTranzactie };
      this.debitari.push({ idTranzactie, suma: c.suma, cheieIdempotenta: c.cheieIdempotenta, rambursat: 0 });
    }
    this.rezultate.set(c.cheieIdempotenta, rezultat);

    if (this.intreruperiProgramate > 0) {
      this.intreruperiProgramate--;
      throw new ConexiuneIntreruptaError(); // procesatorul a debitat, dar răspunsul nu ajunge
    }
    return rezultat;
  }

  /** Rambursare (totală sau parțială) pe o tranzacție autorizată. */
  ramburseaza(idTranzactie: string, suma: Bani): void {
    const d = this.debitari.find((x) => x.idTranzactie === idTranzactie);
    if (!d) throw new Error(`Tranzacție necunoscută: ${idTranzactie}`);
    if (d.rambursat + suma > d.suma) throw new Error("Rambursarea depășește suma debitată");
    d.rambursat += suma;
  }

  /** Total debitat net de pe un card de test (pentru verificări în teste). */
  totalDebitat(): Bani {
    return this.debitari.reduce((s, d) => s + d.suma - d.rambursat, 0);
  }
}
