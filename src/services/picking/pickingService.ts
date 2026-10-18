/**
 * Aplicația de culegere din magazin — US-09 / FR-09 (Must).
 *
 * Elena (culegătorul) vede din aplicație ce face cu un produs lipsă, fără să sune clientul:
 *  - dacă clientul a acceptat înlocuirea: primește un produs similar (aceeași categorie);
 *  - altfel (sau dacă nu există înlocuitor): se elimină DOAR linia lipsă și se rambursează;
 *  - comanda se anulează integral doar dacă lipsesc toate produsele (ce măsoară KPI 2).
 * Stare compusă „În pregătire” din diagrama de stări: Culegere → Înlocuire / EliminareLinie → Ambalare.
 */
import { SGR_PER_AMBALAJ, formatLei, type Bani } from "../../core/money.js";
import type { CentralSystemSimulator } from "../../central/centralSystem.js";
import type { Comanda, LinieComanda, Produs } from "../../domain/model.js";
import type { FulfillmentService } from "../fulfillment/fulfillmentService.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { OrderService } from "../orders/orderService.js";
import { NegasitError } from "../../core/errors.js";

export interface RezultatCulegere {
  codProdus: string;
  /** Câte bucăți a găsit culegătorul pe raft. */
  gasit: number;
}

export const MOTIV_LIPSA_STOC = "lipsă de stoc — toate produsele";

export class PickingService {
  constructor(
    private readonly orders: OrderService,
    private readonly fulfillment: FulfillmentService,
    private readonly central: CentralSystemSimulator,
    private readonly notificari: NotificationService,
  ) {}

  /** Lista de lucru a culegătorului pentru magazinul lui. */
  deCules(idMagazin: string): Comanda[] {
    return this.orders.toate().filter((c) => c.idMagazin === idMagazin && (c.status === "Confirmata" || c.status === "InPregatire"));
  }

  /**
   * Culegătorul raportează ce a găsit pe raft. Liniile nemenționate se consideră găsite integral.
   */
  culege(nrComanda: string, rezultate: RezultatCulegere[] = []): Comanda {
    const c = this.orders.get(nrComanda);
    if (!c) throw new NegasitError(`Comanda ${nrComanda} nu există`);
    if (c.status === "Confirmata") this.fulfillment.incepePregatirea(nrComanda);

    const culese: { codProdus: string; cantitate: number }[] = [];
    let deRambursat: Bani = 0;
    const inlocuite: LinieComanda[] = [];

    for (const linie of c.linii) {
      const gasit = Math.min(linie.cantitate, rezultate.find((r) => r.codProdus === linie.codProdus)?.gasit ?? linie.cantitate);
      const lipsa = linie.cantitate - gasit;
      if (gasit > 0) culese.push({ codProdus: linie.codProdus, cantitate: gasit });
      if (lipsa === 0) continue;

      const produs = this.central.produse.get(linie.codProdus);
      const inlocuitor = linie.acceptaInlocuire ? this.propuneInlocuitor(c.idMagazin, linie, lipsa) : undefined;
      if (inlocuitor) {
        const diferenta = Math.max(0, (linie.pretUnitar - inlocuitor.pret) * lipsa);
        linie.inlocuire = {
          codProdus: inlocuitor.cod,
          denumire: inlocuitor.denumire,
          pretUnitar: inlocuitor.pret,
          motiv: "produs lipsă la raft",
          diferentaRambursata: diferenta,
        };
        culese.push({ codProdus: inlocuitor.cod, cantitate: lipsa });
        deRambursat += diferenta;
        inlocuite.push(linie);
      } else {
        // EliminareLinie: doar cantitatea lipsă, cu garanția SGR aferentă
        deRambursat += lipsa * (linie.pretUnitar + (produs?.areGarantieSGR ? SGR_PER_AMBALAJ : 0));
        if (gasit === 0) linie.eliminata = true;
        else linie.cantitate = gasit;
      }
    }

    if (c.linii.every((l) => l.eliminata)) {
      return this.orders.anuleaza(nrComanda, MOTIV_LIPSA_STOC);
    }

    this.orders.ramburseaza(c, deRambursat, "produse lipsă / diferență înlocuitor");
    for (const l of inlocuite) {
      const i = l.inlocuire!;
      this.notificari.tranzactionala(
        c,
        undefined,
        "1 produs înlocuit, cum ai ales",
        `${l.denumire} → ${i.denumire}.` + (i.diferentaRambursata ? ` Diferența de ${formatLei(i.diferentaRambursata)} a fost rambursată.` : ""),
      );
    }
    return this.fulfillment.finalizeazaPregatirea(nrComanda, culese);
  }

  /**
   * Produs similar pentru linia lipsă: aceeași categorie, aceeași regulă SGR, pe raft în magazin
   * și la PREȚ EGAL SAU MAI MIC decât cel plătit (remedierea DEF-02, S5).
   * Dintre candidați îl alegem pe cel mai apropiat ca preț, ca diferența rambursată să fie minimă.
   */
  propuneInlocuitor(idMagazin: string, linie: LinieComanda, cantitate: number): Produs | undefined {
    const original = this.central.produse.get(linie.codProdus);
    if (!original?.categorie) return undefined;
    return [...this.central.produse.values()]
      .filter(
        (p) =>
          p.cod !== original.cod &&
          p.categorie === original.categorie &&
          p.areGarantieSGR === original.areGarantieSGR &&
          p.pret <= linie.pretUnitar &&
          this.central.stocReal(idMagazin, p.cod) >= cantitate,
      )
      .sort((a, b) => b.pret - a.pret)[0];
  }
}
