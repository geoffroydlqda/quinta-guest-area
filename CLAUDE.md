# CLAUDE.md — Mémoire du projet Quinta do Amor Guest Area

Ce fichier est lu par Claude Code au début de chaque session. Il décrit le projet, ses conventions et ses points sensibles.

## Ce qu'est ce projet

Espace invités ("guest area") de la **Quinta do Amor** (propriété au Portugal, fuseau Europe/Lisbon). Les guests reçoivent un lien d'invitation, créent un compte, réclament leur réservation (booking) puis gèrent leur séjour : configuration de chambre, transports, repas, documents à accepter. Un espace admin permet au propriétaire (Geoffroy) de tout piloter.

Interface utilisateur en **anglais**. Communication avec le propriétaire en **français**.

## Stack et workflow

- React 18 + Vite + TypeScript + Tailwind + shadcn/ui (dans `src/components/ui/`)
- Supabase : base de données, auth, Edge Functions — projet `fnlgeeuohvethmfpsxpf` (Supabase personnel, migré depuis Lovable Cloud)
- Hébergement : Vercel, déploiement auto à chaque push sur `main`
- Tests : vitest (`npm test`), lint : eslint
- **Workflow** : GitHub est la source de vérité unique. Toujours `npm run build` + `npm test` avant de pousser. Le tag `avant-migration-lovable` = état pré-migration (juillet 2026, projet créé à l'origine avec Lovable).

## Structure

- `src/pages/` — une page par route :
  - Public : `Landing` (/), `Auth` (/auth), `ForgotPassword`, `ResetPassword`, `InvitePage` (/invite/:token)
  - Guest (connecté) : `BookingSelector` (/bookings), `Dashboard` (/dashboard), `RoomSetup`, `Transportation`, `Food`, `Documentation`
  - Admin : `Admin` (/admin), `AdminGuestDetail` (/admin/guest/:guestId), `/setup`
- `src/components/` — `admin/`, `guest-area/`, `room-planner/`, `ui/` (shadcn)
- `src/contexts/AuthContext.tsx` — état d'authentification global
- `src/integrations/supabase/` — client (`client.ts`, lit les variables `VITE_SUPABASE_*` du `.env`) et types générés (`types.ts`)
- `src/lib/admin.ts` — détection des emails admin (`isAdminEmail`)
- `supabase/migrations/` — migrations SQL versionnées
- `supabase/functions/` — Edge Functions (voir ci-dessous)

## Conventions Phase 0 (juillet 2026)

- **Admins** : source de vérité = table `public.admin_users`. Les fonctions SQL `is_admin()`/`is_admin_email()` et toutes les Edge Functions la lisent. La liste dans `src/lib/admin.ts` est purement cosmétique (redirections front) — la tenir synchronisée.
- **Tarifs** : source de vérité = table `public.pricing_settings` (clés `taxi`, `food`). Front : `src/lib/pricing.ts` (store chargé au démarrage, getters synchrones, défauts = seed). Ne JAMAIS re-coder un prix en dur.
- Tarifs taxi en vigueur : 70 € (4 places) / 90 € (6 places) / 110 € (8 places).

## Base de données (tables principales)

`admin_users`, `pricing_settings`, `bookings`, `guest_profiles`, `room_setups`, `transportation_requests`, `transportation_trips`, `transportation_passengers`, `food_plans`, `payment_installments`, `docs_ack`, `deleted_entries_log`. Fonctions SQL : `is_admin`, `is_admin_email`. Le schéma complet est dans `src/integrations/supabase/types.ts`.

Toute modification de schéma passe par un fichier SQL dans `supabase/migrations/` (jamais de modification manuelle non versionnée).

## Edge Functions (supabase/functions/)

`admin-claim-booking`, `admin-delete-guest`, `admin-generate-invite-token`, `admin-guest-detail`, `admin-list-data`, `claim-booking`, `create-booking`, `ensure-guest-profile`, `notify-transport-pricing`, `qa-tests`, `send-guest-summary`, `send-room-setup-emails`, `sync-google-sheets`, `sync-transportation-calendar`.

⚠️ Elles ne se déploient PAS via le push GitHub : `supabase functions deploy <nom>` (CLI Supabase). Si une fonction est modifiée dans le repo, penser à la redéployer. Certaines ont `verify_jwt = false` dans `supabase/config.toml`.

## Authentification

- Email + mot de passe : natif Supabase (`signInWithPassword` / `signUp` avec first_name/last_name en metadata)
- Google : `supabase.auth.signInWithOAuth({ provider: 'google' })` — provider Google configuré directement dans Supabase (migré depuis l'ancien système Lovable Cloud auth en juillet 2026)
- Les Redirect URLs autorisées se gèrent dans Supabase → Authentication → URL Configuration

## Points sensibles / pièges connus

1. **Ne jamais réintroduire de dépendance Lovable** (`lovable-tagger`, `@lovable.dev/*`) — le projet a été volontairement dé-Lovable-isé.
2. **Ne jamais régénérer le package-lock.json depuis un environnement Lovable** — leur lockfile pointe vers un registre npm privé inaccessible.
3. `.env` est volontairement versionné : il ne contient que des valeurs publiques côté client (URL + clé anon Supabase, qui finissent de toute façon dans le bundle JS). **Aucun secret (service_role, clés API serveur) ne doit jamais y être ajouté** — les secrets des Edge Functions se gèrent dans le dashboard Supabase.
4. Le bundle JS principal dépasse 1,3 Mo (warning au build) — piste d'amélioration : code-splitting par route avec `React.lazy`.
5. `index.html` contient des URLs absolues (canonical, OG) — les mettre à jour si le domaine change.
6. C'est une app en production avec de vrais guests : privilégier les petites modifications testées, et une branche Git pour tout changement risqué.
