/**
 * Serviciul Comenzi — finalizarea comenzii (diagrama de secvență, BRD cap. 8.3).
 *
 *  1–4  calculeazăCostTotal → clientul vede costul defalcat (US-03)
 *  5–8  plasează comanda → rezervă stocul 15 min (US-02)
 *  11   autorizează plata cu cheie de idempotență (US-04, NFR-02)
 *  12–16 plată autorizată → „Confirmată”, notificare
 *  17–20 plată refuzată → rezervarea se eliberează, coșul se păstrează, reîncercare
 *  21–24 stoc insuficient → clientul e anunțat ÎNAINTE de plată
 */
import type { Clock } from "../../core/clock.js";
import type { Bani } from "../../core/money.js";
import type { Comanda, Deviz, TipPrimire } from "../../domain/model.js";
import { schimbaStatus } from "../../domain/orderState.js";
import {
  ConexiuneIntreruptaError,
  type PaymentProcessorSimulator,
  type RezultatAutorizare,
} from "../../payments/paymentProcessor.js";
import type { CartService } from "../cart/cartService.js";
import type { PricingService } from "../pricing/pricingService.js";
import type { StockService } from "../stock/stockService.js";

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

export interface CererePlata {
  tipPrimire: TipPrimire;
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

  constructor(
    private readonly clock: Clock,
    private readonly cart: CartService,
    private readonly stock: StockService,
    private readonly pricing: PricingService,
    private readonly procesator: PaymentProcessorSimulator,
  ) {}

  /** Pașii 1–4: costul total defalcat, afișat înainte de plată. */
  deviz(idCos: string, tipPrimire: TipPrimire): Deviz {
    const c = this.cart.get(idCos);
    return this.pricing.deviz(c.linii, tipPrimire, this.reduceri(idCos));
  }

  /** Punct de extensie pentru reduceri (cardul de fidelitate se leagă în S5). */
  protected reduceri(_idCos: string) {
    return [];
  }

  get(nrComanda: string): Comanda | undefined {
    return this.comenzi.get(nrComanda);
  }

  toate(): Comanda[] {
    return [...this.comenzi.values()];
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
    comanda.dataConfirmarii = this.clock.now();
    schimbaStatus(comanda, "Confirmata", this.clock.now());
    this.inPlata.delete(idCos);
    this.cart.dupaComanda(idCos);
    this.dupaConfirmare(comanda);
    return comanda;
  }

  /** Punct de extensie: notificarea „comandă confirmată” (S4) și evenimentele KPI (S7). */
  protected dupaConfirmare(_c: Comanda): void {}

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
      acceptaInlocuire: false,
    }));
    if (existenta) {
      // reîncercare după refuz: actualizăm comanda deschisă, nu creăm alta
      const c = this.comenzi.get(existenta)!;
      Object.assign(c, { linii, deviz, costTotal: deviz.total, tipPrimire: cerere.tipPrimire, idMagazin: cos.idMagazin });
      return c;
    }
    const now = this.clock.now();
    const c: Comanda = {
      nrComanda: `RX-${this.next++}`,
      status: "InPlata",
      idCos,
      idMagazin: cos.idMagazin,
      tipPrimire: cerere.tipPrimire,
      linii,
      deviz,
      costTotal: deviz.total,
      plati: [],
      dataCrearii: now,
      istoric: [{ status: "InPlata", la: now }],
    };
    this.comenzi.set(c.nrComanda, c);
    this.inPlata.set(idCos, c.nrComanda);
    return c;
  }
}
