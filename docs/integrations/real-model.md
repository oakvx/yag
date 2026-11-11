# Qualificazione con modello reale, avvio isolato di YAG

Questa procedura **non utilizza mock**: richiede un backend di inferenza
OpenAI-compatible realmente raggiungibile e un modello disponibile. Può
generare consumi a pagamento se il backend remoto è tariffato.

A differenza di [live_model.py](live-model.md), che utilizza un gateway
già in esecuzione, `real_provider_probe.py` avvia un processo YAG temporaneo
su una porta locale, genera una chiave casuale e lo chiude al termine dei
test. Non modifica il gateway già in uso.

```sh
cmake -S . -B build && cmake --build build -j
export YAG_REAL_UPSTREAM_URL='http://127.0.0.1:8000/v1'
export YAG_REAL_MODEL='ID_MODELLO_REALE'
# Solo quando serve: export YAG_REAL_UPSTREAM_KEY='segreto-provider'
python3 tests/real_provider_probe.py --host ./build/yag --stream
python3 tests/real_provider_probe.py --host ./build/yag --tools --stream
```

Puoi limitare il controllo con `--protocol chat`, `--protocol responses` o
`--protocol anthropic`. Il test sui tools usa una funzione fittizia
`yag_fixture_lookup`, non esegue comandi di sistema e verifica che il
modello restituisca una chiamata funzione e che il risultato sia accettato
dal gateway.

**Limiti:** i backend HTTP sono ammessi soltanto su loopback; per provider
remoti è richiesto HTTPS. Nessun prompt, credenziale, URL di provider o
contenuto generato viene stampato nei log del probe. Le compatibilità
risultano qualificate soltanto per la versione esatta di modello, runtime
e gateway effettivamente utilizzata.

Non viene avviato alcun test su modelli reali dalla CI standard:
servono modello, infrastruttura e autorizzazione dell'operatore.
