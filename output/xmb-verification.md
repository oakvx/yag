# YAG ? pagine con spiegazione immediata

La richiesta pi? recente sostituisce i menu iniziali delle pagine informative: introduzione, spiegazioni e sezioni sono ora leggibili nello stesso pannello scorrevole. Le liste rimangono nei simulatori, nei selettori del codice e nelle impostazioni. Home mostra subito anche i limiti del progetto.

## Verifiche finali

- TypeScript strict: `npx tsc --noEmit`, nessun errore.
- Produzione: `npx vite build`, completata.
- `node scripts/check-xmb-core.mjs`: 7 casi per i titoli dei commit e 75 campioni delle onde; costanti del movimento e larghezza del boot invariate.
- Edge / Playwright: 20 percorsi ? 3 dimensioni (1920?1080, 1366?768, 390?844) ? 3 temi (rosso, verde, blu): 180 combinazioni, nessun overflow orizzontale o sovrapposizione alla barra dei comandi, introduzioni visibili, nessun errore raccolto nelle pagine del test.
- 294 selezioni da tastiera nelle liste incorporate. Gamepad virtuale attraverso il polling reale: scorrimento, focus, apertura e ritorno al menu riusciti.
- Routing: errore TCP con fallback, limite sul replay HTTP e input modello personalizzato. Lifecycle: avanzamento e pausa. Copia negli appunti, conferma link esterno e ripristino focus, navigazione interna, anteprima/applicazione tema e QuickJump: riusciti.
- Contrasto: campioni dei 12 temi e sfondo forzato bianco, pi? luminoso delle onde. Minimi conservativi sul bianco: righe 5,57:1; testo secondario 4,76:1; corpo 6,22:1.
- Ricerca di classi di stile button/card/tab/badge/chip/pill/rounded nelle pagine, nei componenti e in QuickJump: nessuna corrispondenza. Nel CSS le parole card/pill rimangono soltanto in commenti. Gli elementi HTML button rimangono per accessibilit?; i dati storici dei commit non sono CSS attivo.

## Limiti della verifica

Non era disponibile un controller fisico: i pulsanti sono stati simulati tramite navigator.getGamepads usando il vero ciclo di polling. Verifica browser eseguita in Edge; nessuna matrice di browser diversi. RTK non ? installato, quindi i comandi sono stati eseguiti direttamente. I test di layout e interazione della nuova impaginazione sono in verify-reading.js e reading-behavior.js; gli artefatti drilldown precedenti documentano la versione superata.

## Artefatti riproducibili

- output/playwright/verify-reading.js
- output/playwright/reading-behavior.js
- output/playwright/reading-behavior-results.txt
- output/playwright/check-contrast.js
- output/playwright/contrast-results.txt
- output/playwright/reading-{1920,1366,390}-{9,4,0}.png

## File del progetto modificati in questa sessione

Le modifiche gi? presenti prima della sessione sono escluse da questo elenco. Primitives.tsx e XmbSurface.tsx sono stati rimossi perch? sostituiti dai componenti condivisi. Le risorse originali nella cartella public sono conservate; il bundle esclude i vecchi file audio/font proprietari.

- dist/ASSETS.txt
- dist/audio/cancel.mp3 (removed)
- dist/audio/cursor.mp3 (removed)
- dist/audio/select.mp3 (removed)
- dist/audio/start.mp3 (removed)
- dist/audio/trophy.mp3 (removed)
- dist/fonts/PS4-Logo.otf (removed)
- dist/index.html
- index.html
- public/ASSETS.txt
- scripts/check-xmb-core.mjs
- src/components/CodeBlock.tsx
- src/components/Primitives.tsx
- src/components/XmbDocument.tsx
- src/components/XmbRow.tsx
- src/components/XmbScreen.tsx
- src/components/XmbSurface.tsx
- src/index.css
- src/pages/ArchitecturePage.tsx
- src/pages/DeployPage.tsx
- src/pages/HomePage.tsx
- src/pages/LifecyclePage.tsx
- src/pages/ProblemPage.tsx
- src/pages/ProfilePage.tsx
- src/pages/ProjectPage.tsx
- src/pages/ProtocolsPage.tsx
- src/pages/RoutingPage.tsx
- src/pages/SecurityPage.tsx
- src/pages/SourcePage.tsx
- src/pages/StatusPage.tsx
- src/pages/SystemUtilities.tsx
- src/xmb/ApplicationControls.tsx
- src/xmb/ConsoleEnvironment.tsx
- src/xmb/QuickJump.tsx
- src/xmb/XmbList.tsx
- src/xmb/XmbStatusBar.tsx
- src/xmb/assets.ts
- src/xmb/audio.ts
- src/xmb/brandFont.ts
- src/xmb/commitTitle.ts
- src/xmb/wave2d.ts
- src/xmb/waveProfile.ts
- src/xmb/waveShader.ts
- vite.config.ts
