# Mettre Rotation en ligne

Deux façons de faire, qui utilisent le même code :

| | **Vercel** (test par l’équipe, inscriptions en ligne) | **Ordinateur + Tailscale** (le jour J) |
|---|---|---|
| Adresse | `https://rotation-xxx.vercel.app`, fixe | `https://ordinateur.nom-du-tailnet.ts.net`, fixe |
| Mises à jour | toutes les 3 secondes environ | instantanées |
| Données | base Redis Upstash (gratuite) | fichiers `data/` sur l’ordinateur |
| Sans Internet au gymnase | non | oui (réseau local) ; en 4G via Tailscale |
| Coût | gratuit (offres Hobby) | gratuit |

## 1. Vercel : faire tester l’équipe d’organisation

1. Sur [vercel.com](https://vercel.com), cliquez sur **Add New… → Project**, puis importez le dépôt GitHub `forma-st/Gestion-tournoi`.
   - Framework : **Other** ; ne remplissez ni build ni dossier : `vercel.json` s’en charge.
2. Avant de déployer (ou juste après), ouvrez l’onglet **Storage → Create Database → Upstash for Redis** (offre gratuite), puis **Connect** au projet.
   Les variables `KV_REST_API_URL` et `KV_REST_API_TOKEN` sont ajoutées automatiquement.
3. Dans **Settings → Environment Variables**, ajoutez **`ADMIN_KEY`** : une clé de votre choix, que vous donnez à ceux qui ont le droit de créer des tournois.
4. Cliquez sur **Deploy** (ou *Redeploy* si vous avez ajouté les variables après coup).
5. Partagez l’adresse **de production** (`…vercel.app`) avec l’équipe.
   Les adresses de *preview* (une par pull request) sont protégées par la connexion Vercel. Pour les ouvrir à l’équipe, désactivez *Deployment Protection* dans *Settings*.

Chaque fusion dans `main` redéploie automatiquement. Une pull request ouverte a sa propre adresse de test, pratique pour essayer une modification avant de la fusionner.

Bon à savoir :
- Les pages se mettent à jour toutes les 3 secondes, et seulement quand elles sont à l’écran : la consommation reste faible.
- Les écritures simultanées sont sûres : si deux téléphones enregistrent en même temps, le second est rejoué sur la version à jour. Ça a été testé avec 18 scores envoyés au même instant.
- Les quotas gratuits sont largement suffisants pour des tests. Pour un tournoi de 100 personnes connectées toute une soirée, l’ordinateur du gymnase (ci-dessous) est plus sûr.
- Pour passer d’un hébergement à l’autre, faites une sauvegarde JSON (onglet *Bilan*) d’un côté, puis restaurez-la de l’autre.

## 2. Le jour J : le Mac de l’organisation

C’est la configuration recommandée pour la soirée : pas de quota, mises à jour instantanées, données sur le disque du Mac.
Tailscale donne une adresse **fixe**, donc les QR codes peuvent être imprimés à l’avance.

### Une seule fois

1. Installer **Node.js** (version LTS) depuis [nodejs.org](https://nodejs.org).
2. Récupérer le projet sur le Mac : bouton *Code → Download ZIP* sur GitHub, ou `git clone`.
3. Installer **Tailscale**, s’y connecter, puis autoriser **Funnel** pour ce Mac dans la console Tailscale, onglet *Access controls*. Tailscale le propose au premier lancement.
4. Faire un essai complet, comme le jour J (ci-dessous), en ouvrant l’adresse depuis un téléphone **en 4G, Wi-Fi coupé**.

### Le jour J

1. Brancher le Mac **sur secteur** et le connecter à Internet : partage de connexion d’un téléphone ou box.
2. Double-cliquer sur **`lancer-tournoi.command`** dans le Finder. Au premier lancement, macOS peut demander une confirmation : clic droit → *Ouvrir*.
   - L’adresse `https://….ts.net` s’affiche : c’est celle des joueurs, et les QR codes l’utilisent.
   - **Sur le Mac**, ouvrez l’administration et le grand écran avec **`http://localhost:8080`**. Ils continuent de fonctionner même si Internet coupe, et les QR codes affichés gardent l’adresse publique.
   - **Laissez cette fenêtre ouverte** toute la soirée.
3. Dans le tournoi, onglet *Aperçu* → **Fiche Jour J** : imprimez-la et gardez-la à la table de marque. Elle explique quoi faire si quelque chose coince.

Ce que le lanceur fait pour vous :
- **pas de mise en veille** du Mac ni de l’écran tant que le serveur tourne (`caffeinate`) ;
- **redémarrage automatique** du serveur s’il s’arrête de façon imprévue, et du tunnel Tailscale (ou Cloudflare) s’il tombe, par exemple après une coupure 4G ;
- **sauvegarde automatique** de chaque tournoi modifié, toutes les 2 minutes, dans `data/sauvegardes/` (les 60 dernières). On peut en restaurer une depuis *Bilan & export* → « Restaurer une sauvegarde ».

Autres modes : `./lancer-tournoi.command cloudflare` (tunnel Cloudflare, adresse différente à chaque lancement) ou `./lancer-tournoi.command local` (Wi-Fi local seulement).

### Reprendre sur le Mac un tournoi préparé sur Vercel

Sur Vercel, onglet *Bilan & export* → **Sauvegarde complète (.json)**. Le fichier contient tout, logos et son compris.
Sur le Mac, page d’accueil → **Importer une sauvegarde** : le tournoi est recréé avec ses équipes et son code organisateur.
Imprimez ensuite les QR codes **depuis le Mac** : ils pointent vers l’adresse Tailscale.

### Ce qui a été vérifié

- **Charge** (`npm run test:charge`) : 150 spectateurs connectés en direct, et 9 arbitres qui marquent chacun un point toutes les demi-secondes, sur 3 terrains, pendant 60 s. Résultat : environ 14 000 requêtes, **0 erreur, 0 point perdu**. Un point est enregistré en 1 à 2 ms et le tournoi se relit en 5 ms (médiane).
- **Pannes** :
  - deux arbitres comptent le même match en même temps : les points des deux sont gardés ;
  - un téléphone perd le réseau : ses points partent à la reconnexion, sans doublon ;
  - le serveur est arrêté puis relancé en plein match : rien n’est perdu et le grand écran se remet à jour sans être rechargé.
- **Endurance** : le grand écran a tourné 5 minutes avec un point toutes les 0,4 s. La mémoire reste stable et aucun élément ne s’accumule.

Les tests automatiques (`npm test`) incluent les cas « deux arbitres », « envoi rejoué » et « rafale sur 3 terrains ».
