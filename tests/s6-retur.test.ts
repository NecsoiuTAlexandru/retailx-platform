/**
 * Sprint 6 — „Clientul face retur din cont.” US-10 (8 SP) + testul end-to-end omnichannel.
 */
import { DAY, MINUTE } from "../src/core/clock.js";
import { lei } from "../src/core/money.js";
import { ReturRefuzatError } from "../src/services/returns/returnService.js";
import { cererePlata, comandaPlatita, platformaDeTest, treceTimp } from "./helpers.js";

type P = ReturnType<typeof platformaDeTest>["p"];

function comandaOnorata(p: P, idClient: string, produse: [string, number][], tipPrimire: "ridicare" | "livrare" = "ridicare") {
  const cos = p.cart.autentifica(undefined, idClient).id;
  for (const [cod, q] of produse) p.cart.adauga(cos, cod, q);
  const c = comandaPlatita(p, cos, { tipPrimire });
  p.picking.culege(c.nrComanda);
  if (c.primire!.tip === "ridicare") p.fulfillment.ridica(c.nrComanda, c.primire!.codRidicare!);
  else p.fulfillment.confirmaLivrarea(c.nrComanda);
  return c;
}

describe("US-10 · retur și rambursare din cont", () => {
  it("TC-13 · retur pentru un produs deteriorat, cu fotografie: număr de cerere, status vizibil, rambursare în termen", () => {
    const { clock, p } = platformaDeTest();
    p.fidelitate.inroleaza("andrei", "Andrei P.", "andrei@example.ro");
    const c = comandaOnorata(p, "andrei", [["200871", 1], ["100720", 2]]);
    const puncteInainte = p.fidelitate.profil("andrei")!.puncte;

    const r = p.retururi.cere("andrei", c.nrComanda, [{ codProdus: "200871", cantitate: 1 }], "deteriorat", "magazin", "foto-fierbator.jpg");
    expect(r.id).toMatch(/^RT-\d+$/);
    expect(r.status).toBe("Inregistrata");
    expect(r.termenRambursare - r.creata).toBe(14 * DAY);
    expect(p.retururi.aleClientului("andrei")).toHaveLength(1); // vizibil în cont

    clock.advance(2 * DAY);
    p.retururi.primesteProdusul(r.id);
    expect(r.status).toBe("Rambursata");
    expect(r.sumaRambursata).toBe(lei(119.99));
    expect(clock.now()).toBeLessThanOrEqual(r.termenRambursare);
    expect(p.procesator.totalDebitat()).toBe(c.costTotal - lei(119.99));
    expect(c.status).toBe("Onorata"); // retur parțial: comanda rămâne onorată
    expect(p.fidelitate.profil("andrei")!.puncte).toBe(puncteInainte - 119);
  });

  it("returul întregii comenzi livrate: comanda devine „Returnată” și se rambursează și livrarea", () => {
    const { p } = platformaDeTest();
    const c = comandaOnorata(p, "ana", [["200871", 1]], "livrare");
    expect(c.deviz.livrare).toBe(lei(15));
    const r = p.retururi.cere("ana", c.nrComanda, [{ codProdus: "200871", cantitate: 1 }], "razgandire", "curier");
    expect(r.awbRetur).toMatch(/^AWB/);
    p.retururi.primesteProdusul(r.id);
    expect(r.sumaRambursata).toBe(c.costTotal);
    expect(c.status).toBe("Returnata");
    expect(p.procesator.totalDebitat()).toBe(0);
  });

  it("produsele perisabile nu se returnează din răzgândire, doar dacă sunt deteriorate", () => {
    const { p } = platformaDeTest();
    const c = comandaOnorata(p, "ana", [["100245", 2]]);
    expect(() => p.retururi.cere("ana", c.nrComanda, [{ codProdus: "100245", cantitate: 1 }], "razgandire")).toThrow(/perisabil/);
    const r = p.retururi.cere("ana", c.nrComanda, [{ codProdus: "100245", cantitate: 1 }], "deteriorat");
    p.retururi.primesteProdusul(r.id);
    expect(r.sumaRambursata).toBe(lei(8.49) + lei(0.5)); // preț + garanția SGR
  });

  it("după 14 zile de la predare returul nu mai poate fi cerut", () => {
    const { clock, p } = platformaDeTest();
    const c = comandaOnorata(p, "ana", [["200871", 1]]);
    clock.advance(15 * DAY);
    expect(() => p.retururi.cere("ana", c.nrComanda, [{ codProdus: "200871", cantitate: 1 }], "razgandire")).toThrow(/14 zile/);
  });

  it("nu se poate returna mai mult decât s-a primit, nici comanda altui client", () => {
    const { p } = platformaDeTest();
    const c = comandaOnorata(p, "ana", [["100720", 2]]);
    expect(() => p.retururi.cere("mihai", c.nrComanda, [{ codProdus: "100720", cantitate: 1 }], "deteriorat")).toThrow(ReturRefuzatError);
    p.retururi.cere("ana", c.nrComanda, [{ codProdus: "100720", cantitate: 2 }], "deteriorat");
    expect(() => p.retururi.cere("ana", c.nrComanda, [{ codProdus: "100720", cantitate: 1 }], "deteriorat")).toThrow(/cel mult 0/);
  });
});

