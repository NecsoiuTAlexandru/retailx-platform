/**
 * Retur și rambursare inițiate din contul clientului — US-10 / FR-10 (Should).
 *
 * Azi returul merge doar prin call center; în TO-BE clientul cu cont cere returul din aplicație,
 * primește un număr de cerere și vede statusul și termenul rambursării (macheta „Cerere de retur”).
 *
 * Reguli (OUG 34/2014, validate cu BA-ul):
 *  - doar clientul cu cont care a plasat comanda (diagrama use case: Client cu cont și card);
 *  - doar pentru comenzi „Onorate”, în 14 zile de la predare;
 *  - produsele perisabile nu se pot returna din simplă răzgândire, doar dacă sunt deteriorate/neconforme;
 *  - se rambursează prețul plătit + garanția SGR; la returul întregii comenzi, și livrarea;
 *  - termenul de rambursare afișat: maximum 14 zile de la înregistrare.
 */
import type { Clock } from "../../core/clock.js";
import { DAY } from "../../core/clock.js";
import { SGR_PER_AMBALAJ, formatLei, type Bani } from "../../core/money.js";
import type { CentralSystemSimulator } from "../../central/centralSystem.js";
import type { Comanda } from "../../domain/model.js";
import type { CourierSimulator } from "../../courier/courierSimulator.js";
import type { LoyaltyService } from "../loyalty/loyaltyService.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { OrderService } from "../orders/orderService.js";

export const TERMEN_RETRAGERE = 14 * DAY;
export const TERMEN_RAMBURSARE = 14 * DAY;

export type MotivRetur = "deteriorat" | "neconform" | "razgandire";
export type ModReturnare = "magazin" | "curier";
export type StatusRetur = "Inregistrata" | "Aprobata" | "Rambursata" | "Respinsa";

export interface CerereRetur {
  id: string;
  nrComanda: string;
  idClient: string;
  linii: { codProdus: string; denumire: string; cantitate: number }[];
  motiv: MotivRetur;
  fotografie?: string;
  modReturnare: ModReturnare;
  awbRetur?: string;
  status: StatusRetur;
  sumaRambursata: Bani;
  creata: number;
  termenRambursare: number;
  istoric: { status: StatusRetur; la: number }[];
}

export class ReturRefuzatError extends Error {}

export class ReturnService {
  private cereri = new Map<string, CerereRetur>();
  private next = 1092;

  constructor(
    private readonly clock: Clock,
    private readonly orders: OrderService,
    private readonly central: CentralSystemSimulator,
    private readonly curier: CourierSimulator,
    private readonly fidelitate: LoyaltyService,
    private readonly notificari: NotificationService,
  ) {}

  ceRetur(id: string): CerereRetur | undefined {
    return this.cereri.get(id);
  }

  aleClientului(idClient: string): CerereRetur[] {
    return [...this.cereri.values()].filter((r) => r.idClient === idClient);
  }

