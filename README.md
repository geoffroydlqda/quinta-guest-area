# Quinta do Amor — Guest Area

Espace invités de la Quinta do Amor : réservations, préparation des chambres, transports, repas et documentation pour les guests.

## Stack

- **Front** : React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend** : Supabase (base de données, auth, Edge Functions)
- **Hébergement** : Vercel (déploiement automatique à chaque push sur `main`)

## Développement

```bash
npm install
npm run dev      # serveur local sur le port 8080
npm run build    # build de production
npm test         # tests unitaires (vitest)
npm run lint     # eslint
```

Les variables d'environnement (URL et clé publique Supabase) sont dans `.env`.

## Déploiement

Chaque push sur la branche `main` déclenche automatiquement un déploiement Vercel.

Les Edge Functions Supabase (`supabase/functions/`) se déploient séparément avec la CLI Supabase :

```bash
supabase functions deploy <nom-de-la-fonction>
```

## Historique

Projet initialement créé avec Lovable, migré vers un workflow Claude Code + GitHub + Vercel en juillet 2026. Le tag `avant-migration-lovable` marque l'état du code avant la migration.
