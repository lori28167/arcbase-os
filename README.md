<h1 align="center">ArcbaseOS</h1>

<p align="center">
  Un sistema operativo per home server, fork di <a href="https://github.com/getumbrel/umbrel">umbrelOS</a>,
  raggiungibile anche tramite un tuo dominio instradato da <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/">Cloudflare Tunnel (cloudflared)</a>.
</p>

<br />

## Cos'è ArcbaseOS

ArcbaseOS è un fork di umbrelOS 2.0. Mantiene tutto ciò che fa umbrelOS — app store,
file, foto, backup, macchine virtuali, accesso HTTPS locale, Tor — e aggiunge:

- **Accesso tramite dominio pubblico con cloudflared.** Configura un dominio in
  *Impostazioni → Impostazioni avanzate → Dominio pubblico (Cloudflare Tunnel)* e
  la dashboard (con il login delle app) risponde su `home.example.com` e ogni app
  sul proprio nome host (es. `<app-id>.example.com`). Un tunnel instrada nomi host,
  non porte, quindi questo è ciò che rende le app utilizzabili attraverso cloudflared.
  Le app senza login di ArcbaseOS restano private finché non le rendi pubbliche
  una per una.
  Guida completa: [docs/cloudflared.md](docs/cloudflared.md).
- **Branding ArcbaseOS** nell'interfaccia e nelle traduzioni.

### Compatibilità con umbrelOS

Per restare compatibile con le app dell'[Umbrel App Store](https://github.com/getumbrel/umbrel-apps)
e con gli aggiornamenti upstream, ArcbaseOS mantiene invariati gli identificativi
interni: il demone `umbreld`, i percorsi `/home/umbrel`, la rete Docker
`umbrel_main_network`, il nome host predefinito `umbrel.local` e il formato dei
backup. Anche i nomi di prodotti e servizi di Umbrel (Umbrel Home, Umbrel Pro,
Umbrel App Store, Umbrel Private Cloud, la CA "Umbrel Local HTTPS CA") restano tali.

Per allinearsi a umbrelOS:

```sh
git remote add upstream https://github.com/getumbrel/umbrel.git
git fetch upstream master
git merge upstream/master
```

## Sviluppo

Le istruzioni di sviluppo upstream valgono anche per ArcbaseOS
(`npm run dev`, vedi [CONTRIBUTING.md](CONTRIBUTING.md)). I test del routing per
dominio si eseguono con:

```sh
cd packages/umbreld
npx vitest --run source/modules/domain-access source/modules/lan-ingress/domain-routing source/modules/app-gateway
```

## Licenza

ArcbaseOS deriva da umbrelOS ed è distribuito con la stessa licenza,
[PolyForm Noncommercial 1.0.0](LICENSE.md): puoi usarlo, modificarlo e
ridistribuirlo per uso personale e non commerciale. L'uso commerciale richiede un
accordo con Umbrel, Inc. (partner@umbrel.com).

Basato su [umbrelOS](https://github.com/getumbrel/umbrel) di Umbrel, Inc.

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-%235351FB)](LICENSE.md)
