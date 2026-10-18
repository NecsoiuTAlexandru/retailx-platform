# Istoric pe sprinturi

## S0 · Discovery (ian.–feb. 2027) — tag `s0`
Sprint Goal: Discovery aprobat; arhitectura de integrare testată la Poarta 1.

- Proiect Node.js + TypeScript, Express, Vitest.
- Model de domeniu inițial (Produs, Magazin, StocMagazin, StatusComandă).
- Simulatorul sistemului central: API de stoc cu limita de 1 apel/min/magazin, evenimente de vânzare, indisponibilitate.
- Test tehnic al integrării (`tests/s0-integration-spike.test.ts`) — riscul R2.
- Concluzie de arhitectură: interogările nu țin stocul sub 5 minute la 120 de magazine, deci platforma consumă **evenimente de vânzare**.

## S1 · 1–12 martie 2027 — tag `s1`
Sprint Goal: „Clientul vede stocul real și produsul i se rezervă la plată.” (US-01 8 SP, US-02 5 SP)

- Conectorul de stoc: încărcare inițială prin API + consumul evenimentelor de vânzare și heartbeat (decizia din 8 martie).
- Memoria cache de stoc pe magazin; stoc de siguranță de 2 bucăți.
- Eticheta de disponibilitate: „în stoc” / „indisponibil” / „disponibilitate neconfirmată” peste 5 minute (BR-04).
- Serviciul de rezervare pe 15 minute, totul-sau-nimic; anularea la golirea coșului.
- API REST și pagina de produs (website) cu disponibilitatea în alte magazine și cronometrul rezervării.
- Teste: TC-01a, TC-02, TC-03a/b/c trecute. **TC-01b eșuat → DEF-01** (12 min la vârf, procesare secvențială), marcat `it.fails`.
- Decizia PO: US-02 acceptat; US-01 trece în S2 cu prioritate maximă.

## S2 — tag `s2`
Sprint Goal: „Costul total e clar și plata nu pierde coșul.” (US-03 5 SP, US-04 8 SP + DEF-01)

- **DEF-01 remediat**: evenimentele se procesează în paralel, câte o bandă pe magazin (ordinea se păstrează în magazin). Retest TC-01b trecut.
- Calculul costului total (produse + livrare + SGR − reduceri), prețuri luate doar din catalog; livrare 15 lei sub pragul de 200 lei.
- Simulator de procesator de plăți: 3-D Secure, carduri de test, idempotență, căderea conexiunii după debitare.
- Serviciul Comenzi după diagrama de secvență: rezervare → autorizare → „Confirmată”; plata refuzată eliberează rezervarea și păstrează coșul.
- Mașina de stări a comenzii (diagrama de stări, cap. 8.5).
- Website: rezumatul costului și plata cu carduri de test.
- Teste: TC-04, TC-05, TC-06, TC-07 + retest TC-01b. Decizia PO: US-01, US-03, US-04 acceptate.

## S3 — tag `s3`
Sprint Goal: „Clientul comandă pe orice canal și alege cum primește.” (US-05 5 SP, US-06 8 SP)

- Coș comun website ↔ aplicație pentru clientul autentificat; coșul anonim se păstrează la autentificare.
- La deschiderea coșului, prețul și stocul se reverifică; clientul vede ce s-a schimbat.
- Intervale de 2 ore pentru livrare și ridicare, cu capacitate pe magazin; intervalul plin nu poate fi ales.
- Onorarea comenzii: pregătire → cod de ridicare (4 cifre) sau predare la curier (AWB, link de urmărire) → „Onorată”.
- Neridicată în 48 h → „Anulată” cu rambursare integrală.
- Ieșirea din stoc a produselor culese, fără fereastră în care produsul reapare online.
- Magistrală de evenimente de domeniu (`comanda.status`), pentru notificări, fidelitate și KPI.
- Website: autentificare, alegerea intervalului, adresa; aplicația mobilă (`/aplicatie.html`) cu coșul comun.
- Teste: TC-08, TC-09. Test de uzabilitate cu 5 clienți: 4 din 5 fără ajutor; story de corecție pentru alegerea intervalului (butoane mari, „plin” afișat în text, nu doar culoare).

