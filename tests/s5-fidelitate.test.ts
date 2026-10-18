/**
 * Sprint 5 — „Un singur card de fidelitate în toate canalele.”
 * US-08 (13 SP) + DEF-02 (retest TC-11b în s4-notificari-inlocuire.test.ts).
 */
import { lei } from "../src/core/money.js";
import { PuncteInsuficienteError } from "../src/services/loyalty/loyaltyService.js";
import { cererePlata, comandaPlatita, platformaDeTest } from "./helpers.js";

function clientCuCard() {
  const t = platformaDeTest();
  const profil = t.p.fidelitate.inroleaza("andrei", "Andrei P.", "andrei@example.ro");
  const cos = t.p.cart.autentifica(undefined, "andrei").id;
  return { ...t, profil, cos };
}

function ridica(p: ReturnType<typeof platformaDeTest>["p"], nr: string) {
  p.picking.culege(nr);
  const c = p.orders.get(nr)!;
  p.fulfillment.ridica(nr, c.primire!.tip === "ridicare" ? c.primire!.codRidicare! : "");
}

describe("US-08 · profil unic și card de fidelitate comun", () => {
  it("TC-12 · cumpărătură în magazin cu cardul, apoi online → punctele din ambele în același profil", () => {
    const { p, profil, cos } = clientCuCard();

    p.central.emiteBon("PH-NORD", lei(86.4), profil.codCard); // la casă, cu cardul scanat
    p.cart.adauga(cos, "200871"); // 119,99 lei
    p.cart.adauga(cos, "100310", 9); // 28,80 lei + 4,50 SGR
    const c = comandaPlatita(p, cos);
    ridica(p, c.nrComanda);

    const dupa = p.fidelitate.profil("andrei")!;
    expect(dupa.istoric.map((m) => m.sursa)).toEqual(["magazin", "online"]);
    expect(dupa.puncte).toBe(86 + Math.floor(c.costTotal / 100));
    expect(dupa.codCard).toBe(profil.codCard); // același card
  });

  it("online, punctele se acordă doar când comanda e „Onorată”, nu la confirmare", () => {
    const { p, cos } = clientCuCard();
    p.cart.adauga(cos, "200871");
    const c = comandaPlatita(p, cos);
    expect(p.fidelitate.profil("andrei")!.puncte).toBe(0);
    ridica(p, c.nrComanda);
    expect(p.fidelitate.profil("andrei")!.puncte).toBe(119);
  });

  it("punctele folosite apar ca reducere în costul total și se restituie dacă comanda se anulează", () => {
    const { p, profil, cos } = clientCuCard();
    p.central.emiteBon("PH-NORD", lei(600), profil.codCard); // 600 puncte
    p.cart.adauga(cos, "200871");
    p.fidelitate.folosestePuncte(cos, 500);

    const d = p.orders.deviz(cos, "ridicare");
    expect(d.reduceri).toEqual([{ descriere: "Reducere card de fidelitate", suma: lei(5) }]);
    expect(d.total).toBe(lei(119.99) - lei(5));

    const c = p.orders.plaseaza(cos, cererePlata(p, cos));
    expect(p.fidelitate.profil("andrei")!.puncte).toBe(100);
    p.orders.anuleaza(c.nrComanda, "clientul a anulat înainte de pregătire");
    expect(p.fidelitate.profil("andrei")!.puncte).toBe(600);
  });

  it("nu se pot folosi mai multe puncte decât are clientul", () => {
    const { p, cos } = clientCuCard();
    p.cart.adauga(cos, "200871");
    expect(() => p.fidelitate.folosestePuncte(cos, 100)).toThrow(PuncteInsuficienteError);
  });

  it("nivelul cardului crește cu punctele (Argint de la 1.000)", () => {
    const { p, profil } = clientCuCard();
    p.central.emiteBon("PH-SUD", lei(1240), profil.codCard);
    expect(p.fidelitate.profil("andrei")).toMatchObject({ puncte: 1240, nivel: "Argint" });
  });

  it("oferta personalizată apare doar cu acordul „recomandări” (BR-05)", () => {
    const { p } = clientCuCard();
    expect(p.fidelitate.oferta("andrei").personalizata).toBe(false);
    p.consent.acorda("andrei", "recomandari");
    expect(p.fidelitate.oferta("andrei").personalizata).toBe(true);
  });

  it("bonul fără card nu atribuie puncte nimănui", () => {
    const { p } = clientCuCard();
    p.central.emiteBon("PH-NORD", lei(50));
    expect(p.fidelitate.profil("andrei")!.puncte).toBe(0);
  });
});
