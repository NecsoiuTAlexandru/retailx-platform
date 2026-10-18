/**
 * Serviciul Comenzi — finalizarea comenzii (diagrama de secvență, BRD cap. 8.3).
 *
 *  1–4  calculeazăCostTotal → clientul vede costul defalcat (US-03)
 *  5–8  plasează comanda → rezervă stocul 15 min (US-02)
 *  11   autorizează plata cu cheie de idempotență (US-04, NFR-02)
 *  12–16 plată autorizată → „Confirmată”, notificare
 *  17–20 plată refuzată → rezervarea se eliberează, coșul se păstrează, reîncercare
 *  21–24 stoc insuficient → clientul e anunțat ÎNAINTE de plată
 *
 * S3: intervalul de livrare / ridicare se verifică înainte de plată și se ocupă la confirmare (US-06).
 */
import type { Clock } from "../../core/clock.js";
import type { Bani } from "../../core/money.js";
import type { DomainBus } from "../../domain/events.js";
import type { Comanda, Deviz, StatusComanda, TipPrimire } from "../../domain/model.js";
import { schimbaStatus } from "../../domain/orderState.js";
import {
  ConexiuneIntreruptaError,
  type PaymentProcessorSimulator,
  type RezultatAutorizare,
} from "../../payments/paymentProcessor.js";
import type { CartService } from "../cart/cartService.js";
import type { Reducere, PricingService } from "../pricing/pricingService.js";
import type { StockService } from "../stock/stockService.js";
import type { SlotService } from "../fulfillment/slotService.js";
import { NegasitError } from "../../core/errors.js";

export class CosGolError extends Error {
  constructor() {
    super("Coșul este gol");
  }
}

/** Totalul s-a schimbat față de ce a văzut clientul: nu debităm, îi arătăm noul total (BR-04). */
export class TotalModificatError extends Error {
  constructor(public readonly devizNou: Deviz) {
    super("Costul total s-a modificat. Verifică noul total înainte de plată.");
  }
}

export class PlataRefuzataError extends Error {
  constructor(public readonly comanda: Comanda, motiv: string) {
    super(`Plata a fost refuzată: ${motiv}. Coșul tău s-a păstrat; poți reîncerca sau folosi alt card.`);
  }
}

export class DateLivrareLipsaError extends Error {
  constructor() {
    super("Pentru livrarea la domiciliu completează adresa");
  }
}

export interface CererePlata {
  tipPrimire: TipPrimire;
  /** Intervalul ales (US-06). */
  idInterval: string;
  /** Obligatorie pentru livrare la domiciliu. */
  adresa?: string;
  tokenCard: string;
  /** Totalul pe care l-a văzut clientul pe butonul „Plătește …”. */
  totalAfisat: Bani;
  /** Generată de client la deschiderea paginii de plată; aceeași la retrimitere. */
  cheieIdempotenta: string;
}

const MAX_REINCERCARI_RETEA = 3;

export class OrderService {
  private comenzi = new Map<string, Comanda>();
  /** cheie de idempotență a clientului → comanda creată cu ea */
  private dupaCheie = new Map<string, string>();
  /** coș → comanda în plată (o singură comandă deschisă pe coș) */
  private inPlata = new Map<string, string>();
  private next = 48213;
  /** Furnizorul de reduceri (cardul de fidelitate se leagă în S5). */
  reduceriPentru: (idCos: string) => Reducere[] = () => [];

  constructor(
    private readonly clock: Clock,
    private readonly cart: CartService,
    private readonly stock: StockService,
    private readonly pricing: PricingService,
    private readonly procesator: PaymentProcessorSimulator,
    private readonly slots: SlotService,
    private readonly bus: DomainBus,
  ) {}

  /** S7: anunță măsurarea KPI că s-a deschis finalizarea comenzii (începutul unei sesiuni). */
  laFinalizare: (idCos: string) => void = () => {};

  /** Pașii 1–4: costul total defalcat, afișat înainte de plată. */
  deviz(idCos: string, tipPrimire: TipPrimire): Deviz {
    const c = this.cart.get(idCos);
    if (c.linii.length) this.laFinalizare(idCos);
    return this.pricing.deviz(c.linii, tipPrimire, this.reduceriPentru(idCos));
  }

  get(nrComanda: string): Comanda | undefined {
    return this.comenzi.get(nrComanda);
  }

  toate(): Comanda[] {
    return [...this.comenzi.values()];
  }

  aleClientului(idClient: string): Comanda[] {
    return this.toate().filter((c) => c.idClient === idClient);
  }

