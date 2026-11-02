[English](MULTI_TENANT.md) · [Deutsch](MULTI_TENANT.de.md) · **Italiano**

# Setup multi-tenant

> ⚠️ **Nota sulla licenza:** Far girare Lumio in multi-tenant per **la tua organizzazione o un'agenzia** (più brand/clienti che gestisci tu stesso) non è soggetto a restrizioni. Offrire Lumio come **SaaS commerciale a terzi** che compete con il servizio ospitato del maintainer è *Competing Use* e **non** è consentito liberamente sotto la FSL-1.1-ALv2 — per questo serve una licenza commerciale. Vedi [LICENSE](../LICENSE).

> **Tenant o studio?** Sono la stessa cosa. Una riga, due parole: diciamo
> *tenant* quando si parla di amministrazione e isolamento (creare, sospendere,
> archiviare, fatturare, instradare) e *studio* quando si parla delle persone
> che ci lavorano. L'area Super-Admin parla quindi di tenant, l'interfaccia
> dello studio mai.

Lumio può gestire più tenant (studi/clienti fotografi) sulla stessa installazione. Questo documento descrive come un nuovo tenant diventa raggiungibile — il DB + l'UI lo creano, ma perché l'URL giusto arrivi al tenant giusto ti serve uno dei tre metodi di routing qui sotto.

Se stai costruendo un SaaS e hai meno di 20 clienti, il **metodo B (domini personalizzati per cliente)** è il percorso consigliato. I wildcard ripagano solo una volta che modificare il Caddyfile manualmente per ogni cliente diventa tedioso.

## Come funziona la risoluzione del tenant

Quando arriva una richiesta API, la risoluzione del tenant gira in questo ordine (vedi `apps/api/src/plugins/auth.ts:resolveTenant`):

1. **Utente loggato** (cookie) — la sessione sa quale tenant
2. **Header `X-Lumio-Tenant`** — per l'app mobile e i client API
3. **Dominio personalizzato** — `studio-mueller.de` confrontato con `tenants.customDomain`
4. **Sottodominio** — `studio-mueller.lumio-cloud.de` confrontato con `tenants.slug`, a condizione che `LUMIO_DOMAIN_BASE` sia impostato
5. **Fallback single-mode** — se esiste solo un tenant, viene usato quello

Non appena crei il secondo tenant, il passaggio 5 decade — devi usare 2, 3 o 4.

**Link delle gallerie.** Gli slug delle gallerie sono univoci per studio, non per installazione, quindi due studi possono usare lo stesso slug leggibile. Un link di galleria (`/g/<slug>`) viene risolto rispetto allo studio restituito dalla risoluzione del tenant. Per un visitatore anonimo, cioè un cliente dello studio, questo deriva dall'host (passaggi 3 e 4), per cui una galleria si apre sul dominio del proprio studio. Se non si riesce a determinare nessuno studio — per esempio in un'installazione multi-tenant senza sottodomini o domini personalizzati per studio — lo slug viene cercato tra tutti gli studi e la galleria si apre solo se ce n'è esattamente una; se ce ne sono più di una, il link restituisce 404. Oggi gli slug sono casuali, quindi il caso si presenta solo quando gli studi potranno scegliere il proprio slug e due sceglieranno lo stesso. Un'installazione con un solo studio cerca sempre gli slug su tutta l'installazione.

---

## Metodo B: domini personalizzati per cliente (consigliato per i primi clienti)

Ogni cliente riceve un proprio dominio come `studio-mueller.de` o un bel sottodominio come `mueller.lumio.app`. Un blocco Caddyfile per dominio (sul Caddy esterno), il certificato viene ottenuto automaticamente tramite HTTP challenge — nessun plugin DNS necessario, funziona con il Caddy standard.

### Passaggi per un nuovo cliente

1. **Record DNS** — il cliente (o tu) punta il proprio dominio al tuo IP:
   ```
   studio-mueller.de    A    <IP dell'host Caddy esterno>
   ```

2. **Caddy esterno** — aggiungi un blocco:
   ```caddyfile
   studio-mueller.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
   Poi `caddy reload` (o riavvia il container Caddy). Il certificato viene ottenuto automaticamente tramite HTTP challenge non appena il dominio risolve.

3. **Nel super admin** su `https://studio.lumio-cloud.de/super/login`:
   - "+ Nuovo tenant"
   - Inserisci slug, nome, **dominio personalizzato `studio-mueller.de`**
   - Nome + email del proprietario
   - "Crea + invita"

