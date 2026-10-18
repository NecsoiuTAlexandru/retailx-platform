/**
 * Onorarea comenzii: pregătire în magazin, apoi ridicare cu cod sau livrare prin curier.
 * Urmează diagrama de stări (cap. 8.5):
 *   Confirmată → În pregătire → Gata de ridicare (cod) → Onorată
 *                             → În livrare (AWB + link de urmărire) → Onorată
 *   Gata de ridicare, neridicată în 48 h → Anulată, cu rambursare.
 *
 * „Onorată” = livrată sau ridicată (definiția din fișa inițiativei).
 */
import type { Clock } from "../../core/clock.js";
import { HOUR } from "../../core/clock.js";
import type { Comanda } from "../../domain/model.js";
import type { CourierSimulator } from "../../courier/courierSimulator.js";
import type { OrderService } from "../orders/orderService.js";
import type { StockService } from "../stock/stockService.js";

export const TERMEN_RIDICARE = 48 * HOUR;

export class CodRidicareGresitError extends Error {
  constructor() {
    super("Codul de ridicare nu este corect");
  }
}

export class FulfillmentService {
  constructor(
    private readonly clock: Clock,
    private readonly orders: OrderService,
    private readonly stock: StockService,
    private readonly curier: CourierSimulator,
    private readonly genereazaCod: () => string = () => String(1000 + Math.floor(Math.random() * 9000)),
  ) {}

  private comanda(nr: string): Comanda {
    const c = this.orders.get(nr);
    if (!c) throw new Error(`Comanda nu există: ${nr}`);
    return c;
  }

  /** Magazinul preia comanda. */
  incepePregatirea(nr: string): Comanda {
    const c = this.comanda(nr);
    this.orders.status(c, "InPregatire");
    return c;
  }

  /**
   * Comanda e ambalată: produsele culese ies din stoc, apoi
   * ridicare → cod de ridicare; livrare → predare la curier.
   */
  finalizeazaPregatirea(nr: string, culese?: { codProdus: string; cantitate: number }[]): Comanda {
    const c = this.comanda(nr);
    if (c.rezervareId) {
      this.stock.consuma(c.rezervareId, culese ?? c.linii.map((l) => ({ codProdus: l.codProdus, cantitate: l.cantitate })));
    }
    if (c.primire?.tip === "ridicare") {
      c.primire.codRidicare = this.genereazaCod();
      c.primire.gataLa = this.clock.now();
      this.orders.status(c, "GataDeRidicare");
    } else if (c.primire?.tip === "livrare") {
      const colet = this.curier.preiaColet(c.nrComanda, c.primire.adresa);
      c.primire.awbCurier = colet.awb;
      c.primire.linkUrmarire = colet.linkUrmarire;
      this.orders.status(c, "InLivrare");
    }
    return c;
  }

  /** Clientul ridică comanda arătând codul (sau cardul de fidelitate). */
  ridica(nr: string, cod: string): Comanda {
    const c = this.comanda(nr);
    if (c.primire?.tip !== "ridicare" || c.primire.codRidicare !== cod) throw new CodRidicareGresitError();
    this.orders.status(c, "Onorata");
    return c;
  }

  /** Curierul confirmă livrarea. */
  confirmaLivrarea(nr: string): Comanda {
    const c = this.comanda(nr);
    if (c.primire?.tip === "livrare" && c.primire.awbCurier) this.curier.marcheazaLivrat(c.primire.awbCurier);
    this.orders.status(c, "Onorata");
    return c;
  }

  /** Rulează periodic: comenzile neridicate în 48 h se anulează și se rambursează. */
  verificaNeridicate(): Comanda[] {
    const now = this.clock.now();
    return this.orders
      .toate()
      .filter((c) => c.status === "GataDeRidicare" && c.primire?.tip === "ridicare" && now - (c.primire.gataLa ?? now) >= TERMEN_RIDICARE)
      .map((c) => this.orders.anuleaza(c.nrComanda, "neridicată în 48 h"));
  }
}
