/**
 * Coșul de cumpărături.
 *
 *  - S1: legătura cu rezervarea; golirea coșului anulează imediat rezervarea (US-02, TC-03c).
 *  - S3: coș comun între website și aplicație pentru clientul autentificat (US-05 / FR-05).
 *    Coșul unui client autentificat e unul singur, indiferent de canal. La deschidere,
 *    prețul și stocul se reverifică, iar clientul vede ce s-a schimbat de când a adăugat produsul.
 */
import type { Bani } from "../../core/money.js";
import type { Produs } from "../../domain/model.js";
import type { EtichetaDisponibilitate, StockService } from "../stock/stockService.js";

export type Canal = "website" | "aplicatie";

export interface LinieCos {
  codProdus: string;
  cantitate: number;
  /** Prețul la momentul adăugării, ca să putem anunța o schimbare de preț. */
  pretLaAdaugare?: Bani;
}

export interface Cos {
  id: string;
  idClient?: string;
  idMagazin: string;
  linii: LinieCos[];
  rezervareId?: string;
  actualizatDin?: Canal;
  /** US-09: „Accept un produs înlocuitor similar, la preț egal sau mai mic” — activat explicit de client. */
  acceptaInlocuire?: boolean;
  /** S5: puncte de fidelitate folosite ca reducere la această comandă. */
  puncteFolosite?: number;
}

export interface VerificareLinie {
  codProdus: string;
  cantitate: number;
  pretLaAdaugare?: Bani;
  pretCurent: Bani;
  pretModificat: boolean;
  eticheta: EtichetaDisponibilitate;
  disponibil: number | null;
  /** Cantitatea din coș nu mai poate fi onorată din magazinul ales. */
  stocInsuficient: boolean;
}

export const idCosClient = (idClient: string) => `client:${idClient}`;

export class CartService {
  private cosuri = new Map<string, Cos>();

  constructor(
    private readonly stock: StockService,
    private readonly catalog: Map<string, Produs>,
  ) {}

  get(id: string, idMagazin = "PH-NORD"): Cos {
    let c = this.cosuri.get(id);
    if (!c) {
      c = { id, idMagazin, linii: [] };
      this.cosuri.set(id, c);
    }
    return c;
  }

  setMagazin(id: string, idMagazin: string): Cos {
    const c = this.get(id);
    c.idMagazin = idMagazin;
    return c;
  }

  adauga(id: string, codProdus: string, cantitate = 1, canal?: Canal): Cos {
    const c = this.get(id);
    const pret = this.catalog.get(codProdus)?.pret;
    const l = c.linii.find((x) => x.codProdus === codProdus);
    if (l) {
      l.cantitate += cantitate;
      l.pretLaAdaugare = pret;
    } else c.linii.push({ codProdus, cantitate, pretLaAdaugare: pret });
    if (canal) c.actualizatDin = canal;
    return c;
  }

  elimina(id: string, codProdus: string): Cos {
    const c = this.get(id);
    c.linii = c.linii.filter((l) => l.codProdus !== codProdus);
    if (!c.linii.length) this.elibereazaRezervarea(c);
    return c;
  }

  /** Golirea coșului anulează imediat rezervarea (US-02, TC-03c). */
  goleste(id: string): Cos {
    const c = this.get(id);
    c.linii = [];
    this.elibereazaRezervarea(c);
    return c;
  }

  /** S4 · US-09: preferința de înlocuire, aleasă din coș. Implicit: dezactivată. */
  seteazaInlocuire(id: string, accepta: boolean): Cos {
    const c = this.get(id);
    c.acceptaInlocuire = accepta;
    return c;
  }

  // ---------- S3 · US-05: coș comun pe canale ----------

  /**
   * Autentificarea: coșul anonim (început înainte de login) se mută în coșul clientului.
   * Întoarce coșul clientului, același pe website și în aplicație.
   */
  autentifica(idCosAnonim: string | undefined, idClient: string): Cos {
    const cosClient = this.get(idCosClient(idClient));
    cosClient.idClient = idClient;
    if (idCosAnonim && idCosAnonim !== cosClient.id && this.cosuri.has(idCosAnonim)) {
      const anonim = this.cosuri.get(idCosAnonim)!;
      for (const l of anonim.linii) {
        const ex = cosClient.linii.find((x) => x.codProdus === l.codProdus);
        if (ex) ex.cantitate = Math.max(ex.cantitate, l.cantitate);
        else cosClient.linii.push({ ...l });
      }
      if (anonim.linii.length) cosClient.idMagazin = anonim.idMagazin; // magazinul ales ultima dată
      this.elibereazaRezervarea(anonim);
      this.cosuri.delete(idCosAnonim);
    }
    return cosClient;
  }

  /** Deschiderea coșului pe orice canal: același coș, cu prețul și stocul reverificate. */
  deschide(idClient: string, canal: Canal): { cos: Cos; verificare: VerificareLinie[] } {
    const cos = this.get(idCosClient(idClient));
    cos.idClient = idClient;
    cos.actualizatDin = canal;
    return { cos, verificare: this.verifica(cos.id) };
  }

  verifica(id: string): VerificareLinie[] {
    const c = this.get(id);
    return c.linii.map((l) => {
      const pretCurent = this.catalog.get(l.codProdus)?.pret ?? 0;
      const d = this.stock.disponibilitate(c.idMagazin, l.codProdus);
      return {
        codProdus: l.codProdus,
        cantitate: l.cantitate,
        pretLaAdaugare: l.pretLaAdaugare,
        pretCurent,
        pretModificat: l.pretLaAdaugare !== undefined && l.pretLaAdaugare !== pretCurent,
        eticheta: d.eticheta,
        disponibil: d.disponibil,
        stocInsuficient: d.eticheta !== "in_stoc" || (d.disponibil ?? 0) < l.cantitate,
      };
    });
  }

  // ---------- Rezervare (S1) ----------

  /** Inițierea plății: rezervă tot coșul pentru 15 minute. */
  rezerva(id: string) {
    const c = this.get(id);
    if (c.rezervareId) this.stock.elibereaza(c.rezervareId);
    const r = this.stock.rezerva(
      c.idMagazin,
      c.linii.map((l) => ({ codProdus: l.codProdus, cantitate: l.cantitate })),
    );
    c.rezervareId = r.id;
    return r;
  }

  /** Plata refuzată: rezervarea se eliberează, dar produsele rămân în coș (US-04). */
  elibereazaRezervarea(idOrCos: string | Cos): void {
    const c = typeof idOrCos === "string" ? this.get(idOrCos) : idOrCos;
    if (c.rezervareId) {
      this.stock.elibereaza(c.rezervareId);
      c.rezervareId = undefined;
    }
  }

  /** După confirmarea comenzii: coșul se golește, iar rezervarea rămâne alocată comenzii. */
  dupaComanda(id: string): void {
    const c = this.get(id);
    c.linii = [];
    c.rezervareId = undefined;
    c.puncteFolosite = undefined;
  }
}
