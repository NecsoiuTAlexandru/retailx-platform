/**
 * Sprint 1 — „Clientul vede stocul real și produsul i se rezervă la plată”.
 * US-01 (8 SP), US-02 (5 SP). Cazurile de test din BRD, cap. 9.3 și 9.4.
 */
import { MINUTE, SECOND } from "../src/core/clock.js";
import { StocInsuficientError } from "../src/services/stock/stockService.js";
import { platformaDeTest, platformaLaScara, treceTimp } from "./helpers.js";

describe("US-01 · stocul verificat", () => {
  it("TC-01a · produs cu 3 bucăți vândute la casă apare „indisponibil” online în ≤ 5 minute", () => {
    const { clock, p } = platformaDeTest((c) => c.setStoc("PH-NORD", "100245", 3));
    expect(p.stock.disponibilitate("PH-NORD", "100245").eticheta).toBe("in_stoc");

    p.central.vindeLaCasa("PH-NORD", "100245", 3);
    clock.advance(5 * MINUTE);
    expect(p.stock.disponibilitate("PH-NORD", "100245").eticheta).toBe("indisponibil");
  });

  /**
   * DEF-01 (majoră): la vârf, toate magazinele trimit vânzările deodată; procesarea secvențială
   * a evenimentelor ține stocul online în urmă ~12 minute. Testul e marcat „fails” în S1
   * și se reia în S2 după remediere (decizia PO la Sprint Review, 12 martie 2027).
   */
  it.fails("TC-01b · la vârf, pe 120 de magazine, actualizarea rămâne în ≤ 5 minute [DEF-01]", () => {
    const { clock, p } = platformaLaScara(120);
    const tinta = "M120";
    // 10 runde: în fiecare rundă fiecare magazin trimite o vânzare; ultima e vânzarea țintă.
    for (let runda = 0; runda < 10; runda++) {
      for (let i = 1; i <= 120; i++) {
        const id = `M${String(i).padStart(3, "0")}`;
        if (runda === 9 && id === tinta) p.central.vindeLaCasa(id, "P-TEST", 3);
        else p.central.vindeLaCasa(id, `F-${runda % 9}`, 1);
      }
    }
    let intarziere = 0;
    while (p.stock.disponibilitate(tinta, "P-TEST").eticheta !== "indisponibil" && intarziere < 20 * MINUTE) {
      clock.advance(30 * SECOND);
      intarziere += 30 * SECOND;
    }
    expect(intarziere).toBeLessThanOrEqual(5 * MINUTE);
  });

  it("TC-02 · sincronizarea oprită 10 minute → „disponibilitate neconfirmată”, nu „în stoc”", () => {
    const { clock, p } = platformaDeTest();
    p.central.setOnline(false);
    clock.advance(10 * MINUTE);
    p.central.heartbeat(); // offline: nu ajunge nimic
    const d = p.stock.disponibilitate("PH-NORD", "100245");
    expect(d.eticheta).toBe("neconfirmat");
    expect(d.disponibil).toBeNull();
  });

  it("heartbeat-ul de la sistemul central menține stocul confirmat", () => {
    const { clock, p } = platformaDeTest();
    treceTimp(clock, p, 10 * MINUTE);
    expect(p.stock.disponibilitate("PH-NORD", "100245").eticheta).toBe("in_stoc");
  });

  it("stocul de siguranță de 2 bucăți nu se vinde online", () => {
    const { p } = platformaDeTest();
    // PH-NORD are 14 bucăți de lapte → 12 vandabile online
    expect(p.stock.disponibilitate("PH-NORD", "100245").disponibil).toBe(12);
  });
});

describe("US-02 · rezervarea la plată", () => {
  function ultimaBucata() {
    // 3 fizic − 2 siguranță = ultima bucată online
    const { clock, p } = platformaDeTest((c) => c.setStoc("PH-NORD", "200871", 3));
    p.cart.adauga("A", "200871");
    p.cart.adauga("B", "200871");
    return { clock, p };
  }

  it("TC-03a · doi clienți, ultima bucată: rezervare pentru primul, al doilea e anunțat înainte de plată", () => {
    const { p } = ultimaBucata();
    const r = p.cart.rezerva("A");
    expect(r.linii).toEqual([{ codProdus: "200871", cantitate: 1 }]);
    expect(() => p.cart.rezerva("B")).toThrow(StocInsuficientError);
    expect(p.stock.disponibilitate("PH-NORD", "200871").eticheta).toBe("indisponibil");
  });

  it("TC-03b · clientul nu plătește în 15 minute → rezervarea expiră", () => {
    const { clock, p } = ultimaBucata();
    const r = p.cart.rezerva("A");
    treceTimp(clock, p, 14 * MINUTE - 2 * SECOND);
    expect(p.stock.rezervare(r.id)).toBeDefined();
    treceTimp(clock, p, MINUTE);
    expect(p.stock.rezervare(r.id)).toBeUndefined();
    expect(() => p.cart.rezerva("B")).not.toThrow();
  });

  it("TC-03c · clientul golește coșul după inițierea plății → rezervarea se anulează imediat", () => {
    const { p } = ultimaBucata();
    const r = p.cart.rezerva("A");
    p.cart.goleste("A");
    expect(p.stock.rezervare(r.id)).toBeUndefined();
    expect(p.stock.disponibilitate("PH-NORD", "200871").disponibil).toBe(1);
  });

  it("nu se rezervă pe stoc neconfirmat (BR-04)", () => {
    const { clock, p } = platformaDeTest();
    p.central.setOnline(false);
    clock.advance(6 * MINUTE);
    p.cart.adauga("A", "100245");
    expect(() => p.cart.rezerva("A")).toThrow(StocInsuficientError);
  });
});
