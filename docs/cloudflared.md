# Accesso tramite dominio con Cloudflare Tunnel (cloudflared)

ArcbaseOS può essere raggiunto da Internet tramite un tuo dominio instradato da
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
senza aprire porte sul router.

## Come funziona

Sulla rete locale ogni app è servita su una porta propria (`umbrel.local:8080`,
`umbrel.local:8081`, …) e il login delle app avviene su `umbrel.local:2000`.
Un tunnel Cloudflare invece instrada **nomi host**, non porte: `dominio:8080` non
arriverebbe mai all'app. Per questo, quando l'accesso tramite dominio è attivo,
ArcbaseOS instrada le richieste in base all'header `Host` sulla porta 80 (e 443).
Esempio con la dashboard su `home.example.com` e il modello `{app}.example.com`:

| Nome host                        | Destinazione                                        |
| -------------------------------- | --------------------------------------------------- |
| `home.example.com`               | Dashboard e login delle app (`/app-auth`)           |
| `<app-id>.example.com`           | L'app `<app-id>` (es. `nextcloud`, `jellyfin`)      |
| qualsiasi altro host (LAN, IP)   | Comportamento normale, invariato                    |

Se lasci vuoto il modello, le app usano `{app}.<dominio della dashboard>`
(es. `nextcloud.home.example.com`) e seguono automaticamente i cambi di dominio.

Il login delle app avviene sul dominio della dashboard: se hai già fatto
l'accesso alla dashboard, le app si aprono senza chiedere di nuovo la password,
e il logout dalla dashboard chiude anche le app.

cloudflared si collega in HTTP alla porta 80, mentre il browser usa HTTPS sul
bordo di Cloudflare. ArcbaseOS legge lo schema del visitatore dall'header
`CF-Visitor` inviato da Cloudflare, così cookie `Secure`, redirect di login e
WebSocket usano `https://`. Chi apre il dominio con `http://` viene reindirizzato
a `https://`, anche se in Cloudflare l'opzione "Always Use HTTPS" è spenta.

## 1. Configura il dominio in ArcbaseOS

Apri **Impostazioni → Impostazioni avanzate → Dominio pubblico (Cloudflare Tunnel)**,
inserisci il dominio della dashboard (es. `home.example.com`), il modello delle
app (es. `{app}.example.com`, oppure lascialo vuoto) e attiva l'interruttore.

Il pannello mostra anche la configurazione di cloudflared pronta da copiare.

In alternativa, dal terminale del dispositivo:

```sh
sudo umbreld client domainAccess.set.mutate --enabled true --domain home.example.com --appHostTemplate '{app}.example.com'
sudo umbreld client domainAccess.get.query
```

Non sono accettati domini che esistono solo in rete locale (`.local`, `.lan`,
`.home.arpa`, `.internal`, …).

## 2. Configura il tunnel

### Tunnel gestito localmente (`config.yml`)

```yaml
tunnel: <ID-DEL-TUNNEL>
credentials-file: /etc/cloudflared/<ID-DEL-TUNNEL>.json

ingress:
  - hostname: home.example.com
    service: http://localhost:80
  - hostname: "*.example.com"
    service: http://localhost:80
  - service: http_status:404
```

Crea i record DNS (CNAME verso il tunnel) per entrambi i nomi:

```sh
cloudflared tunnel route dns <NOME-TUNNEL> home.example.com
cloudflared tunnel route dns <NOME-TUNNEL> "*.example.com"
```

cloudflared e il DNS accettano la wildcard solo nella forma `*.<suffisso>`, quindi
usala solo con modelli del tipo `{app}.<suffisso>`. Con un modello diverso (ad
esempio `{app}-home.example.com`) serve una regola e un record DNS per ogni app:
il pannello in questo caso genera l'elenco completo.

### Tunnel gestito dalla dashboard Cloudflare (token)

In **Zero Trust → Networks → Tunnels → Public Hostnames** aggiungi due voci:

- `home.example.com` → `HTTP` → `localhost:80`
- `*.example.com` → `HTTP` → `localhost:80`

Se cloudflared gira in un container Docker senza `network_mode: host`, sostituisci
`localhost` con l'indirizzo IP LAN del dispositivo.

> Puoi anche puntare a `https://localhost:443`: in quel caso abilita
> **No TLS Verify**, perché il certificato locale di ArcbaseOS non copre il tuo dominio.

## Certificati HTTPS di Cloudflare

Il certificato gratuito *Universal SSL* copre solo il dominio radice e **un**
livello di sottodominio (`*.example.com`). Quindi:

- dashboard su `home.example.com` → app su `{app}.example.com`: funziona subito
  (configurazione consigliata);
- dashboard su `home.example.com` → app su `{app}.home.example.com` (modello
  vuoto): richiede un certificato *Advanced* (Advanced Certificate Manager o Total TLS).

Un'app con lo stesso nome del dominio della dashboard (es. un'app `home` con la
dashboard su `home.example.com`) non è raggiungibile sul dominio: vince la dashboard.

## Sicurezza

- Le app con il login di ArcbaseOS restano protette: il cookie di ogni app viene
  impostato sul suo nome host tramite il passaggio dal login sul dominio della
  dashboard.
- Le app **senza** login di ArcbaseOS (app che espongono direttamente la propria
  porta, o per cui hai disattivato il login) non sono servite sul dominio finché
  non le selezioni una per una nel pannello. Una volta selezionate sono
  **pubbliche su Internet**: valuta bene prima di farlo.
- Gli header con l'indirizzo del client inviati da Cloudflare (`X-Forwarded-For`,
  `CF-Connecting-IP`, …) vengono rimossi prima di arrivare alle app.
- Considera di aggiungere [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  davanti al tunnel per un ulteriore livello di autenticazione.
- La porta 2000 e le porte delle app non vengono mai esposte dal tunnel.
