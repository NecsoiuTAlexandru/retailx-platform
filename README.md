# RetailX — platforma omnichannel (prototip)

Prototip funcțional al platformei descrise în **BRD RetailX v1.0** (Inițiativa 1, AACPI 2026),
construit pe sprinturi. Fiecare sprint are un commit și un tag git (`s0` … `s8`), ca să poți
vedea exact ce s-a livrat în fiecare increment:

```bash
git tag -n            # lista sprinturilor
git checkout s1       # codul de la finalul Sprintului 1
npm test              # testele sprintului respectiv
git checkout main
```

Sistemul central de gestiune, procesatorul de plăți și firma de curierat sunt **simulați**
(cazul și datele sunt fictive, conform cerințelor proiectului). Toate datele sunt sintetice.

## Pornire

```bash
npm install
npm test          # toate testele TC-xx
npm start         # serverul pe http://localhost:3000
```

## Arhitectura

Platforma se așază **peste** sistemul central, fără să-l înlocuiască (BRD cap. 8):

```
 Website / Aplicație ──► API (Express) ──► Servicii platformă ──► Sistemul central (simulat)
                                           │  stoc, rezervări       ▲ API: 1 apel/min/magazin
                                           │  comenzi, plăți        │ evenimente de vânzare
                                           │  notificări, fidelitate
                                           └─► Procesator de plăți (simulat, 3-D Secure, idempotență)
```

| Folder | Conținut |
|---|---|
| `src/core` | ceas injectabil, bani (întregi), magistrala de evenimente |
| `src/domain` | modelul de domeniu după diagrama de clase (cap. 8.4) |
| `src/central` | simulatorul sistemului central + date sintetice |
| `tests` | testele, numite după cazurile de test din BRD (TC-01 … TC-15) |

Istoricul pe sprinturi e în [CHANGELOG.md](CHANGELOG.md).
