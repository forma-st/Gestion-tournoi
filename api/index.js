// Fonction Vercel : toute l'API (/api/...) et les pages de promotion (/p/...) passent par le même code que le serveur Node.
import { handle } from '../server.js';

export default function (req, res) {
  return handle(req, res);
}
