/**
 * Sprint 3 — „Clientul comandă pe orice canal și alege cum primește.”
 * US-05 (5 SP), US-06 (8 SP).
 */
import { HOUR, MINUTE } from "../src/core/clock.js";
import { lei } from "../src/core/money.js";
import { idCosClient } from "../src/services/cart/cartService.js";
import { IntervalIndisponibilError } from "../src/services/fulfillment/slotService.js";
import { CodRidicareGresitError } from "../src/services/fulfillment/fulfillmentService.js";
import { cererePlata, comandaPlatita, platformaDeTest, treceTimp } from "./helpers.js";

describe("US-05 · coș comun între website și aplicație", () => {
  it("TC-08 · coș de 5 produse pe website, deschis în aplicație: același coș, cu prețul și stocul reverificate", () => {
    const { clock, p } = platformaDeTest();
    const cos = p.cart.autentifica(undefined, "ana").id;
    for (const cod of ["100245", "100310", "100512", "100720", "200871"]) p.cart.adauga(cos, cod, 1, "website");

    // între timp: o promoție schimbă prețul apei, iar la casă se vând fierbătoarele
    p.central.schimbaPret("100310", lei(2.99));
    p.central.vindeLaCasa("PH-NORD", "200871", 2); // 4 − 2 = 2 fizic, 0 vandabile online
    treceTimp(clock, p, MINUTE);

    const { cos: inAplicatie, verificare } = p.cart.deschide("ana", "aplicatie");
    expect(inAplicatie.id).toBe(cos);
    expect(inAplicatie.linii.map((l) => l.codProdus)).toEqual(["100245", "100310", "100512", "100720", "200871"]);

    const apa = verificare.find((v) => v.codProdus === "100310")!;
    expect(apa).toMatchObject({ pretModificat: true, pretLaAdaugare: lei(3.2), pretCurent: lei(2.99) });
    const fierbator = verificare.find((v) => v.codProdus === "200871")!;
    expect(fierbator).toMatchObject({ eticheta: "indisponibil", stocInsuficient: true });
    expect(verificare.filter((v) => !v.pretModificat && !v.stocInsuficient)).toHaveLength(3);

    // costul total folosește prețul curent, nu pe cel de la adăugare
    expect(p.orders.deviz(cos, "ridicare").linii.find((l) => l.codProdus === "100310")!.pretUnitar).toBe(lei(2.99));
  });

  it("coșul început fără cont se păstrează la autentificare", () => {
    const { p } = platformaDeTest();
    p.cart.setMagazin("anonim-1", "PH-SUD");
    p.cart.adauga("anonim-1", "100245", 2);
    const c = p.cart.autentifica("anonim-1", "mihai");
    expect(c.id).toBe(idCosClient("mihai"));
    expect(c.idMagazin).toBe("PH-SUD");
    expect(c.linii).toMatchObject([{ codProdus: "100245", cantitate: 2 }]);
  });
});

describe("US-06 · livrare la domiciliu sau ridicare din magazin, într-un interval disponibil", () => {
  it("TC-09 · intervalul plin nu se poate alege; în intervalul liber primești cod de ridicare; după ridicare comanda e „onorată”", () => {
    const { p } = platformaDeTest(undefined, { capacitateIntervale: { ridicare: 1, livrare: 1 } });
    const [primul, alDoilea] = p.slots.intervale("PH-NORD", "ridicare");

    p.cart.adauga("A", "100245");
    comandaPlatita(p, "A", { idInterval: primul.id }); // umple primul interval (capacitate 1)

    expect(p.slots.intervale("PH-NORD", "ridicare")[0]).toMatchObject({ id: primul.id, plin: true });
    p.cart.adauga("B", "100245");
    expect(() => p.orders.plaseaza("B", cererePlata(p, "B", { idInterval: primul.id }))).toThrow(IntervalIndisponibilError);
    expect(p.procesator.debitari).toHaveLength(1); // nu s-a debitat nimic pentru B

    const b = comandaPlatita(p, "B", { idInterval: alDoilea.id });
    expect(b.primire).toMatchObject({ tip: "ridicare", idInterval: alDoilea.id });

    p.fulfillment.incepePregatirea(b.nrComanda);
    p.fulfillment.finalizeazaPregatirea(b.nrComanda);
    expect(b.status).toBe("GataDeRidicare");
    const primire = b.primire!;
    const cod = primire.tip === "ridicare" ? primire.codRidicare! : "";
    expect(cod).toMatch(/^\d{4}$/);

    expect(() => p.fulfillment.ridica(b.nrComanda, "0000")).toThrow(CodRidicareGresitError);
    p.fulfillment.ridica(b.nrComanda, cod);
    expect(b.status).toBe("Onorata");
  });

  it("intervalele încep după timpul minim de pregătire de 2 ore", () => {
    const { clock, p } = platformaDeTest();
    const primul = p.slots.intervale("PH-NORD", "ridicare")[0];
    expect(primul.start - clock.now()).toBeGreaterThanOrEqual(2 * HOUR);
  });

  it("magazinul fără ridicare nu oferă intervale de ridicare", () => {
    const { p } = platformaDeTest();
    expect(p.slots.intervale("CAMPINA", "ridicare")).toEqual([]);
    expect(p.slots.intervale("CAMPINA", "livrare").length).toBeGreaterThan(0);
  });

  it("livrarea la domiciliu: predare la curier cu AWB și link de urmărire, apoi „onorată”", () => {
    const { p } = platformaDeTest();
    p.cart.adauga("A", "100245");
    const c = comandaPlatita(p, "A", { tipPrimire: "livrare" });
    p.fulfillment.incepePregatirea(c.nrComanda);
    p.fulfillment.finalizeazaPregatirea(c.nrComanda);
    expect(c.status).toBe("InLivrare");
    expect(c.primire).toMatchObject({ tip: "livrare", awbCurier: expect.stringMatching(/^AWB/), linkUrmarire: expect.any(String) });
    p.fulfillment.confirmaLivrarea(c.nrComanda);
    expect(c.status).toBe("Onorata");
  });

  it("comanda neridicată în 48 h se anulează și se rambursează integral", () => {
    const { clock, p } = platformaDeTest();
    p.cart.adauga("A", "100245");
    const c = comandaPlatita(p, "A");
    p.fulfillment.incepePregatirea(c.nrComanda);
    p.fulfillment.finalizeazaPregatirea(c.nrComanda);
    clock.advance(48 * HOUR);
    p.fulfillment.verificaNeridicate();
    expect(c.status).toBe("Anulata");
    expect(p.procesator.totalDebitat()).toBe(0);
  });

  it("după culegere, produsele ies din stoc și alocarea se eliberează fără să reapară online", () => {
    const { clock, p } = platformaDeTest();
    p.cart.adauga("A", "200871", 2); // PH-NORD: 4 fizic → 2 vandabile
    const c = comandaPlatita(p, "A");
    expect(p.stock.disponibilitate("PH-NORD", "200871").disponibil).toBe(0);
    p.fulfillment.incepePregatirea(c.nrComanda);
    p.fulfillment.finalizeazaPregatirea(c.nrComanda);
    expect(p.stock.disponibilitate("PH-NORD", "200871").disponibil).toBe(0); // încă alocat
    clock.advance(1_000);
    expect(p.stock.disponibilitate("PH-NORD", "200871").disponibil).toBe(0); // ieșit din stoc
    expect(p.central.stocReal("PH-NORD", "200871")).toBe(2);
  });
});