## S4 — tag `s4`
Sprint Goal: „Clientul e informat și comanda nu se anulează pentru un produs lipsă.” (US-07 3 SP, US-09 5 SP)

- Serviciul Notificări: o notificare tranzacțională (push + e-mail) la fiecare schimbare de status, în ordine; fără oferte.
- Consimțăminte separate pentru marketing și recomandări (NFR-03), cu jurnal de acord/retragere; marketingul pleacă doar cu acord.
- Preferința de înlocuire din coș (activată explicit de client).
- Aplicația de culegere (`/magazin.html`): produs lipsă → înlocuitor similar sau eliminarea doar a liniei, cu rambursare parțială (inclusiv SGR); anulare integrală doar dacă lipsesc toate produsele.
- Aplicația mobilă: ecranul „Comenzi” cu pașii statusului, înlocuirile și codul de ridicare.
- Teste: TC-10 și TC-11a trecute. **TC-11b eșuat → DEF-02** (înlocuitorul putea fi mai scump), marcat `it.fails`.
- Decizia PO: respins parțial — US-07 acceptat, US-09 reluat în S5.

## S5 — tag `s5`
Sprint Goal: „Un singur card de fidelitate în toate canalele.” (US-08 13 SP + DEF-02)

- **DEF-02 remediat**: înlocuitorul are preț egal sau mai mic; se alege cel mai apropiat ca preț. Retest TC-11b trecut.
- Profil unic de client și card de fidelitate comun: bonurile din magazin (cu cardul scanat) și comenzile online ajung în același profil.
- Puncte online doar la „Onorată”, pe suma efectiv plătită; 100 de puncte = 1 leu reducere, afișată în costul total înainte de plată; punctele se restituie la anulare.
- Niveluri Bronz / Argint / Aur; oferta personalizată doar cu acordul „recomandări”; exportul datelor personale (art. 15 GDPR) — sprijin pentru DPIA cu DPO.
- Aplicația mobilă: ecranul „Card”; website: puncte de primit și folosirea punctelor.
- Teste: TC-12 + retest TC-11. Decizia PO: US-08 și US-09 acceptate.

## S6 — tag `s6`
Sprint Goal: „Clientul face retur din cont.” (US-10 8 SP)

- Serviciul Retur: cerere din cont cu număr (RT-…), motiv, fotografie opțională, returnare în magazin sau prin curier.
- Reguli OUG 34/2014: doar comenzi „Onorate”, în 14 zile; perisabilele doar dacă sunt deteriorate/neconforme; rambursare preț + SGR, iar la returul întregii comenzi și livrarea.
- Statusul returului vizibil în cont, cu termenul rambursării; comanda devine „Returnată” la returul integral; punctele aferente sumei rambursate se retrag.
- Aplicația mobilă: ecranul „Retur”.
- Teste: TC-13 + testul end-to-end omnichannel (căutare → plată → înlocuire → ridicare → puncte → retur). Decizia PO: US-10 acceptat.

## S7 — tag `s7`
Sprint Goal: „KPI-urile se măsoară corect și platforma rezistă la vârf.” (US-11 8 SP, NFR-01 5 SP)

- Serviciul KPI, cu definițiile din fișa inițiativei: rata de finalizare (o sesiune = o comandă), anulări integrale din lipsă de stoc, recumpărare în 60 de zile pe cohorta primei comenzi onorate.
- Evenimentele de măsurare vin direct din platformă: deschiderea finalizării, confirmare, anulare din lipsă de stoc, onorare.
- Recumpărarea e marcată provizorie până se încheie fereastra de 60 de zile pentru toată cohorta.
- Indicatori de control: ponderea comenzilor cu înlocuire, timpul mediu de pregătire.
- Pagina KPI (`/kpi.html`) pentru Directorul E-commerce.
- Optimizare: cantitățile rezervate indexate pe magazin|produs; expirarea parcurge doar rezervările temporare.
- Instrument de test de încărcare (`npm run load`).
- Teste: TC-14 (KPI = calcul manual), TC-15 (250 de clienți simultan: p95 sub 3 s, zero erori, nicio comandă pierdută). Decizia PO: US-11, NFR-01 acceptate.