4. **Il proprietario** clicca il link di setup nell'email, imposta la propria password, è loggato. Da quel momento `https://studio-mueller.de` è il suo studio.

I link della galleria sono indipendenti da questo — usano lo slug della galleria, non lo slug del tenant, e funzionano sul rispettivo dominio del tenant (`studio-mueller.de/g/<gallery-slug>`).

### Importante: il Caddy interno ha un catch-all

Il Caddy interno (`infra/caddy/Caddyfile`) è configurato per contenere un blocco catch-all `http://` che si applica a **qualsiasi host** che non venga abbinato in modo più specifico. È esattamente ciò di cui hanno bisogno i domini personalizzati — altrimenti Caddy invierebbe un 308 verso `https://` per host sconosciuti e produrrebbe così (in combinazione con il Caddy esterno) un `ERR_TOO_MANY_REDIRECTS`.

**Non devi cambiare nulla per cliente sul Caddy interno.** Il codice di risoluzione del tenant in `apps/api/src/plugins/auth.ts` confronta tramite l'header Host con `tenants.customDomain`. Se il dominio è inserito lì, tutto gira automaticamente.

### Senza proxy esterno: certificati automatici (TLS on-demand)

Se il Caddy di Lumio è esposto direttamente su internet (porte 80/443,
nessun proxy esterno davanti), può ottenere da solo i certificati per i
domini personalizzati, senza un blocco nel Caddyfile per ogni cliente.
Nel `.env`:

```
LUMIO_CUSTOM_DOMAIN_TLS_HOST=https://
```

poi `docker compose up -d caddy` (o il tuo solito comando di deploy). Da
quel momento il cliente imposta il record A (o CNAME), inserisce il dominio
nello studio e Caddy ottiene il certificato alla prima richiesta (1–2 minuti).

Prima Caddy chiede all'API (`/internal/tls-ask`, raggiungibile solo nella
rete Docker) se il dominio appartiene a uno studio. Domini estranei puntati
sul tuo IP non ricevono alcun certificato. Dominio principale, wildcard e
siti marketing mantengono i loro certificati.

**Non attivarlo dietro un reverse proxy esterno**: lì il TLS lo fa il proxy
esterno e basta il catch-all `http://`.

### Se non hai ancora un dominio personalizzato

Va bene anche un bel sottodominio sotto il tuo brand per ogni cliente — es. `mueller.lumio-cloud.de` come "interim" finché il cliente non decide per un dominio personalizzato. Ogni sottodominio del genere è un proprio blocco Caddyfile con un proprio certificato. Con 5-10 clienti va benissimo.

---

## Metodo A: sottodominio wildcard (`*.lumio-cloud.de`)

Una volta che hai molti clienti in stile SaaS e modificare il Caddyfile manualmente per cliente diventa fastidioso, il salto ai wildcard ripaga. Allora `<slug>.lumio-cloud.de` è automaticamente l'URL dello studio per ogni tenant, senza reload di Caddy per ogni nuovo cliente.

**Ma**: i certificati wildcard richiedono la DNS challenge, perché la HTTP challenge non può validare `*.domain`. Ti serve o un plugin DNS (per il reselling United Domains c'è [`KlettIT/caddy-autodns`](https://github.com/KlettIT/caddy-autodns) come plugin di terze parti, che andrebbe compilato dentro Caddy tramite xcaddy), oppure usi la delega CNAME acme-dns.

Se percorri questa strada, i passaggi sono:

1. **DNS** — record A wildcard `*.lumio-cloud.de` → IP
2. **Caddy a monte** — blocco wildcard con DNS challenge
3. **Caddy interno di Lumio** — imposta `LUMIO_WILDCARD_HOST=*.lumio-cloud.de:80` in `.env` (il blocco Caddyfile è già preparato, vedi `infra/caddy/Caddyfile`)
4. **Env dell'API** — `LUMIO_DOMAIN_BASE=lumio-cloud.de`

Il walkthrough completo è in [WILDCARD.md](WILDCARD.it.md). Per il primissimo onboarding non ne vale ancora la pena — torna a questa sezione quando sei pronto, o chiedi.

---

## Metodo C: header `X-Lumio-Tenant` (per client API)

Usato soprattutto dall'app mobile. Invece di passare tramite dominio/sottodominio, il client parla direttamente con l'URL dell'API e invia un header:

```
GET /api/v1/galleries HTTP/1.1
Host: studio.lumio-cloud.de
X-Lumio-Tenant: studio-mueller
```

Proprietà di sicurezza importante: se è presente un cookie di sessione, **vince il tenant della sessione**, non l'header. Altrimenti un utente con un cookie per il tenant A potrebbe semplicemente accedere al tenant B tramite manipolazione dell'header.

Quindi l'header ha effetto solo sulle richieste non loggate (login dell'app mobile, autenticazione via token API).

