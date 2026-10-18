# RetailX — platforma omnichannel (prototip)

Prototip funcțional al platformei descrise în **BRD RetailX v1.0** (Inițiativa 1, AACPI 2026),
construit pe sprinturi de Developer (Necșoiu Toader Alexandru). Fiecare sprint are un commit și un
tag git, ca incrementul fiecărui sprint să poată fi rulat și demonstrat separat:

```bash
git tag -n            # sprinturile și decizia PO de la Sprint Review
git checkout s1       # codul de la finalul Sprintului 1 (cu DEF-01 încă deschis)
npm install && npm test
git checkout main     # versiunea gata de pilot (S8)
```

Sistemul central de gestiune, procesatorul de plăți și firma de curierat sunt **simulați**
(cazul și datele sunt fictive, conform cerințelor proiectului). Toate datele sunt sintetice.

## Pornire

Necesită Node.js 20 sau mai nou.

```bash
npm install
npm test            # toate testele (62)
npm run regresie    # raportul TC-01 … TC-15 (criteriul de ieșire pentru Poarta 2)
npm start           # serverul pe http://localhost:3000
npm run load        # test de încărcare pe serverul pornit (NFR-01)
```

| Pagină | Pentru cine | Ce arată |
|---|---|---|
| `http://localhost:3000/` | client pe website | stoc confirmat, alte magazine, coș, cost total, intervale, plată cu carduri de test, puncte |
| `/aplicatie.html` | clientul Ana în aplicația mobilă | coșul comun, statusul comenzii, cardul de fidelitate, returul |
| `/magazin.html` | Elena, culegător în magazin | comenzile de cules, regula de înlocuire pe fiecare linie |
| `/kpi.html` | Directorul E-commerce | cei 3 KPI pe cohorta lunară și indicatorii de control |

Scenariu de demo: pe website apasă „Intră în cont ca Ana”, adaugă produse, bifează înlocuirea,
alege un interval și plătește. În `/magazin.html` pune „găsit 0” la un iaurt și ambalează.
În aplicație, la „Comenzi”, apare înlocuirea și codul de ridicare.

## Sprinturile

| Tag | Sprint Goal | Story-uri (SP) | Teste | Decizia PO |
|---|---|---|---|---|
| `s0` | Discovery aprobat; integrarea testată | — | test tehnic al integrării | Poarta 1 |
| `s1` | Clientul vede stocul real și produsul i se rezervă la plată | US-01 (8), US-02 (5) | TC-01a, TC-02, TC-03; **TC-01b eșuat → DEF-01** | US-02 acceptat, US-01 mutat în S2 |
| `s2` | Costul total e clar și plata nu pierde coșul | US-03 (5), US-04 (8) + DEF-01 | TC-04–TC-07, retest TC-01b | US-01, US-03, US-04 acceptate |
| `s3` | Clientul comandă pe orice canal și alege cum primește | US-05 (5), US-06 (8) | TC-08, TC-09 | acceptat cu story de corecție |
| `s4` | Clientul e informat; comanda nu se anulează pentru un produs lipsă | US-07 (3), US-09 (5) | TC-10, TC-11a; **TC-11b eșuat → DEF-02** | US-07 acceptat, US-09 reluat |
| `s5` | Un singur card de fidelitate în toate canalele | US-08 (13) + DEF-02 | TC-12, retest TC-11 | US-08, US-09 acceptate |
| `s6` | Clientul face retur din cont | US-10 (8) | TC-13, end-to-end | acceptat |
| `s7` | KPI-urile se măsoară corect și platforma rezistă la vârf | US-11 (8), NFR-01 (5) | TC-14, TC-15 | acceptat |
| `s8` | Platforma e gata de pilot | stabilizare | regresie TC-01–TC-15 | gata de pilot (Poarta 2) |

Detaliile fiecărui sprint sunt în [CHANGELOG.md](CHANGELOG.md).

## Trasabilitate: cerință → cod → test

