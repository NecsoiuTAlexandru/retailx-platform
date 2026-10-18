/**
 * Evenimentele de domeniu ale platformei. Serviciile care reacționează la viața comenzii
 * (notificări, fidelitate, KPI) se abonează aici, fără să fie legate direct de Serviciul Comenzi.
 */
import { EventBus } from "../core/events.js";
import type { Comanda, StatusComanda } from "./model.js";

export type DomainEvents = {
  "comanda.status": { comanda: Comanda; din: StatusComanda | null; in: StatusComanda; la: number; motiv?: string };
};

export type DomainBus = EventBus<DomainEvents>;
export const createDomainBus = (): DomainBus => new EventBus<DomainEvents>();
