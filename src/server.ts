import { MINUTE, SECOND, SystemClock } from "./core/clock.js";
import { createPlatform } from "./platform.js";
import { createApp } from "./api/app.js";

const platform = createPlatform({ clock: new SystemClock() });
const app = createApp(platform);

// Sistemul central trimite un heartbeat pe minut; platforma aplică evenimentele procesate.
setInterval(() => platform.central.heartbeat(), MINUTE);
setInterval(() => platform.stock.processor.drain(), SECOND);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`RetailX pe http://localhost:${port}`));
