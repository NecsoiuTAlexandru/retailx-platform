/**
 * Sprint 4 — „Clientul e informat și comanda nu se anulează pentru un produs lipsă.”
 * US-07 (3 SP), US-09 (5 SP).
 */
import { lei } from "../src/core/money.js";
import { comandaPlatita, platformaDeTest } from "./helpers.js";

describe("US-07 · notificări de status (tranzacționale)", () => {
  it("TC-10 · client fără acord de marketing: doar notificări de status, în ordine, fără nicio ofertă", () => {
    const { p } = platformaDeTest();
    const cos = p.cart.autentifica(undefined, "ana").id;
    p.cart.adauga(cos, "100245", 2);
    const c = comandaPlatita(p, cos);
    p.picking.culege(c.nrComanda);
    const cod = c.primire!.tip === "ridicare" ? c.primire!.codRidicare! : "";
    p.fulfillment.ridica(c.nrComanda, cod);

    // o campanie încearcă să-i trimită o ofertă
    expect(p.notificari.marketing("ana", "−15% la lactate", "Ofertă săptămânală")).toBeNull();

    const primite = p.notificari.pentru("ana");
    expect(primite.map((n) => n.status)).toEqual(["Confirmata", "InPregatire", "GataDeRidicare", "Onorata"]);
    expect(primite.every((n) => n.tip === "tranzactionala")).toBe(true);
    expect(primite.some((n) => /ofert|reducere|%/i.test(n.text))).toBe(false);
    expect(primite[2].text).toContain(cod);
  });

  it("cu acord de marketing, oferta pleacă separat de notificările de status; retragerea acordului o oprește", () => {
    const { p } = platformaDeTest();
    p.consent.acorda("mihai", "marketing");
    expect(p.notificari.marketing("mihai", "−15% la fructe", "Valabil în magazin și online")).toMatchObject({ tip: "marketing" });
    p.consent.retrage("mihai", "marketing");
    expect(p.notificari.marketing("mihai", "−10% la pâine", "…")).toBeNull();
    expect(p.consent.jurnal).toHaveLength(2); // dovada acordului și a retragerii
  });

  it("livrarea: notificarea „a plecat spre tine” conține linkul de urmărire", () => {
    const { p } = platformaDeTest();
    p.cart.adauga("A", "100245");
    const c = comandaPlatita(p, "A", { tipPrimire: "livrare" });
    p.picking.culege(c.nrComanda);
    const n = p.notificari.aleComenzii(c.nrComanda).find((x) => x.status === "InLivrare")!;
    expect(n.text).toMatch(/https:\/\/curier\.example\/urmarire\/AWB/);
  });
});

describe("US-09 · înlocuirea produsului lipsă cu acordul clientului", () => {
  it("TC-11a · comandă de 10 produse, unul lipsă, clientul acceptă: înlocuitor mai ieftin și diferența rambursată", () => {
    const { p } = platformaDeTest();
    p.cart.seteazaInlocuire("A", true);
    p.cart.adauga("A", "100245", 4);
    p.cart.adauga("A", "100310", 5);
    p.cart.adauga("A", "100512", 1); // iaurt 400 g, 9,79 lei
    const c = comandaPlatita(p, "A");

    p.picking.culege(c.nrComanda, [{ codProdus: "100512", gasit: 0 }]);
    const iaurt = c.linii.find((l) => l.codProdus === "100512")!;
    expect(iaurt.inlocuire).toMatchObject({ codProdus: "100513", pretUnitar: lei(8.99), diferentaRambursata: lei(0.8) });
    expect(c.status).toBe("GataDeRidicare"); // nu „Anulată”
    expect(p.procesator.totalDebitat()).toBe(c.costTotal - lei(0.8));
    expect(p.notificari.aleComenzii(c.nrComanda).some((n) => n.titlu.includes("înlocuit"))).toBe(true);
  });

  /**
   * DEF-02 (majoră), găsit în S4: înlocuitorul putea fi mai scump decât produsul comandat.
   * Remediat în S5 (filtru de preț în propuneInlocuitor) — retest TC-11b trecut.
   */
  it("TC-11b · înlocuitorul nu poate fi mai scump; fără înlocuitor potrivit se elimină doar linia [retest DEF-02]", () => {
    const { p } = platformaDeTest();
    p.cart.seteazaInlocuire("A", true);
    p.cart.adauga("A", "100513", 1); // iaurt 380 g, 8,99 lei — singurul similar e cel de 9,79 lei
    p.cart.adauga("A", "100245", 1);
    const c = comandaPlatita(p, "A");

    p.picking.culege(c.nrComanda, [{ codProdus: "100513", gasit: 0 }]);
    const iaurt = c.linii.find((l) => l.codProdus === "100513")!;
    expect(iaurt.inlocuire).toBeUndefined();
    expect(iaurt.eliminata).toBe(true);
  });

  it("fără acordul clientului se elimină doar linia lipsă și se rambursează (cu garanția SGR)", () => {
    const { p } = platformaDeTest();
    p.cart.adauga("A", "100245", 2); // lapte cu SGR
    p.cart.adauga("A", "100720", 1);
    const c = comandaPlatita(p, "A");
    p.picking.culege(c.nrComanda, [{ codProdus: "100245", gasit: 0 }]);
    expect(c.linii.find((l) => l.codProdus === "100245")!.eliminata).toBe(true);
    expect(c.status).toBe("GataDeRidicare");
    expect(c.rambursari![0].suma).toBe(2 * (lei(8.49) + lei(0.5)));
  });

  it("dacă lipsește doar o parte din cantitate, se rambursează doar bucățile lipsă", () => {
    const { p } = platformaDeTest();
    p.cart.adauga("A", "100720", 3);
    const c = comandaPlatita(p, "A");
    p.picking.culege(c.nrComanda, [{ codProdus: "100720", gasit: 2 }]);
    expect(c.linii[0]).toMatchObject({ cantitate: 2 });
    expect(c.rambursari![0].suma).toBe(lei(5.49));
  });

  it("comanda se anulează integral doar dacă lipsesc toate produsele", () => {
    const { p } = platformaDeTest();
    p.cart.adauga("A", "100720", 1);
    const c = comandaPlatita(p, "A");
    p.picking.culege(c.nrComanda, [{ codProdus: "100720", gasit: 0 }]);
    expect(c.status).toBe("Anulata");
    expect(p.procesator.totalDebitat()).toBe(0);
  });
});
