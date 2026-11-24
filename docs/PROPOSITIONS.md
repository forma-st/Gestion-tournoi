# Propositions : Téléthon, tournoi fluo, buvette, cagnotte

Les chiffres viennent du moteur de l’application (`public/js/engine.js`), testés sur vos deux fichiers Excel.

## 1. Téléthon : 7 équipes, 3 sports, matchs de 8 minutes

**Aujourd’hui** (`tournoi_18_2025.xlsx`) : chaque équipe rencontre toutes les autres **dans les 3 sports** (tennis de table, dodgeball, volley).
Cela fait 63 matchs en 21 rotations, de 20:35 à 23:19, sans temps de changement de terrain : chaque équipe enchaîne 18 matchs.

**Proposition :** une rotation toutes les 10 minutes (8 min de jeu + 2 min pour changer de terrain), en gardant la règle d’or : deux équipes ne rejouent jamais ensemble dans le même sport, et chacune joue autant de fois chaque sport.

| Formule | Matchs | Matchs par équipe | Fin (début 20:30) |
|---|---:|---:|---:|
| Chacun se rencontre 1 fois (1 sport réparti équitablement) | 21 | 6 (2 par sport) | 21:40 |
| 1 fois + finale | 22 | 6 + finale | 21:50 |
| 1 fois + demi-finales et finale | 25 | 6 + 1 à 2 | 22:00 |
| **2 fois, dans 2 sports différents** | 42 | 12 (4 par sport) | 22:50 |
| **2 fois + grande finale** (réglage de l’exemple) | 43 | 12 + finale | **23:00** |
| 3 fois, tous les sports (format actuel) | 63 | 18 | 00:00 |

**Recommandation : 2 manches + une grande finale.** La soirée finit environ une heure plus tôt, chacun joue encore 12 matchs, et la soirée se termine sur un temps fort (la finale devant tout le monde, avec la cagnotte à l’écran).
Si l’ambiance retombe, l’organisateur passe à 1 manche en un clic, même le jour J tant que les matchs n’ont pas commencé (onglet *Format & planning*, tableau « Trouver la bonne durée »).

Autres réglages de l’exemple Téléthon :
- barème 3/2/1, comme dans votre fichier (le point de participation est gardé) ;
- l’équipe au repos arbitre, et c’est affiché sur sa feuille et sur l’écran ;
- inscription à 5 € minimum par joueur, encaissée à l’accueil, avec un don en plus possible.

## 2. Tournoi fluo : 18 équipes de volley, 3 terrains

**Aujourd’hui** (`tournoi_18_2026_ph1.xlsx`) : 6 poules de 3 en brassage, puis une 2e phase, puis des finales. Les classements sont recalculés à la main (bouton « Re-calcul ») et l’onglet des finales est cassé (`#REF!`).

**Intégré dans l’application** (format « Poules de 3 + niveaux ») :
1. **Brassage** : 6 poules de 3 équilibrées par niveau (serpentin). L’équipe qui ne joue pas arbitre. 18 matchs, 6 rotations.
2. **Poules de niveau** : formées automatiquement à la fin du brassage. Les 6 meilleures équipes vont en 2 poules de 3, les 6 suivantes en 2 poules, etc. 18 matchs, 6 rotations.
3. **Matchs de classement** : 1er contre 1er des deux poules jumelles pour les places 1-2, 2e contre 2e pour les places 3-4… jusqu’aux places 17-18. 9 matchs, 3 rotations. La finale se joue en dernier, sur le terrain 1.

Total : 45 matchs, **5 matchs par équipe**, toutes contre des équipes de leur niveau à partir de la 2e phase, et **un classement complet de 1 à 18**. Avec des rotations de 12 minutes : 21:00 → 00:00. À 15 équipes : 23:24.

À comparer : 3 poules de 6 + tableau final donneraient 51 matchs et une fin à 00:36, avec des écarts de niveau dans chaque poule.

## 3. Fil rouge de la soirée Téléthon

Déjà intégré :
- **« Chaque point compte »** : un partenaire s’engage sur une somme par point marqué (0,10 € dans l’exemple, avec un plafond). Le compteur tourne en direct sur le grand écran à chaque point saisi sur les téléphones. Les joueurs ont une raison de se battre sur chaque ballon, même à 8-0.
- **Paliers de défis** : à 500 €, les arbitres jouent en tutu ; à 1 000 €, le président sert les crêpes déguisé… Le prochain palier est affiché en permanence.
- **Dons en direct** : QR code de don sur l’écran ; chacun peut signaler son don (urne, Lydia, en ligne) depuis son téléphone. Après validation, « 💛 Mamie Jo : 20 € » s’affiche sur la TV.
- **Inscriptions et buvette** comptées automatiquement dans la cagnotte (bénéfice ou recette, au choix).

Idées faciles à ajouter ensuite :
- **Joker solidaire** : une équipe achète un joker (2 €) pour doubler les points d’un match ou imposer un handicap à l’adversaire (jouer à cloche-pied au dodgeball).
- **Défi des spectateurs** : pendant les pauses, un tir au but ou un service sur cible à 1 € l’essai, avec un classement à l’écran.
- **Trophée du fair-play** voté par QR code, et prix de la meilleure ambiance.
- **Match de gala** final : les gagnants contre les bénévoles, débloqué au dernier palier.

