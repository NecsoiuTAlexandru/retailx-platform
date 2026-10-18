/**
 * Calculul costului total — US-03 / FR-03 (Must).
 *
 * Costul total = produse + livrare + garanție SGR − reduceri, afișat defalcat ÎNAINTE de plată.
 * Prețurile se iau mereu din catalog, pe server, niciodată din ce trimite clientul.
 *
 * Reguli (validate cu BA-ul; pragul e ipoteză de validat în pilot):
 *  - livrare la domiciliu: 15,00 lei sub pragul de 200,00 lei (valoarea produselor), gratuită de la prag;
 *  - ridicare din magazin: gratuită;
 *  - garanție SGR: 0,50 lei pentru fiecare ambalaj cu garanție.
 */
import { lei, SGR_PER_AMBALAJ, type Bani } from "../../core/money.js";
import type { Deviz, Produs, TipPrimire } from "../../domain/model.js";

export const TAXA_LIVRARE: Bani = lei(15);
export const PRAG_LIVRARE_GRATUITA: Bani = lei(200);

export class ProdusNecunoscutError extends Error {
  constructor(cod: string) {
    super(`Produs necunoscut: ${cod}`);
  }
}

export interface Reducere {
  descriere: string;
  suma: Bani;
}

export class PricingService {
  constructor(private readonly catalog: Map<string, Produs>) {}

  deviz(linii: { codProdus: string; cantitate: number }[], tipPrimire: TipPrimire, reduceri: Reducere[] = []): Deviz {
    const detaliu = linii.map((l) => {
      const p = this.catalog.get(l.codProdus);
      if (!p) throw new ProdusNecunoscutError(l.codProdus);
      return { codProdus: p.cod, denumire: p.denumire, cantitate: l.cantitate, pretUnitar: p.pret, total: p.pret * l.cantitate };
    });
    const produse = detaliu.reduce((s, l) => s + l.total, 0);
    const ambalajeSGR = linii.reduce((s, l) => s + (this.catalog.get(l.codProdus)!.areGarantieSGR ? l.cantitate : 0), 0);
    const garantieSGR = ambalajeSGR * SGR_PER_AMBALAJ;
    const livrare = tipPrimire === "livrare" && produse < PRAG_LIVRARE_GRATUITA ? TAXA_LIVRARE : 0;
    // o reducere nu poate depăși valoarea produselor
    const totalReduceri = Math.min(produse, reduceri.reduce((s, r) => s + r.suma, 0));
    return {
      linii: detaliu,
      produse,
      livrare,
      garantieSGR,
      ambalajeSGR,
      reduceri,
      total: produse + livrare + garantieSGR - totalReduceri,
    };
  }
}
