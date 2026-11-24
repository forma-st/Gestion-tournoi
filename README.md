# Rotation : tournois de volley et multisport

Application web légère pour organiser un tournoi de A à Z : inscriptions, accueil, planning, feuilles de match sur téléphone par QR code, grand écran, buvette et cagnotte solidaire.
Les joueurs se connectent en **4G avec leur propre téléphone** (via un tunnel sécurisé depuis l’ordinateur de l’organisateur), ou sur le Wi-Fi local s’il y en a un. Les saisies continuent même quand le réseau coupe.

- Aucune dépendance à installer : Node.js seul (≥ 18).
- Environ 300 Ko de code, polices et générateur de QR code inclus.
- Application installable (PWA), qui marche hors ligne.

## Démarrer

Installez [Node.js](https://nodejs.org) (version 18 ou plus) une seule fois, téléchargez ce dépôt, puis dans son dossier :

```bash
npm run en-ligne     # accessible en 4G depuis tous les téléphones (recommandé)
npm start            # réseau local uniquement (Wi-Fi)
```

## Le jour J, sans Wi-Fi au gymnase

Chacun utilise **la 4G de son propre téléphone** : personne n’a à se connecter à un réseau.

1. **Une fois pour toutes**, installez `cloudflared` (gratuit, sans compte) : `winget install --id Cloudflare.cloudflared` sous Windows, `brew install cloudflared` sur Mac.
2. Au gymnase, activez le **partage de connexion** de votre téléphone et connectez-y l’ordinateur.
3. Lancez `npm run en-ligne`. La fenêtre affiche :
   - l’**adresse publique** `https://xxxx.trycloudflare.com` : ouvrez-la sur l’ordinateur ; les QR codes, le portail et le grand écran l’utilisent automatiquement ;
   - la **clé organisateur**, demandée seulement pour créer un tournoi depuis un autre appareil.
4. Imprimez les affiches QR des terrains **après** ce démarrage : l’adresse gratuite change à chaque lancement. Pour une adresse fixe, voir « Hébergement permanent ».
5. Branchez la TV sur `…/#/live/<tournoi>` (double-clic : plein écran).

Si la 4G est faible dans le gymnase, les scores et les ventes de buvette restent enregistrés sur les téléphones et partent dès que le signal revient. Toutes les données sont stockées sur l’ordinateur (dossier `data/`) : faites une sauvegarde JSON depuis l’onglet *Bilan* en fin de soirée.

Avec un vrai Wi-Fi sur place, `npm start` suffit : les téléphones connectés au même Wi-Fi utilisent l’adresse « Réseau local » affichée au démarrage.

### Hébergement permanent (inscriptions en ligne avant le jour J)

Pour que la page de promotion et les inscriptions soient en ligne toute l’année, déployez le même serveur chez un hébergeur Node.js ou Docker (Render, Fly.io, Railway, un VPS…) avec le `Dockerfile` fourni :

- montez un **disque persistant** sur `/data`, sinon les tournois sont perdus au redémarrage ;
- définissez `PUBLIC_URL=https://votre-adresse` et `ADMIN_KEY=une-clé-secrète`.

Les hébergements gratuits sans disque persistant ne conviennent pas.
Autre solution pour garder `npm run en-ligne` sur l’ordinateur avec une adresse fixe : un tunnel Cloudflare nommé, avec `TUNNEL_TOKEN=…` et `PUBLIC_URL=https://tournoi.votre-domaine.fr` (il faut un nom de domaine géré par Cloudflare).

Variables utiles : `PORT`, `DATA_DIR`, `PUBLIC_URL`, `ADMIN_KEY`, `TUNNEL_TOKEN`, `TRUST_PROXY=1` (derrière un proxy).

### Sans serveur (mode autonome)

`public/` peut aussi être ouvert depuis n’importe quel hébergement statique. Les données restent alors dans le navigateur : pratique pour préparer un tournoi ou faire une démo, mais les téléphones ne partagent pas les scores.

### Tests

```bash
npm test    # moteur : rotations, poules, niveaux, tableaux, classements, retards
```

## Ce que fait l’application

| Module | Contenu |
|---|---|
| **Création** | Assistant en 6 étapes avec aperçu en direct : nombre de matchs, rotations, heure de fin, matchs par équipe. Il compare aussi plusieurs formules pour tenir dans l’horaire. |
| **Formats** | Championnat, multisport compris (1 à 3 manches, chaque paire rejoue dans un sport différent) ; poules + phases finales (consolante, petite finale) ; **poules de 3 → poules de niveau → matchs de classement** ; élimination directe ; **double élimination avec repêchage**. |
| **Règles** | Aux points (sets, tie-break, 2 points d’écart, plafond) ou **au temps** (chrono partagé, nul possible). Une règle par terrain ou par sport. Barèmes : 3/1/0, FIVB, beach 2/1, **3/2/1 avec point de participation**. |
| **Planning** | Rotations, terrains, horaires, pauses ; arbitrage par l’équipe au repos ; équilibre des sports en multisport (chaque équipe joue autant de fois chaque sport). |
| **Tournoi interne** | Inscription **individuelle** en ligne ou sur place avec le niveau du joueur (1 à 4) et le genre ; **tirage d’équipes équilibrées** (niveau et mixité) selon le nombre de joueurs présents et de terrains ; **formules conseillées** pour tenir entre l’heure de début et l’heure de fin. |
| **Inscriptions** | Formulaire en ligne sans compte, liste d’attente, validation, niveau (pour équilibrer les poules), import Excel/CSV, prix par équipe ou **par joueur**. |
| **Paiement** | Lien HelloAsso, Stripe (référence transmise), SumUp, Lydia, PayPal ou sur place ; suivi payé / à payer. |
| **Accueil** | Pointage joueur par joueur, encaissement à l’entrée (espèces, carte, Lydia) avec don en plus, **équipe en retard → ses matchs sont décalés automatiquement** sans conflit. |
| **Feuille de match** | Score en direct avec **+1 / −1** par équipe, le match démarre au premier point ; règles rappelées, chrono, « Terminer le match ». Accès par le QR du terrain (affiches et **grand écran**), ou depuis le portail en choisissant son équipe. **Saisie libre** sans code pour les tournois entre amis (réglable). Fonctionne hors ligne. |
| **Portail joueurs** | On choisit son équipe : **sa poule** (classement et matchs restants), ses matchs, bouton « Score en direct » ; matchs, « N matchs avant le vôtre », arbitrages à faire, alerte quand c’est bientôt à vous, classements, infos, buvette, message à l’organisation. Connexion par PIN d’équipe ou code bénévole. |
| **Grand écran** | Terrains en direct, prochains matchs, classements, cagnotte et dons qui défilent, annonces, QR du portail. `?terrain=c1` pour un écran par terrain. |
| **Buvette** | Caisse tactile sur téléphone ou tablette (code buvette), stock, **matières premières et recettes** (pain, jambon, fromage…), coût de revient, marge, moyens de paiement, fond de caisse, rendu monnaie, **liste d’achats pour l’année suivante** et reprise d’une édition précédente. |
| **Cagnotte** | Total en direct alimenté par les dons validés, les inscriptions, la buvette et le défi « chaque point compte ». Paliers avec défis, QR de don, dons signalés depuis un téléphone. |
| **Promotion** | Page publique partageable (balises Open Graph), affiche PNG Instagram ou story avec QR d’inscription, ajout à l’agenda (.ics), partage Facebook, WhatsApp, LinkedIn. |
| **Bilan** | Statistiques (attente, arbitrages, durée réelle, écarts), export Excel (équipes, matchs, classements), CSV, sauvegarde et restauration JSON. |

## Organisation du code

```
server.js              serveur HTTP + API JSON + temps réel (SSE), sans dépendance
public/
  index.html, sw.js    application (PWA) et cache hors ligne
  css/app.css          thème (vert et blanc, couleurs du club)
  js/engine.js         moteur pur : génération, planning, classements, tableaux
  js/money.js          inscriptions, buvette, cagnotte
  js/store.js          données : serveur temps réel ou navigateur seul, file hors ligne
  js/views/*.js        écrans
test/                  tests du moteur (node --test)
docs/                  comparatif et propositions
```

Voir aussi [`docs/PROPOSITIONS.md`](docs/PROPOSITIONS.md) : optimisation du Téléthon et du tournoi fluo, fil rouge, buvette, TPE, comparatif des outils existants.
