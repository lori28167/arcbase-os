# Accesso tramite dominio con Cloudflare Tunnel (cloudflared)

ArcbaseOS può essere raggiunto da Internet tramite un tuo dominio instradato da
[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
senza aprire porte sul router.

## Come funziona

Sulla rete locale ogni app è servita su una porta propria (`umbrel.local:8080`,
`umbrel.local:8081`, …) e il login delle app avviene su `umbrel.local:2000`.
Un tunnel Cloudflare invece instrada **nomi host**, non porte: `dominio:8080` non
arriverebbe mai all'app. Per questo, quando l'accesso tramite dominio è attivo,
ArcbaseOS instrada le richieste in base all'header `Host` sulla porta 80 (e 443):

| Nome host                        | Destinazione                                   |
| -------------------------------- | ---------------------------------------------- |
| `arcbase.example.com`            | Dashboard                                      |
| `auth.arcbase.example.com`       | Login delle app (equivalente della porta 2000) |
| `<app-id>.arcbase.example.com`   | L'app `<app-id>` (es. `nextcloud`, `jellyfin`) |
| qualsiasi altro host (LAN, IP)   | Comportamento normale, invariato               |

Il formato dei nomi host delle app è configurabile con un modello che contiene
`{app}`, ad esempio `{app}.arcbase.example.com` (predefinito) oppure
`{app}-home.example.com`. Il nome `auth` è riservato al login delle app.

cloudflared si collega in HTTP alla porta 80, mentre il browser usa HTTPS sul
bordo di Cloudflare. ArcbaseOS legge gli header `X-Forwarded-Proto` e
`CF-Visitor` inviati da Cloudflare **solo per i nomi host del dominio
configurato**, così cookie `Secure`, redirect di login e WebSocket usano
`https://`. Le richieste dalla LAN mantengono il loro protocollo reale.

## 1. Configura il dominio in ArcbaseOS

Apri **Impostazioni → Impostazioni avanzate → Dominio pubblico (Cloudflare Tunnel)**,
inserisci il dominio della dashboard (es. `arcbase.example.com`), lascia vuoto il
modello per usare `{app}.arcbase.example.com` e attiva l'interruttore.

Il pannello mostra anche la configurazione di cloudflared pronta da copiare.

In alternativa, dal terminale del dispositivo:

```sh
sudo umbreld client domainAccess.set.mutate --enabled true --domain arcbase.example.com
sudo umbreld client domainAccess.get.query
```

## 2. Configura il tunnel

### Tunnel gestito localmente (`config.yml`)

```yaml
tunnel: <ID-DEL-TUNNEL>
credentials-file: /etc/cloudflared/<ID-DEL-TUNNEL>.json

ingress:
  - hostname: arcbase.example.com
    service: http://localhost:80
  - hostname: "*.arcbase.example.com"
    service: http://localhost:80
  - service: http_status:404
```

Crea i record DNS (CNAME verso il tunnel) per entrambi i nomi:

```sh
cloudflared tunnel route dns <NOME-TUNNEL> arcbase.example.com
cloudflared tunnel route dns <NOME-TUNNEL> "*.arcbase.example.com"
```

### Tunnel gestito dalla dashboard Cloudflare (token)

In **Zero Trust → Networks → Tunnels → Public Hostnames** aggiungi due voci:

- `arcbase.example.com` → `HTTP` → `localhost:80`
- `*.arcbase.example.com` → `HTTP` → `localhost:80`

Se cloudflared gira in un container Docker senza `network_mode: host`, sostituisci
`localhost` con l'indirizzo IP LAN del dispositivo.

> Puoi anche puntare a `https://localhost:443`: in quel caso abilita
> **No TLS Verify**, perché il certificato locale di ArcbaseOS non copre il tuo dominio.

## Certificati HTTPS di Cloudflare

Il certificato gratuito *Universal SSL* copre solo il dominio radice e **un**
livello di sottodominio (`*.example.com`). Quindi:

- dashboard su `example.com` → app su `{app}.example.com`: funziona subito;
- dashboard su `arcbase.example.com` → app su `{app}.arcbase.example.com`: richiede
  un certificato *Advanced* (Advanced Certificate Manager o Total TLS);
- in alternativa, con la dashboard su `arcbase.example.com`, usa il modello
  `{app}-arcbase.example.com` e configura nel tunnel `*.example.com` (o i singoli
  nomi delle app), restando su un solo livello di sottodominio.

## Sicurezza

- Le app restano protette dal login di ArcbaseOS (cookie per app, impostati su
  ogni nome host dell'app tramite il passaggio di handoff da `auth.<dominio>`).
  Le app per cui hai disattivato il login di ArcbaseOS diventano **pubbliche su
  Internet**: valuta bene prima di farlo.
- Considera di aggiungere [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  davanti al tunnel per un ulteriore livello di autenticazione.
- La porta 2000 e le porte delle app non vengono mai esposte dal tunnel.
