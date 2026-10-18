/**
 * Coșul de cumpărături. În S1 doar cât e nevoie pentru US-02:
 * coșul ține legătura cu rezervarea, iar golirea coșului anulează imediat rezervarea (TC-03c).
 */
import type { StockService } from "../stock/stockService.js";

export interface LinieCos {
  codProdus: string;
  cantitate: number;
}

export interface Cos {
  id: string;
  idMagazin: string;
  linii: LinieCos[];
  rezervareId?: string;
}

export class CartService {
  private cosuri = new Map<string, Cos>();

  constructor(private readonly stock: StockService) {}

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

  adauga(id: string, codProdus: string, cantitate = 1): Cos {
    const c = this.get(id);
    const l = c.linii.find((x) => x.codProdus === codProdus);
    if (l) l.cantitate += cantitate;
    else c.linii.push({ codProdus, cantitate });
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

  /** Inițierea plății: rezervă tot coșul pentru 15 minute. */
  rezerva(id: string) {
    const c = this.get(id);
    if (c.rezervareId) this.stock.elibereaza(c.rezervareId);
    const r = this.stock.rezerva(c.idMagazin, c.linii);
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
  }
}