  /** Pașii 5–24: plasarea comenzii și plata. */
  plaseaza(idCos: string, cerere: CererePlata): Comanda {
    // Retrimiterea aceleiași cereri (ex. dublu-click, reîncărcare) întoarce aceeași comandă.
    const dejaCreata = this.dupaCheie.get(cerere.cheieIdempotenta);
    if (dejaCreata) {
      const c = this.comenzi.get(dejaCreata)!;
      if (c.status !== "InPlata") return c;
    }

    const cos = this.cart.get(idCos);
    if (!cos.linii.length) throw new CosGolError();
    if (cerere.tipPrimire === "livrare" && !cerere.adresa?.trim()) throw new DateLivrareLipsaError();

    // US-06: intervalul plin nu poate fi ales
    const interval = this.slots.verifica(cerere.idInterval, cos.idMagazin, cerere.tipPrimire);

    const deviz = this.deviz(idCos, cerere.tipPrimire);
    if (deviz.total !== cerere.totalAfisat) throw new TotalModificatError(deviz);

    // Pasul 7: rezervare (aruncă StocInsuficientError → clientul e anunțat înainte de plată)
    if (!cos.rezervareId || !this.stock.esteValida(cos.rezervareId)) this.cart.rezerva(idCos);

    const comanda = this.comandaInPlata(idCos, cerere, deviz);
    this.dupaCheie.set(cerere.cheieIdempotenta, comanda.nrComanda);

    const incercare = comanda.plati.length + 1;
    const cheieProcesator = `${comanda.nrComanda}:${incercare}`;
    const rezultat = this.autorizeazaCuReincercare({
      suma: deviz.total,
      tokenCard: cerere.tokenCard,
      cheieIdempotenta: cheieProcesator,
      descriere: `Comanda ${comanda.nrComanda}`,
    });
    comanda.plati.push({
      suma: deviz.total,
      status: rezultat.status,
      cheieIdempotenta: cheieProcesator,
      idTranzactie: rezultat.idTranzactie,
      motiv: rezultat.motiv,
      la: this.clock.now(),
    });

    if (rezultat.status === "refuzata") {
      // Pașii 17–20: rezervarea se eliberează, coșul rămâne intact, comanda rămâne „În plată”.
      this.cart.elibereazaRezervarea(idCos);
      this.dupaCheie.delete(cerere.cheieIdempotenta);
      throw new PlataRefuzataError(comanda, rezultat.motiv ?? "motiv necunoscut");
    }

    // Pașii 12–16: confirmare
    this.stock.confirma(cos.rezervareId!, comanda.nrComanda);
    comanda.rezervareId = cos.rezervareId;
    comanda.primire =
      cerere.tipPrimire === "ridicare"
        ? { tip: "ridicare", idInterval: interval.id, interval: interval.eticheta, start: interval.start, sfarsit: interval.sfarsit }
        : { tip: "livrare", idInterval: interval.id, interval: interval.eticheta, start: interval.start, sfarsit: interval.sfarsit, adresa: cerere.adresa!.trim() };
    this.slots.ocupa(interval.id, comanda.nrComanda);
    comanda.dataConfirmarii = this.clock.now();
    this.inPlata.delete(idCos);
    this.cart.dupaComanda(idCos);
    this.status(comanda, "Confirmata");
    return comanda;
  }

  /** Schimbă statusul și anunță abonații (notificări, fidelitate, KPI). */
  status(c: Comanda, nou: StatusComanda, motiv?: string): void {
    schimbaStatus(c, nou, this.clock.now(), motiv, this.bus);
  }

  /** Rambursare pe plata autorizată a comenzii (totală sau parțială). */
  ramburseaza(c: Comanda, suma: Bani, motiv = "rambursare"): void {
    if (suma <= 0) return;
    const plata = c.plati.find((p) => p.status === "autorizata");
    if (!plata?.idTranzactie) throw new Error(`Comanda ${c.nrComanda} nu are o plată autorizată`);
    this.procesator.ramburseaza(plata.idTranzactie, suma);
    (c.rambursari ??= []).push({ suma, motiv, la: this.clock.now() });
  }

  /** Anulare (clientul anulează înainte de pregătire / comanda neridicată): rambursare integrală. */
  anuleaza(nrComanda: string, motiv: string): Comanda {
    const c = this.comenzi.get(nrComanda);
    if (!c) throw new NegasitError(`Comanda ${nrComanda} nu există`);
    this.status(c, "Anulata", motiv);
    if (c.rezervareId) this.stock.elibereaza(c.rezervareId);
    this.slots.elibereaza(nrComanda);
    this.ramburseaza(c, c.costTotal - this.rambursatDeja(c), motiv);
    return c;
  }

  rambursatDeja(c: Comanda): Bani {
    return c.rambursari?.reduce((s, r) => s + r.suma, 0) ?? 0;
  }

  /** O cădere de conexiune după 3-D Secure se reîncearcă cu ACEEAȘI cheie → o singură debitare. */
  private autorizeazaCuReincercare(c: Parameters<PaymentProcessorSimulator["autorizeaza"]>[0]): RezultatAutorizare {
    for (let i = 1; ; i++) {
      try {
        return this.procesator.autorizeaza(c);
      } catch (e) {
        if (!(e instanceof ConexiuneIntreruptaError) || i >= MAX_REINCERCARI_RETEA) throw e;
      }
    }
  }

  private comandaInPlata(idCos: string, cerere: CererePlata, deviz: Deviz): Comanda {
    const cos = this.cart.get(idCos);
    const existenta = this.inPlata.get(idCos);
    const linii = deviz.linii.map((l) => ({
      codProdus: l.codProdus,
      denumire: l.denumire,
      cantitate: l.cantitate,
      pretUnitar: l.pretUnitar,
      acceptaInlocuire: cos.acceptaInlocuire ?? false,
    }));
    if (existenta) {
      // reîncercare după refuz: actualizăm comanda deschisă, nu creăm alta
      const c = this.comenzi.get(existenta)!;
      Object.assign(c, {
        linii,
        deviz,
        costTotal: deviz.total,
        tipPrimire: cerere.tipPrimire,
        idMagazin: cos.idMagazin,
        puncteFolosite: cos.puncteFolosite,
      });
      return c;
    }
    const now = this.clock.now();
    const c: Comanda = {
      nrComanda: `RX-${this.next++}`,
      status: "InPlata",
      idCos,
      idClient: cos.idClient,
      idMagazin: cos.idMagazin,
      tipPrimire: cerere.tipPrimire,
      linii,
      deviz,
      costTotal: deviz.total,
      plati: [],
      puncteFolosite: cos.puncteFolosite,
      dataCrearii: now,
      istoric: [{ status: "InPlata", la: now }],
    };
    this.comenzi.set(c.nrComanda, c);
    this.inPlata.set(idCos, c.nrComanda);
    return c;
  }
}
