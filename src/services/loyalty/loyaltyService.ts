/**
 * Profil unic de client și card de fidelitate comun — US-08 / FR-08 (Should, 13 SP).
 *
 * Un singur profil și un singur card, aceleași în magazin, pe website și în aplicație
 * (clasa ProfilFidelitate: cel mult unul pe client). Reguli (ipoteze de validat cu Marketing):
 *  - 1 punct pentru fiecare leu întreg plătit, în orice canal;
 *  - online, punctele se acordă DOAR când comanda e „Onorată” (diagrama de stări), pe suma
 *    efectiv plătită (după rambursări);
 *  - 100 de puncte = 1 leu reducere, folosibile la comanda online;
 *  - niveluri: Bronz < 1.000 puncte, Argint < 5.000, Aur de la 5.000.
 * Date minime (DPIA cu DPO): profilul ține doar ce trebuie pentru card; recomandările
 * personalizate cer acordul separat „recomandări”.
 */
import type { Clock } from "../../core/clock.js";
import type { Bani } from "../../core/money.js";
import type { BonCasa, CentralSystemSimulator } from "../../central/centralSystem.js";
import type { DomainBus } from "../../domain/events.js";
import type { Comanda } from "../../domain/model.js";
import type { CartService } from "../cart/cartService.js";
import type { ConsentService } from "../consent/consentService.js";
import type { Reducere } from "../pricing/pricingService.js";

export const BANI_PE_PUNCT_CASTIGAT = 100; // 1 punct / leu
export const BANI_PE_PUNCT_FOLOSIT = 1; // 100 puncte = 1 leu

export type Nivel = "Bronz" | "Argint" | "Aur";

export interface MiscarePuncte {
  sursa: "magazin" | "online" | "folosire" | "restituire" | "retur";
  ref: string;
  puncte: number;
  la: number;
}

export interface ProfilFidelitate {
  idClient: string;
  nume: string;
  email: string;
  codCard: string;
  puncte: number;
  nivel: Nivel;
  istoric: MiscarePuncte[];
}

export class PuncteInsuficienteError extends Error {
  constructor(disponibile: number) {
    super(`Ai doar ${disponibile} puncte disponibile`);
  }
}

export const nivelPentru = (puncte: number): Nivel => (puncte >= 5000 ? "Aur" : puncte >= 1000 ? "Argint" : "Bronz");

export class LoyaltyService {
  private profile = new Map<string, ProfilFidelitate>();
  private dupaCard = new Map<string, string>();
  private nextCard = 29001234_5678;

  constructor(
    private readonly clock: Clock,
    bus: DomainBus,
    central: CentralSystemSimulator,
    private readonly cart: CartService,
    private readonly consent: ConsentService,
  ) {
    central.onBon((b) => this.bonMagazin(b));
    bus.on("comanda.status", ({ comanda, in: status }) => {
      if (!comanda.idClient || !this.profile.has(comanda.idClient)) return;
      if (status === "Confirmata" && comanda.puncteFolosite) this.misca(comanda.idClient, "folosire", comanda.nrComanda, -comanda.puncteFolosite);
      if (status === "Anulata" && comanda.puncteFolosite) this.misca(comanda.idClient, "restituire", comanda.nrComanda, comanda.puncteFolosite);
      if (status === "Onorata") this.misca(comanda.idClient, "online", comanda.nrComanda, this.puncteComanda(comanda));
    });
  }

  /** Clientul (din magazin sau online) își face cont: primește UN card, valabil peste tot. */
  inroleaza(idClient: string, nume: string, email: string, codCardExistent?: string): ProfilFidelitate {
    const existent = this.profile.get(idClient);
    if (existent) return existent;
    const codCard = codCardExistent ?? this.formateazaCard(this.nextCard++);
    const p: ProfilFidelitate = { idClient, nume, email, codCard, puncte: 0, nivel: "Bronz", istoric: [] };
    this.profile.set(idClient, p);
    this.dupaCard.set(codCard, idClient);
    return p;
  }

  profil(idClient: string): ProfilFidelitate | undefined {
    return this.profile.get(idClient);
  }

  /** Bon din magazin cu cardul scanat → puncte în același profil (TC-12). */
  private bonMagazin(b: BonCasa): void {
    const idClient = b.codCard ? this.dupaCard.get(b.codCard) : undefined;
    if (!idClient) return;
    this.misca(idClient, "magazin", b.nrBon, Math.floor(b.suma / BANI_PE_PUNCT_CASTIGAT));
  }

  puncteComanda(c: Comanda): number {
    const rambursat = c.rambursari?.reduce((s, r) => s + r.suma, 0) ?? 0;
    return Math.floor(Math.max(0, c.costTotal - rambursat) / BANI_PE_PUNCT_CASTIGAT);
  }

  /** Câte puncte ar primi clientul pentru coșul curent („Primești 147 de puncte”). */
  puncteEstimate(totalDeviz: Bani): number {
    return Math.floor(totalDeviz / BANI_PE_PUNCT_CASTIGAT);
  }

  /** Clientul alege să folosească puncte la comanda din coș. */
  folosestePuncte(idCos: string, puncte: number): void {
    const cos = this.cart.get(idCos);
    const p = cos.idClient ? this.profile.get(cos.idClient) : undefined;
    if (!p) throw new Error("Doar clienții cu card pot folosi puncte");
    if (puncte > p.puncte) throw new PuncteInsuficienteError(p.puncte);
    cos.puncteFolosite = puncte > 0 ? puncte : undefined;
  }

  /** Reducerile intră în costul total afișat înainte de plată (US-03). */
  reduceri(idCos: string): Reducere[] {
    const puncte = this.cart.get(idCos).puncteFolosite;
    return puncte ? [{ descriere: "Reducere card de fidelitate", suma: puncte * BANI_PE_PUNCT_FOLOSIT }] : [];
  }

  /** Retur (S6): punctele acordate pentru suma rambursată se retrag. */
  retrage(idClient: string, ref: string, sumaRambursata: Bani): void {
    if (!this.profile.has(idClient)) return;
    this.misca(idClient, "retur", ref, -Math.floor(sumaRambursata / BANI_PE_PUNCT_CASTIGAT));
  }

  /** Oferta de pe card: generală pentru toți; personalizată doar cu acordul „recomandări”. */
  oferta(idClient: string): { text: string; personalizata: boolean } {
    if (this.consent.are(idClient, "recomandari")) {
      return { text: "−15% la produsele lactate pe care le cumperi des", personalizata: true };
    }
    return { text: "−15% la fructe și legume, valabil în magazin și online", personalizata: false };
  }

  /** Dreptul de acces (art. 15 GDPR): tot ce știm despre client, într-un singur loc. */
  exportaDate(idClient: string) {
    return { profil: this.profile.get(idClient), consimtaminte: this.consent.ale(idClient) };
  }

  private misca(idClient: string, sursa: MiscarePuncte["sursa"], ref: string, puncte: number): void {
    const p = this.profile.get(idClient);
    if (!p || puncte === 0) return;
    p.puncte = Math.max(0, p.puncte + puncte);
    p.nivel = nivelPentru(p.puncte);
    p.istoric.push({ sursa, ref, puncte, la: this.clock.now() });
  }

  private formateazaCard(n: number): string {
    const s = String(n).padStart(12, "0");
    return `${s.slice(0, 4)} ${s.slice(4, 8)} ${s.slice(8)}`;
  }
}
