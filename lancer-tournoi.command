#!/bin/bash
# Lance le serveur du tournoi sur ce Mac. Double-cliquez sur ce fichier dans le Finder
# (ou, dans le Terminal : ./lancer-tournoi.command [tailscale|cloudflare|local]).
#   tailscale  (par défaut) : adresse Internet fixe via Tailscale Funnel → QR codes imprimables à l'avance
#   cloudflare             : adresse Internet via un tunnel Cloudflare (change à chaque lancement)
#   local                  : seulement le Mac et le réseau Wi-Fi local
# Le serveur est relancé tout seul s'il s'arrête de façon imprévue. Le Mac ne se met pas en veille.
cd "$(dirname "$0")" || exit 1
MODE="${1:-tailscale}"
case "$MODE" in
  tailscale) FLAG="--tailscale" ;;
  cloudflare|tunnel) FLAG="--tunnel" ;;
  local) FLAG="" ;;
  *) echo "Mode inconnu : $MODE (tailscale, cloudflare ou local)"; exit 1 ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé : téléchargez la version LTS sur https://nodejs.org puis relancez."
  read -r -p "Appuyez sur Entrée pour fermer."
  exit 1
fi

echo ""
echo "  Serveur du tournoi ($MODE). Laissez cette fenêtre ouverte pendant tout le tournoi."
echo "  Pour arrêter : Ctrl+C (les données sont enregistrées avant l'arrêt)."
echo ""
while true; do
  node server.js $FLAG
  code=$?
  # 0 = arrêt volontaire (Ctrl+C) ; 1 = port déjà utilisé (serveur déjà lancé ailleurs)
  if [ "$code" -eq 0 ] || [ "$code" -eq 1 ]; then break; fi
  echo ""
  echo "  ⚠️  Le serveur s'est arrêté (code $code) : redémarrage dans 3 secondes… (les données sont conservées)"
  sleep 3
done