  cere(
    idClient: string,
    nrComanda: string,
    linii: { codProdus: string; cantitate: number }[],
    motiv: MotivRetur,
    modReturnare: ModReturnare = "magazin",
    fotografie?: string,
  ): CerereRetur {
    const c = this.orders.get(nrComanda);
    if (!c || c.idClient !== idClient) throw new ReturRefuzatError("Comanda nu aparține contului tău");
    if (c.status !== "Onorata") throw new ReturRefuzatError("Returul se poate cere doar pentru comenzi predate");
    const predata = c.istoric.find((h) => h.status === "Onorata")!.la;
    if (this.clock.now() - predata > TERMEN_RETRAGERE) {
      throw new ReturRefuzatError("Au trecut mai mult de 14 zile de la predare");
    }
    if (!linii.length) throw new ReturRefuzatError("Alege cel puțin un produs");

    const detaliu = linii.map((l) => {
      const linie = c.linii.find((x) => x.codProdus === l.codProdus && !x.eliminata);
      if (!linie) throw new ReturRefuzatError(`Produsul ${l.codProdus} nu e în comandă`);
      const ramas = linie.cantitate - this.dejaReturnat(nrComanda, l.codProdus);
      if (l.cantitate < 1 || l.cantitate > ramas) throw new ReturRefuzatError(`Poți returna cel mult ${ramas} buc. din ${linie.denumire}`);
      const produs = this.central.produse.get(l.codProdus);
      if (motiv === "razgandire" && produs?.perisabil) {
        throw new ReturRefuzatError(`${linie.denumire} este perisabil și se poate returna doar dacă e deteriorat sau neconform`);
      }
      return { codProdus: l.codProdus, denumire: linie.inlocuire?.denumire ?? linie.denumire, cantitate: l.cantitate };
    });

    const now = this.clock.now();
    const r: CerereRetur = {
      id: `RT-${this.next++}`,
      nrComanda,
      idClient,
      linii: detaliu,
      motiv,
      fotografie,
      modReturnare,
      status: "Inregistrata",
      sumaRambursata: 0,
      creata: now,
      termenRambursare: now + TERMEN_RAMBURSARE,
      istoric: [{ status: "Inregistrata", la: now }],
    };
    if (modReturnare === "curier") r.awbRetur = this.curier.preiaColet(nrComanda, "retur către magazin").awb;
    this.cereri.set(r.id, r);
    this.notificari.tranzactionala(
      c,
      undefined,
      `Cererea ${r.id} a fost înregistrată`,
      `Rambursarea se face pe card în maximum 14 zile de la predarea produsului. Urmărești statusul în aplicație.`,
    );
    return r;
  }

  /** Magazinul (sau curierul) a primit produsul: returul se aprobă și se rambursează. */
  primesteProdusul(idRetur: string): CerereRetur {
    const r = this.cereri.get(idRetur);
    if (!r) throw new ReturRefuzatError("Cererea de retur nu există");
    if (r.status !== "Inregistrata") return r;
    const c = this.orders.get(r.nrComanda)!;
    this.stare(r, "Aprobata");

    const suma = this.sumaDeRambursat(c, r);
    this.orders.ramburseaza(c, suma, `retur ${r.id}`);
    r.sumaRambursata = suma;
    this.fidelitate.retrage(r.idClient, r.id, suma);
    this.stare(r, "Rambursata");

    if (this.totulReturnat(c)) this.orders.status(c, "Returnata", `retur ${r.id}`);
    else {
      this.notificari.tranzactionala(c, undefined, `Returul ${r.id} a fost aprobat`, `Am rambursat ${formatLei(suma)} pe card.`);
    }
    return r;
  }

  private sumaDeRambursat(c: Comanda, r: CerereRetur): Bani {
    let suma = 0;
    for (const l of r.linii) {
      const linie = c.linii.find((x) => x.codProdus === l.codProdus)!;
      const produs = this.central.produse.get(l.codProdus);
      suma += l.cantitate * (linie.pretUnitar + (produs?.areGarantieSGR ? SGR_PER_AMBALAJ : 0));
    }
    // returul întregii comenzi: se rambursează și livrarea standard (OUG 34/2014)
    if (this.totulReturnat(c, r)) suma += c.deviz.livrare;
    // niciodată mai mult decât s-a plătit și nu s-a rambursat deja
    return Math.min(suma, c.costTotal - this.orders.rambursatDeja(c));
  }

  private dejaReturnat(nrComanda: string, codProdus: string, exceptand?: CerereRetur): number {
    let n = 0;
    for (const r of this.cereri.values()) {
      if (r.nrComanda !== nrComanda || r === exceptand || r.status === "Respinsa") continue;
      for (const l of r.linii) if (l.codProdus === codProdus) n += l.cantitate;
    }
    return n;
  }

  /** Toate liniile livrate sunt returnate (incluzând, opțional, o cerere încă neînregistrată). */
  private totulReturnat(c: Comanda, cuCererea?: CerereRetur): boolean {
    return c.linii
      .filter((l) => !l.eliminata)
      .every((l) => {
        const inCerere = cuCererea?.linii.find((x) => x.codProdus === l.codProdus)?.cantitate ?? 0;
        return this.dejaReturnat(c.nrComanda, l.codProdus, cuCererea) + inCerere >= l.cantitate;
      });
  }

  private stare(r: CerereRetur, s: StatusRetur): void {
    r.status = s;
    r.istoric.push({ status: s, la: this.clock.now() });
  }
}
