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

## 2. Le jour J : l’ordinateur du gymnase avec Tailscale Funnel

Tailscale donne une adresse **fixe**, donc on peut imprimer les QR codes à l’avance.

1. **Une seule fois**, dans la console Tailscale, onglet *Access controls*, autorisez **Funnel** pour cet ordinateur. Tailscale propose de le faire au premier lancement.
2. Au gymnase : connectez l’ordinateur au partage de connexion d’un téléphone, puis lancez :
   ```bash
   npm run en-ligne:tailscale
   ```
3. L’adresse `https://….ts.net` s’affiche, avec la clé organisateur. Ouvrez-la sur l’ordinateur : les QR codes, le portail et le grand écran l’utilisent.

Sans Tailscale, `npm run en-ligne` fait la même chose avec un tunnel Cloudflare gratuit, mais l’adresse change à chaque lancement.
