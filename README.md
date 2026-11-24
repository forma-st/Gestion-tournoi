# Rotation : tournois de volley et multisport

Application web légère pour organiser un tournoi de A à Z : inscriptions, accueil, planning, feuilles de match sur téléphone par QR code, grand écran, buvette et cagnotte solidaire.
Elle fonctionne **sans Internet** : un ordinateur portable au gymnase suffit.

- Aucune dépendance à installer : Node.js seul (≥ 18).
- Environ 300 Ko de code, polices et générateur de QR code inclus.
- Application installable (PWA), qui marche hors ligne.

## Démarrer

```bash
node server.js            # ou : npm start
```

Le terminal affiche deux adresses :

- `http://localhost:8080` pour l’ordinateur de l’organisateur ;
- `http://192.168.x.x:8080` pour les téléphones et la TV, sur le même Wi-Fi. C’est cette adresse qui est mise dans les QR codes.

Options : `PORT=3000`, `DATA_DIR=/chemin/donnees`, `ADMIN_KEY=secret` (protège la création de tournois si le serveur est en ligne).

### Au gymnase, sans Internet

1. Allumez un routeur Wi-Fi de voyage, ou faites un point d’accès avec un téléphone. L’accès Internet n’est pas nécessaire.
2. Connectez l’ordinateur, lancez `node server.js`.
3. Branchez la TV ou le vidéoprojecteur sur `…/#/live/<tournoi>` (double-clic : plein écran).
4. Collez les affiches QR imprimées (onglet **Terrains & QR**) sur chaque terrain.

Si un téléphone perd le réseau, ses saisies de score et ses ventes de buvette sont gardées sur le téléphone, puis envoyées automatiquement au retour du réseau.

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
| **Feuille de match** | QR code par terrain ou par match ; grand bouton « +1 », règles rappelées, chrono, validation par les capitaines. Fonctionne hors ligne. |
| **Portail joueurs** | Matchs, « N matchs avant le vôtre », arbitrages à faire, alerte quand c’est bientôt à vous, classements, infos, buvette, message à l’organisation. Connexion par PIN d’équipe ou code bénévole. |
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