## 4. Buvette

Un module à part, ouvert sur le téléphone ou la tablette des bénévoles (QR code + code buvette), sans accès au reste.
- Caisse tactile : produits par catégorie, panier, espèces avec rendu de monnaie, carte, Lydia, chèque, « offert aux bénévoles », annulation d’une vente. Elle marche même sans réseau : les ventes partent dès le retour du réseau.
- **Matières premières** : chaque produit a sa recette (jambon-beurre = ⅓ baguette + 2 tranches de jambon + 10 g de beurre). L’application calcule la consommation, le reste et le coût de revient réel.
- **D’une année sur l’autre** : « Reprendre un autre tournoi » recopie la carte et les recettes, met les quantités consommées l’an dernier en colonne de comparaison et pré-remplit les achats (consommé + 10 %). « Liste d’achats » exporte le tout pour les courses.
- Bilan : chiffre d’affaires, bénéfice, espèces attendues dans la caisse (fond + ventes en espèces), meilleures ventes, alertes de stock bas, export CSV.

### Le TPE de la banque

Un navigateur ne peut pas piloter directement un TPE. Deux pistes :
1. **Aujourd’hui** : en mode « Carte », la caisse affiche le montant en très grand pour le taper sur le TPE, et la vente n’est enregistrée qu’après « Paiement accepté ».
2. **Liaison caisse (à étudier)** : beaucoup de TPE bancaires (Ingenico, Verifone) acceptent le protocole français **Caisse-AP** en réseau IP. Le serveur Rotation, qui tourne sur l’ordinateur du gymnase, pourrait envoyer le montant au TPE. Il faut que la banque active l’option « liaison caisse » sur votre TPE. Donnez-moi le modèle exact du TPE et la réponse de la banque, et je l’ajoute.

Alternative simple : SumUp ou un TPE Android permettent d’ouvrir l’app de paiement avec le montant pré-rempli.

## 5. Ce que les outils existants ne font pas (comparatif, novembre 2026)

| Outil | Prix | Hors ligne | Scores par les joueurs | Grand écran | Poules + finales | Double élim. | Paiement |
|---|---|---|---|---|---|---|---|
| EasyPlay (votre référence) | Gratuit (dons) | Non | Oui (PIN équipe) | Oui | Oui, + brassage par niveau | Oui | Non |
| Tournify | 40 à 120 € par événement | Non | Oui (lien) | Oui | Oui | Non | Partiel |
| Challonge | Freemium | Non | Oui | Partiel | Oui | Oui | Non |
| Toornament | Freemium / Pro | Non | Oui | Toornament TV | Oui | Oui | ? |
| Score’n’co | 49 € par tournoi | ? | Rapporteurs | Mode Clubhouse | Oui | ? | ? |
| **Rotation** | Libre | **Oui** | **QR par terrain + PIN** | **Oui + cagnotte** | **Oui + niveaux** | **Oui + repêchage** | **HelloAsso, Stripe, sur place** |

Ce que Rotation apporte en plus : hors ligne réel, multisport avec rotation équilibrée, matchs au temps et aux points sur le même tournoi, buvette avec matières premières, cagnotte solidaire en direct, accueil avec gestion des retards.
Les solutions de paiement les plus adaptées à une association : **HelloAsso** (0 % pour l’association, contribution volontaire du payeur), Stripe Payment Links (1,5 % + 0,25 €), SumUp sur place (1,75 %).

## 6. Tournois internes du club

Pour les tournois réguliers de l’année :
- **Inscription individuelle** en ligne (lien ou QR) ou sur place depuis l’onglet *Joueurs*, avec niveau 1 (débutant) à 4 (compétition) et genre (facultatif).
- Le jour J, on coche les présents. L’application propose les tailles d’équipe possibles : par exemple 25 joueurs et 3 terrains donnent 6 équipes de 4, et tous les terrains sont occupés.
- **Tirage équilibré** : serpentin par niveau (femmes et hommes répartis séparément pour la mixité), puis échanges jusqu’à ce que les totaux de niveau soient les plus proches possible. On peut refaire le tirage autant de fois qu’on veut.
- **Formules conseillées** selon l’heure de début, l’heure de fin et la durée d’une rotation : l’application essaie toutes les formules et classe celles qui tiennent dans l’horaire, les plus riches en matchs d’abord.

## 7. Prochaines étapes possibles

- Système suisse (rondes appariées par niveau), utile au-delà de 24 équipes.
- Mêlée (équipes recomposées à chaque match) pour les tournois individuels.
- Liaison TPE Caisse-AP (voir plus haut).
- Envoi des PIN et du planning par e-mail ou SMS aux capitaines.
- Hébergement en ligne (Render, Fly.io ou VPS) pour les inscriptions avant le jour J, puis bascule sur l’ordinateur du gymnase le soir même (export et import JSON déjà en place).
