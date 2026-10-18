/**
 * Sprint 2 — „Costul total e clar și plata nu pierde coșul.”
 * US-03 (5 SP), US-04 (8 SP) + DEF-01 (retest TC-01b în s1-stoc-rezervare.test.ts).
 */
import { lei } from "../src/core/money.js";
import { CARDURI_TEST } from "../src/payments/paymentProcessor.js";
import { PlataRefuzataError, TotalModificatError } from "../src/services/orders/orderService.js";
import { StocInsuficientError } from "../src/services/stock/stockService.js";
import { platformaDeTest } from "./helpers.js";

/** Produse de test cu prețuri rotunde, ca sumele din BRD să iasă exact. */
function platformaCost() {
  return platformaDeTest((c) => {
    c.addProdus({ cod: "T-140", denumire: "Produs test 140 lei", pret: lei(140), areGarantieSGR: false });
    c.addProdus({ cod: "T-SGR", denumire: "Băutură test 2,50 lei", pret: lei(2.5), areGarantieSGR: true });
    c.addProdus({ cod: "T-19999", denumire: "Produs test 199,99 lei", pret: lei(199.99), areGarantieSGR: false });
    c.addProdus({ cod: "T-200", denumire: "Produs test 200 lei", pret: lei(200), areGarantieSGR: false });
    for (const cod of ["T-140", "T-SGR", "T-19999", "T-200"]) c.setStoc("PH-NORD", cod, 20);
  });
}

describe("US-03 · costul total înainte de plată", () => {
  it("TC-04 · coș 150 lei + livrare 15 lei + SGR 2 lei → plata arată 167 lei defalcat și se debitează 167 lei", () => {
    const { p } = platformaCost();
    p.cart.adauga("A", "T-140");
    p.cart.adauga("A", "T-SGR", 4); // 4 × 2,50 = 10 lei, 4 ambalaje SGR
    const d = p.orders.deviz("A", "livrare");
    expect(d).toMatchObject({ produse: lei(150), livrare: lei(15), garantieSGR: lei(2), ambalajeSGR: 4, total: lei(167) });

    const c = p.orders.plaseaza("A", { tipPrimire: "livrare", tokenCard: CARDURI_TEST.OK, totalAfisat: d.total, cheieIdempotenta: "k1" });
    expect(c.status).toBe("Confirmata");
    expect(p.procesator.debitari).toHaveLength(1);
    expect(p.procesator.debitari[0].suma).toBe(lei(167)); // suma afișată = suma debitată
  });

  it("TC-05 · taxa de livrare se aplică doar sub pragul de 200 lei", () => {
    const { p } = platformaCost();
    p.cart.adauga("sub", "T-19999");
    p.cart.adauga("prag", "T-200");
    expect(p.orders.deviz("sub", "livrare").livrare).toBe(lei(15));
    expect(p.orders.deviz("prag", "livrare").livrare).toBe(0);
  });

  it("ridicarea din magazin e gratuită", () => {
    const { p } = platformaCost();
    p.cart.adauga("A", "T-140");
    expect(p.orders.deviz("A", "ridicare").livrare).toBe(0);
  });

  it("dacă totalul s-a schimbat față de cel afișat, nu se debitează nimic (BR-04)", () => {
    const { p } = platformaCost();
    p.cart.adauga("A", "T-140");
    const vazut = p.orders.deviz("A", "ridicare").total;
    p.cart.adauga("A", "T-SGR"); // coșul s-a schimbat în alt tab
    expect(() =>
      p.orders.plaseaza("A", { tipPrimire: "ridicare", tokenCard: CARDURI_TEST.OK, totalAfisat: vazut, cheieIdempotenta: "k" }),
    ).toThrow(TotalModificatError);
    expect(p.procesator.debitari).toHaveLength(0);
  });
});