---

## Rinominare il tenant di default

Il primo tenant, creato tramite `npm run create-admin`, ha slug=`default`. Se gestisci una vera piattaforma multi-tenant, vorrai rinominarlo:

- Super admin → Tenant → clicca sul tenant default → Modifica
- Cambia lo slug (viene mostrato un avviso)
- Salva

⚠ Gli URL dei sottodomini esistenti sotto `default.lumio-cloud.de` si rompono immediatamente (se il metodo A è attivo). I link di condivisione della galleria **non** sono interessati — usano lo slug della galleria, non lo slug del tenant. Le sessioni studio loggate del tenant restano valide (il cookie porta il tenantId, non lo slug).

---

## Slug personalizzati della galleria e prevedibilità

Owner e admin possono sostituire lo slug di condivisione casuale di una galleria (`/g/<casuale>`) con uno leggibile (`/g/mueller-hochzeit`) dalla tab Condividi della galleria. Prima di parlarne ai clienti, è utile sapere quanto segue:

Per una galleria con accesso pubblico attivo e senza password, lo slug *è* il controllo d'accesso: chiunque lo conosca (o lo indovini) entra. Lo slug casuale predefinito è crittograficamente impossibile da indovinare; uno leggibile, specialmente per un evento con un nome come un matrimonio, non lo è. Questo pesa di più su un'istanza condivisa/SaaS, dove è plausibile che più persone possano tentare di indovinarlo rispetto a un self-host single-tenant.

L'interfaccia dello studio mostra un avviso nell'editor dello slug ogni volta che la galleria è sia pubblica che senza password. Non c'è comunque una restrizione rigida all'impostazione di uno slug personalizzato — un URL pulito è una richiesta legittima, ed è una scelta dello studio — ma chi costruisce un proprio client contro l'API dovrebbe mantenere lo stesso avviso invece di ometterlo.

---

## Pagine e pagina iniziale

Uno studio può mettere pagine curate di gallerie sotto `/p/<slug>` e rendere una pagina pubblica la sua **pagina iniziale**, mostrata su `/` invece del reindirizzamento all'accesso (vedi [LANDING_PAGES.it.md](LANDING_PAGES.it.md)). Entrambe seguono la stessa risoluzione del tenant dei link alle gallerie:

- **Quale studio** lo decide l'host della richiesta (dominio personalizzato o sottodominio, passi 3 e 4 sopra), quindi `studio-a.example.com/` mostra la pagina iniziale dello studio A e mai quella dello studio B. Lo slug di una pagina è univoco per studio, quindi due studi possono avere entrambi `/p/portfolio`.
- **Sul dominio apex** (`lumio-cloud.de/`, `studio.lumio-cloud.de/` e gli altri host riservati) non c'è nessuno studio: `/` resta la scelta dello studio e non ci sono pagine.
- **Uno studio senza pagina iniziale**, o con la funzione disattivata, mantiene il reindirizzamento a `/login` esattamente come prima.
- **Uno studio con dominio personalizzato** non ha bisogno di `LUMIO_DOMAIN_BASE` per questo: il frontend interroga l'API per ogni host, e l'API risolve il dominio.
- **Senza host per studio** (un'installazione multi-tenant su un unico host) la risoluzione del tenant non trova nessuno studio: `/` si comporta come prima, e un link `/p/<slug>` funziona solo se esattamente uno studio usa quello slug, come un link a una galleria.
- Per il render lato server di `/`, il frontend passa l'host del visitatore (`X-Forwarded-Host` del proxy, altrimenti `Host`) all'API. Il `fetch` di Node non può impostare quell'header, quindi usa `node:http`.

---

## Quale metodo per cosa

| Per cosa                            | Metodo                            |
|----------------------------------|--------------------------------------|
| I primi 1-20 clienti, ognuno con il proprio dominio brand | B (dominio personalizzato) |
| 20+ clienti, non vuoi più modificare Caddy per cliente | A (wildcard) |
| App mobile                       | C (header)                           |
| Studio nel browser                   | risolto automaticamente via cookie dopo il primo login |
| Link della galleria per il cliente           | funziona sul dominio dello studio proprietario della galleria |

I metodi sono combinabili — un tenant può avere contemporaneamente un dominio personalizzato E un sottodominio wildcard E un header mobile.