describe("End-to-end omnichannel (S6)", () => {
  it("căutare → disponibilitate → comandă și plată → culegere cu înlocuire → ridicare → puncte → retur", () => {
    const { clock, p } = platformaDeTest();
    p.fidelitate.inroleaza("ana", "Ana P.", "ana@example.ro");

    // 1. Ana vede pe website stocul confirmat în magazinul ales
    const d = p.stock.disponibilitate("PH-NORD", "100512");
    expect(d.eticheta).toBe("in_stoc");

    // 2. începe coșul pe website, îl termină în aplicație
    const cos = p.cart.autentifica("web-tmp", "ana").id;
    p.cart.adauga(cos, "100512", 1, "website");
    p.cart.adauga(cos, "100310", 4, "website");
    p.cart.adauga(cos, "200871", 1, "website");
    p.cart.seteazaInlocuire(cos, true);
    expect(p.cart.deschide("ana", "aplicatie").cos.linii).toHaveLength(3);

    // 3. costul total înainte de plată = suma debitată
    const cerere = cererePlata(p, cos);
    const c = p.orders.plaseaza(cos, cerere);
    expect(p.procesator.debitari[0].suma).toBe(cerere.totalAfisat);

    // 4. la culegere iaurtul de 400 g lipsește → înlocuitor mai ieftin, diferența rambursată
    treceTimp(clock, p, 30 * MINUTE);
    p.picking.culege(c.nrComanda, [{ codProdus: "100512", gasit: 0 }]);
    expect(c.linii[0].inlocuire?.codProdus).toBe("100513");

    // 5. ridicare cu cod → „Onorată” → puncte în același profil
    p.fulfillment.ridica(c.nrComanda, c.primire!.tip === "ridicare" ? c.primire!.codRidicare! : "");
    expect(c.status).toBe("Onorata");
    expect(p.fidelitate.profil("ana")!.puncte).toBe(Math.floor((c.costTotal - lei(0.8)) / 100));

    // 6. notificările au mers în ordine, fără apel la call center
    expect(p.notificari.aleComenzii(c.nrComanda).map((n) => n.status ?? "inlocuire")).toEqual([
      "Confirmata", "InPregatire", "inlocuire", "GataDeRidicare", "Onorata",
    ]);

    // 7. retur din cont pentru fierbător
    const r = p.retururi.cere("ana", c.nrComanda, [{ codProdus: "200871", cantitate: 1 }], "deteriorat");
    p.retururi.primesteProdusul(r.id);
    expect(p.procesator.totalDebitat()).toBe(c.costTotal - lei(0.8) - lei(119.99));
  });
});
