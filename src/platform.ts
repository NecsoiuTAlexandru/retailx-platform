/**
 * Compunerea platformei: un singur loc unde se creează serviciile și se leagă între ele.
 * Testele creează platforma cu un FakeClock; serverul cu ceasul real.
 */
import type { Clock } from "./core/clock.js";
import { CentralSystemSimulator } from "./central/centralSystem.js";
import { seedCentral } from "./central/seed.js";
import { PaymentProcessorSimulator } from "./payments/paymentProcessor.js";
import { StockService } from "./services/stock/stockService.js";
import { CartService } from "./services/cart/cartService.js";
import { PricingService } from "./services/pricing/pricingService.js";
import { OrderService } from "./services/orders/orderService.js";

export interface PlatformOptions {
  clock: Clock;
  /** false = magazine/produse goale (testele își pun singure datele). */
  seed?: boolean;
  /** false = nu face încărcarea inițială a stocului (testele ajustează întâi datele). */
  incarca?: boolean;
}

export function createPlatform({ clock, seed = true, incarca = true }: PlatformOptions) {
  // sisteme externe (simulate)
  const central = new CentralSystemSimulator(clock);
  if (seed) seedCentral(central);
  const procesator = new PaymentProcessorSimulator();

  // servicii platformă
  const stock = new StockService(clock, central);
  const cart = new CartService(stock);
  const pricing = new PricingService(central.produse);
  const orders = new OrderService(clock, cart, stock, pricing, procesator);

  if (incarca) stock.incarcaInitial();
  return { clock, central, procesator, stock, cart, pricing, orders };
}

export type Platform = ReturnType<typeof createPlatform>;
