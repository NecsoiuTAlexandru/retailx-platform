/**
 * Serviciul Notificări — US-07 / FR-07, NFR-03.
 *
 * Clientul primește o notificare (push + e-mail) pentru fiecare schimbare de status, în ordinea
 * din ciclul de viață al comenzii, ca să nu mai sune la call center.
 * Notificările despre comandă sunt TRANZACȚIONALE: nu conțin oferte. Mesajele de marketing
 * pleacă pe un canal separat și doar cu acordul de marketing al clientului.
 */
import type { Clock } from "../../core/clock.js";
import { formatLei } from "../../core/money.js";
import type { DomainBus } from "../../domain/events.js";
import type { Comanda, StatusComanda } from "../../domain/model.js";
import type { ConsentService } from "../consent/consentService.js";

export type TipNotificare = "tranzactionala" | "marketing";

export interface Notificare {
  id: number;
  destinatar: string;
  canale: ("push" | "email")[];
  tip: TipNotificare;
  nrComanda?: string;
  status?: StatusComanda;
  titlu: string;
  text: string;
  la: number;
}

const MESAJE: Partial<Record<StatusComanda, (c: Comanda) => { titlu: string; text: string }>> = {
  Confirmata: (c) => ({
    titlu: `Comanda ${c.nrComanda} a fost confirmată`,
    text: `Am primit plata de ${formatLei(c.costTotal)}. ${c.primire ? `Interval: ${c.primire.interval}.` : ""}`,
  }),
  InPregatire: (c) => ({ titlu: "Comanda e în pregătire", text: `Colegii noștri culeg produsele pentru comanda ${c.nrComanda}.` }),
  GataDeRidicare: (c) => ({
    titlu: "Comanda e gata de ridicare",
    text: `Arată codul ${c.primire?.tip === "ridicare" ? c.primire.codRidicare : ""} la casa „Comenzi online” sau scanează cardul de fidelitate.`,
  }),
  InLivrare: (c) => ({
    titlu: "Comanda a plecat spre tine",
    text: `Urmărește livrarea: ${c.primire?.tip === "livrare" ? c.primire.linkUrmarire : ""}`,
  }),
  Onorata: (c) => ({ titlu: "Comanda a fost predată", text: `Mulțumim! Comanda ${c.nrComanda} a fost ${c.tipPrimire === "ridicare" ? "ridicată" : "livrată"}.` }),
  Anulata: (c) => ({ titlu: "Comanda a fost anulată", text: `Comanda ${c.nrComanda} a fost anulată. Suma plătită se rambursează pe card.` }),
  Returnata: (c) => ({ titlu: "Returul a fost aprobat", text: `Rambursarea pentru comanda ${c.nrComanda} a fost inițiată.` }),
};

export class NotificationService {
  readonly trimise: Notificare[] = [];
  private next = 1;

  constructor(
    private readonly clock: Clock,
    bus: DomainBus,
    private readonly consent: ConsentService,
  ) {
    bus.on("comanda.status", ({ comanda, in: status }) => {
      const m = MESAJE[status]?.(comanda);
      if (m) this.tranzactionala(comanda, status, m.titlu, m.text);
    });
  }

  private destinatar(c: Comanda): string {
    return c.idClient ?? `oaspete:${c.idCos}`;
  }

  /** Mesaj despre comandă. Nu are nevoie de acord și nu conține oferte. */
  tranzactionala(c: Comanda, status: StatusComanda | undefined, titlu: string, text: string): Notificare {
    const n: Notificare = {
      id: this.next++,
      destinatar: this.destinatar(c),
      canale: ["push", "email"],
      tip: "tranzactionala",
      nrComanda: c.nrComanda,
      status,
      titlu,
      text,
      la: this.clock.now(),
    };
    this.trimise.push(n);
    return n;
  }

  /** Mesaj de marketing: pleacă doar cu acordul de marketing. Întoarce null dacă nu are acord. */
  marketing(idClient: string, titlu: string, text: string): Notificare | null {
    if (!this.consent.are(idClient, "marketing")) return null;
    const n: Notificare = { id: this.next++, destinatar: idClient, canale: ["push"], tip: "marketing", titlu, text, la: this.clock.now() };
    this.trimise.push(n);
    return n;
  }

  pentru(destinatar: string): Notificare[] {
    return this.trimise.filter((n) => n.destinatar === destinatar);
  }

  aleComenzii(nrComanda: string): Notificare[] {
    return this.trimise.filter((n) => n.nrComanda === nrComanda);
  }
}
