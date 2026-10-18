/**
 * Compunerea platformei: un singur loc unde se creează serviciile și se leagă între ele.
 * Testele creează platforma cu un FakeClock; serverul cu ceasul real.
 */
import type { Clock } from "./core/clock.js";
import { CentralSystemSimulator } from "./central/centralSystem.js";
import { seedCentral } from "./central/seed.js";
import { PaymentProcessorSimulator } from "./payments/paymentProcessor.js";
import { CourierSimulator } from "./courier/courierSimulator.js";
import { createDomainBus } from "./domain/events.js";
import type { TipPrimire } from "./domain/model.js";
import { StockService } from "./services/stock/stockService.js";
import { CartService } from "./services/cart/cartService.js";
import { PricingService } from "./services/pricing/pricingService.js";
import { OrderService } from "./services/orders/orderService.js";
import { CAPACITATE_IMPLICITA, SlotService } from "./services/fulfillment/slotService.js";
import { FulfillmentService } from "./services/fulfillment/fulfillmentService.js";

export interface PlatformOptions {
  clock: Clock;
  /** false = magazine/produse goale (testele își pun singure datele). */
  seed?: boolean;
  /** false = nu face încărcarea inițială a stocului (testele ajustează întâi datele). */
  incarca?: boolean;
  capacitateIntervale?: Record<TipPrimire, number>;
}

export function createPlatform({ clock, seed = true, incarca = true, capacitateIntervale }: PlatformOptions) {
  // sisteme externe (simulate)
  const central = new CentralSystemSimulator(clock);
  if (seed) seedCentral(central);
  const procesator = new PaymentProcessorSimulator();
  const curier = new CourierSimulator();

  // servicii platformă
  const bus = createDomainBus();
  const stock = new StockService(clock, central);
  const cart = new CartService(stock, central.produse);
  const pricing = new PricingService(central.produse);
  const slots = new SlotService(clock, central.magazine, capacitateIntervale ?? CAPACITATE_IMPLICITA);
  const orders = new OrderService(clock, cart, stock, pricing, procesator, slots, bus);
  const fulfillment = new FulfillmentService(clock, orders, stock, curier);

  if (incarca) stock.incarcaInitial();
  return { clock, bus, central, procesator, curier, stock, cart, pricing, slots, orders, fulfillment };
}

export type Platform = ReturnType<typeof createPlatform>;
