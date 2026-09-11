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

## Quale metodo per cosa

| Per cosa                            | Metodo                            |
|----------------------------------|--------------------------------------|
| I primi 1-20 clienti, ognuno con il proprio dominio brand | B (dominio personalizzato) |
| 20+ clienti, non vuoi più modificare Caddy per cliente | A (wildcard) |
| App mobile                       | C (header)                           |
| Studio nel browser                   | risolto automaticamente via cookie dopo il primo login |
| Link della galleria per il cliente           | funziona su qualsiasi dominio tenant |

I metodi sono combinabili — un tenant può avere contemporaneamente un dominio personalizzato E un sottodominio wildcard E un header mobile.
