# 🍽️ On mange quoi ce soir ?

Site privé pour garder une liste d'idées de repas, choisir quoi manger et préparer la liste de courses.

## Fonctionnalités

- **Repas** : type (repas complet, viande ou accompagnement), nom, ingrédients (avec quantités), date de dernière fois mangé, notes et moments adaptés
  (tous les soirs + samedi midi + dimanche midi).
- **Calendrier** (page d'accueil) : vue par semaines à défilement horizontal continu (week-ends sur fond distinct) des repas planifiés (une date + un moment, plat et accompagnement optionnel). Toucher un « + » ouvre deux roulettes verticales infinies (plat à gauche, accompagnement à droite ; un repas complet désactive la seconde) qui ne contiennent que les repas possibles pour ce moment et cette saison. « Tout au hasard » tire à égalité, « Surprends-moi » favorise les repas pas mangés depuis longtemps, « Mangé » enregistre le repas comme mangé (aujourd'hui ou passé). Un repas planifié est ajouté automatiquement aux courses tant qu'il est à venir et pas marqué « mangé » ; « Mangé » met à jour sa date de dernière fois.
- **Courses** : on coche les repas prévus, la liste est fusionnée (quantités additionnées quand l'unité
  est la même), avec cases à cocher persistantes et bouton « Copier la liste ».

## Lancer

Node ≥ 20, aucune dépendance.

```bash
APP_PASSWORD=monmotdepasse npm start   # http://localhost:3000
npm test
```

| Variable | Rôle | Défaut |
|---|---|---|
| `APP_PASSWORD` | Mot de passe optionnel (HTTP Basic, n'importe quel identifiant) | aucun |
| `PORT` / `HOST` | Port / interface d'écoute | `3000` / `127.0.0.1` sans mot de passe, `0.0.0.0` avec |
| `DATA_FILE` | Fichier de données JSON | `data/data.json` |

## Auto-hébergement derrière Cloudflare

Sans `APP_PASSWORD`, le site n'écoute que sur `127.0.0.1` : rien n'est joignable depuis le réseau local.
Un tunnel Cloudflare lancé sur la même machine l'atteint sans problème, et la protection d'accès
(Cloudflare Access) se règle côté Cloudflare :

```bash
npm start                                          # écoute sur 127.0.0.1:3000
cloudflared tunnel --url http://localhost:3000     # ou un tunnel nommé vers http://localhost:3000
```

Pensez à créer une politique Cloudflare Access sur le nom de domaine, sinon le site est public.
Les données sont dans un simple fichier JSON (`data/`, ignoré par git) : pensez à le sauvegarder.