| Cerință | Story | Cod | Test |
|---|---|---|---|
| FR-01 stoc verificat ≤ 5 min | US-01 | `services/stock/stockService.ts`, `eventProcessor.ts` | `s1` TC-01a/b, TC-02 |
| FR-02 rezervare 15 min | US-02 | `services/stock/stockService.ts`, `cart/cartService.ts` | `s1` TC-03a/b/c |
| FR-03 cost total înainte de plată | US-03 | `services/pricing/pricingService.ts` | `s2` TC-04, TC-05 |
| FR-04, NFR-02 plată cu reîncercare, idempotență | US-04 | `services/orders/orderService.ts`, `payments/paymentProcessor.ts` | `s2` TC-06, TC-07 |
| FR-05 coș comun | US-05 | `services/cart/cartService.ts` | `s3` TC-08 |
| FR-06 livrare / ridicare, intervale | US-06 | `services/fulfillment/slotService.ts`, `fulfillmentService.ts` | `s3` TC-09 |
| FR-07, NFR-03 notificări, consimțământ | US-07 | `services/notifications/`, `services/consent/` | `s4` TC-10 |
| FR-09 înlocuire cu acord | US-09 | `services/picking/pickingService.ts` | `s4` TC-11a/b |
| FR-08 profil unic, card comun | US-08 | `services/loyalty/loyaltyService.ts` | `s5` TC-12 |
| FR-10 retur din cont | US-10 | `services/returns/returnService.ts` | `s6` TC-13 |
| FR-11 cei 3 KPI | US-11 | `services/kpi/kpiService.ts` | `s7` TC-14 |
| NFR-01 performanță la vârf | NFR-01 | `tools/loadTest.ts`, indexul de rezervări | `s7` TC-15 |
| BR-04 niciun stoc neverificat / cost incomplet | toate | eticheta „neconfirmat”, `TotalModificatError` | `s1`, `s2` |
| Ciclul de viață al comenzii (cap. 8.5) | — | `domain/orderState.ts` | toate fluxurile |

## Arhitectura

Platforma se așază **peste** sistemul central, fără să-l înlocuiască (BRD cap. 8):

```
 Website / Aplicație / Magazin ──► API REST (Express) ──► Servicii platformă
                                                          │ stoc, rezervări, coș, cost total
                                                          │ comenzi, intervale, onorare, culegere
                                                          │ notificări, consimțăminte, fidelitate
                                                          │ retur, KPI
                                                          ▼
                                    magistrala de evenimente de domeniu (comanda.status)
 Sisteme externe simulate:
   Sistemul central de gestiune  ── API (1 apel/min/magazin) + evenimente de vânzare, heartbeat, bonuri
   Procesatorul de plăți         ── 3-D Secure, carduri de test, idempotență, rambursări
   Firma de curierat             ── AWB, link de urmărire, confirmarea livrării
```

| Folder | Conținut |
|---|---|
| `src/core` | ceas injectabil, bani ca întregi, magistrala de evenimente, erori comune |
| `src/domain` | modelul de domeniu (diagrama de clase), mașina de stări a comenzii, evenimentele de domeniu |
| `src/central`, `src/payments`, `src/courier` | sistemele externe simulate și datele sintetice |
| `src/services` | serviciile platformei, câte un folder pe serviciu |
| `src/api` | rutele REST |
| `src/tools` | testul de încărcare și raportul de regresie |
| `public` | website, aplicația mobilă, aplicația de culegere, pagina KPI |
| `tests` | un fișier pe sprint; numele testelor încep cu ID-ul cazului de test din BRD |

Sumele sunt ținute în bani (întregi), ca „suma afișată = suma debitată” să fie o egalitate exactă.
Ceasul e injectat, așa că testele pot verifica regulile de timp (5 minute, 15 minute, 48 de ore,
14 zile, 60 de zile) fără să aștepte.

## Ipoteze de lucru (de validat în pilot)

Stoc de siguranță 2 bucăți · livrare 15 lei sub 200 lei · intervale de 2 ore, cu capacitate 8 (ridicare)
și 6 (livrare) pe magazin · 1 punct / leu, 100 de puncte = 1 leu · 5 × traficul mediu = 250 de
clienți care finalizează simultan.

## Ce nu acoperă prototipul

Persistența (datele stau în memorie), autentificarea reală, integrarea cu un procesator și un curier
reali, recomandările personalizate (US-12, „Could”) și grupul de control de 5% din pilot.
