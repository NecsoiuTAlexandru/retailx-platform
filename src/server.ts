import { HOUR, MINUTE, SECOND, SystemClock } from "./core/clock.js";
import { lei } from "./core/money.js";
import { createPlatform } from "./platform.js";
import { createApp } from "./api/app.js";

const platform = createPlatform({ clock: new SystemClock() });

// Clienți de demo (persona din BRD, cap. 2.1): Ana are cont și card, cu 1.240 de puncte din magazin.
const ana = platform.fidelitate.inroleaza("ana", "Ana P.", "ana@example.ro");
platform.central.emiteBon("PH-NORD", lei(1154), ana.codCard);
platform.central.emiteBon("PH-NORD", lei(86), ana.codCard);

const app = createApp(platform);

// Sistemul central trimite un heartbeat pe minut; platforma aplică evenimentele procesate.
setInterval(() => platform.central.heartbeat(), MINUTE);
setInterval(() => platform.stock.processor.drain(), SECOND);
// Comenzile neridicate în 48 h se anulează și se rambursează.
setInterval(() => platform.fulfillment.verificaNeridicate(), HOUR);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`RetailX pe http://localhost:${port}`);
  console.log(`  website:            http://localhost:${port}/`);
  console.log(`  aplicația mobilă:   http://localhost:${port}/aplicatie.html`);
  console.log(`  culegere magazin:   http://localhost:${port}/magazin.html`);
});
