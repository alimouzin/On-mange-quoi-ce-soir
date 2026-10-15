# 🍽️ On mange quoi ce soir ?

Site privé pour garder une liste d'idées de repas, choisir quoi manger et préparer la liste de courses.

## Fonctionnalités

- **Repas** : type (repas complet, viande ou accompagnement), nom, ingrédients (avec quantités), date de dernière fois mangé, notes et moments adaptés
  (tous les soirs + samedi midi + dimanche midi).
- **Choisir** : propose un repas adapté au moment choisi (par défaut le prochain) : un repas complet ou un duo **viande + accompagnement** combiné automatiquement, en favorisant ceux
  qu'on n'a pas mangés depuis longtemps ou jamais. « Autre idée », « Autre viande » / « Autre accompagnement » (on garde l'un et on change l'autre), « On mange ça ! » (met à jour la date).
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
| `APP_PASSWORD` | Mot de passe (authentification HTTP Basic, n'importe quel identifiant) | aucun → écoute **uniquement** sur 127.0.0.1 |
| `PORT` / `HOST` | Port / interface d'écoute | `3000` / `0.0.0.0` si mot de passe |
| `DATA_FILE` | Fichier de données JSON | `data/data.json` |

Les données sont dans un simple fichier JSON (`data/`, ignoré par git) : pensez à le sauvegarder.
Pour un usage hors de la maison, placez le site derrière HTTPS (reverse proxy), car Basic Auth
transmet le mot de passe en clair sans TLS.