describe("US-04 · plata cu reîncercare, fără pierderea coșului și fără dublă debitare", () => {
  it("TC-06 · card cu fonduri insuficiente: comanda nu se confirmă, coșul rămâne, reîncercarea reușește", () => {
    const { p } = platformaCost();
    p.cart.adauga("A", "T-140");
    const total = p.orders.deviz("A", "ridicare").total;

    let refuz: PlataRefuzataError | undefined;
    try {
      p.orders.plaseaza("A", { tipPrimire: "ridicare", tokenCard: CARDURI_TEST.FONDURI_INSUFICIENTE, totalAfisat: total, cheieIdempotenta: "k1" });
    } catch (e) {
      refuz = e as PlataRefuzataError;
    }
    expect(refuz).toBeInstanceOf(PlataRefuzataError);
    expect(refuz!.comanda.status).toBe("InPlata");
    expect(p.cart.get("A").linii).toEqual([{ codProdus: "T-140", cantitate: 1 }]); // coș intact
    expect(p.cart.get("A").rezervareId).toBeUndefined(); // rezervarea s-a eliberat
    expect(p.procesator.debitari).toHaveLength(0);

    const c = p.orders.plaseaza("A", { tipPrimire: "ridicare", tokenCard: CARDURI_TEST.OK, totalAfisat: total, cheieIdempotenta: "k2" });
    expect(c.status).toBe("Confirmata");
    expect(c.nrComanda).toBe(refuz!.comanda.nrComanda); // aceeași comandă, a doua încercare
    expect(c.plati.map((x) => x.status)).toEqual(["refuzata", "autorizata"]);
    expect(p.procesator.debitari).toHaveLength(1);
  });

  it("TC-07 · conexiune întreruptă după 3-D Secure → o singură comandă și o singură debitare", () => {
    const { p } = platformaCost();
    p.cart.adauga("A", "T-140");
    const total = p.orders.deviz("A", "ridicare").total;
    p.procesator.intreruperiProgramate = 1; // procesatorul debitează, răspunsul se pierde

    const cerere = { tipPrimire: "ridicare" as const, tokenCard: CARDURI_TEST.OK, totalAfisat: total, cheieIdempotenta: "k1" };
    const c = p.orders.plaseaza("A", cerere);
    expect(c.status).toBe("Confirmata");

    // clientul apasă din nou „Plătește” (sau browserul retrimite cererea)
    const c2 = p.orders.plaseaza("A", cerere);
    expect(c2.nrComanda).toBe(c.nrComanda);
    expect(p.orders.toate()).toHaveLength(1);
    expect(p.procesator.debitari).toHaveLength(1);
    expect(p.procesator.totalDebitat()).toBe(total);
  });

  it("3-D Secure eșuat se tratează ca plată refuzată, cu coșul păstrat", () => {
    const { p } = platformaCost();
    p.cart.adauga("A", "T-140");
    const total = p.orders.deviz("A", "ridicare").total;
    expect(() =>
      p.orders.plaseaza("A", { tipPrimire: "ridicare", tokenCard: CARDURI_TEST.ESEC_3DS, totalAfisat: total, cheieIdempotenta: "k" }),
    ).toThrow(/3-D Secure/);
    expect(p.cart.get("A").linii).toHaveLength(1);
  });

  it("stoc insuficient: clientul e anunțat înainte de plată și nu se debitează nimic", () => {
    const { p } = platformaCost();
    p.cart.adauga("A", "T-140", 50);
    const total = p.orders.deviz("A", "ridicare").total;
    expect(() =>
      p.orders.plaseaza("A", { tipPrimire: "ridicare", tokenCard: CARDURI_TEST.OK, totalAfisat: total, cheieIdempotenta: "k" }),
    ).toThrow(StocInsuficientError);
    expect(p.procesator.debitari).toHaveLength(0);
    expect(p.orders.toate()).toHaveLength(0);
  });

  it("după confirmare, stocul rămâne alocat comenzii și nu expiră după 15 minute", () => {
    const { clock, p } = platformaCost();
    p.cart.adauga("A", "T-140", 18); // 20 fizic − 2 siguranță = 18
    const total = p.orders.deviz("A", "ridicare").total;
    const c = p.orders.plaseaza("A", { tipPrimire: "ridicare", tokenCard: CARDURI_TEST.OK, totalAfisat: total, cheieIdempotenta: "k" });
    clock.advance(20 * 60_000);
    p.central.heartbeat();
    clock.advance(1_000);
    expect(p.stock.rezervare(c.rezervareId!)).toBeDefined();
    expect(p.stock.disponibilitate("PH-NORD", "T-140").eticheta).toBe("indisponibil");
  });
});
