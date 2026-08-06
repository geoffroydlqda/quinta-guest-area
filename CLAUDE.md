# CLAUDE.md — Mémoire du projet Quinta do Amor Guest Area

Ce fichier est lu par Claude Code au début de chaque session. Il décrit le projet, ses conventions et ses points sensibles.

## Ce qu'est ce projet

Espace invités ("guest area") de la **Quinta do Amor** (propriété au Portugal, fuseau Europe/Lisbon). Les guests reçoivent un lien d'invitation, créent un compte, réclament leur réservation (booking) puis gèrent leur séjour : configuration de chambre, transports, repas, documents à accepter. Un espace admin permet au propriétaire (Geoffroy) de tout piloter.

Interface utilisateur en **anglais**. Communication avec le propriétaire en **français**.

## Stack et workflow

- React 18 + Vite + TypeScript + Tailwind + shadcn/ui (dans `src/components/ui/`)
- Supabase : base de données, auth, Edge Functions — projet `fnlgeeuohvethmfpsxpf` (Supabase personnel, migré depuis Lovable Cloud)
- Hébergement : Vercel, déploiement auto à chaque push sur `main` — domaine officiel **https://guest.quintamor.com** (CNAME chez Squarespace ; quinta-guest-area.vercel.app reste actif en secours)
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

## Refonte admin (juillet 2026)

- **Layout** : sidebar fixe (`AdminLayout`), police Inter (classe `.admin-ui`), pages routées `/admin` (Dashboard), `/admin/bookings|guests|payments|transportation|rooms` (`/admin/users` redirige vers guests). La guest area garde le branding typewriter.
- **Guests** (`GuestsView`) : un guest = une fiche `client_profiles` (email unique, phone/tax_number/address/nationality, RLS admin) ; chaque booking pointe vers elle via `bookings.client_id` (fallback regroupement par email). Fiche éditable, total dépensé ventilé rental/catering/extras, booking history. "Merge into…" re-pointe les bookings d'un doublon vers une autre fiche puis supprime le doublon ; Delete guest supprime les bookings (via `admin-delete-guest`, un appel par booking) puis la fiche.
- **Dashboard** : KPI + graphiques SVG maison (`DashboardCharts`, palette olive validée par le skill dataviz), sélecteur d'année.
- **Payments** (`PaymentsPage`) : échéancier global — remplace l'ancien Google Sheet de suivi. Une ligne par `payment_installment` : TVAC (`amount_due`) / HT (`amount_excl_vat`), statut, facture (bucket `invoices`), **`payment_link`** (lien Wise collé manuellement ; affiché en bouton "Pay now" dans les emails de rappel), marquer payé, rappel manuel.
- **Rappels manuels** : `payment-reminders` avec `{send_installment: id}` (admin) → type `payment_manual` dans `reminder_log` (renvoyable, hors dédoublonnage). Les emails `internal+…@quintamor.com` (bookings gérés en interne) sont exclus de tout envoi automatique.
- **Toggle rappels automatiques** : bouton Enable/Disable dans la carte (écrit `app_settings.payment_reminders` — RLS admin).

## Conventions Phase 1 (juillet 2026)

- **Rappels de paiement** : Edge Function `payment-reminders`, appelée chaque jour à 08:00 UTC par pg_cron (job `payment-reminders-daily`, authentifié par le header `x-cron-key` = `app_settings.internal.cron_key`, jamais dans le repo). **Interrupteur global** : `app_settings.payment_reminders.enabled` (false par défaut — AUCUN envoi tant que Geoffroy ne l'active pas explicitement). Cadence : J-7 avant échéance + J+3 de retard, un seul envoi par (type, échéance) grâce à `reminder_log` (index unique). Aperçu dry-run : invoquer la fonction avec `{preview: true}` (admin) — c'est ce que fait la carte "Automatic payment reminders" de l'onglet Payments.
- **Invitations** : bouton Mail dans le tableau admin → Edge Function `send-invite-email` (action manuelle uniquement, jamais automatique). Tout envoi est journalisé dans `reminder_log`.
- Le bouton guest « Submit information » a été renommé « Send summary » (choix produit : pas de verrouillage à la soumission, l'édition reste ouverte jusqu'à J-3).
- Compte sans réservation : le Dashboard affiche un écran d'explication dédié (plus de champs qui ne sauvegardent rien).

## Base de données (tables principales)

`admin_users`, `app_settings`, `pricing_settings`, `reminder_log`, `bookings`, `guest_profiles`, `room_setups`, `transportation_requests`, `transportation_trips`, `transportation_passengers`, `food_plans`, `payment_installments`, `docs_ack`, `deleted_entries_log`. Fonctions SQL : `is_admin`, `is_admin_email`. Le schéma complet est dans `src/integrations/supabase/types.ts`.

Toute modification de schéma passe par un fichier SQL dans `supabase/migrations/` (jamais de modification manuelle non versionnée).

## Edge Functions (supabase/functions/)

`admin-claim-booking`, `admin-delete-guest`, `admin-generate-invite-token`, `admin-guest-detail`, `admin-list-data`, `claim-booking`, `create-booking`, `ensure-guest-profile`, `notify-transport-pricing`, `qa-tests`, `send-guest-summary`, `payment-reminders`, `send-invite-email`, `send-room-setup-emails`, `sync-google-sheets`, `sync-transportation-calendar`, `sync-booking-calendar`, `moloni-invoice`, `stripe-checkout`, `stripe-webhook`, `revolut-bar-sync`, `revolut-sync`.

**Sync Revolut Business (`revolut-sync`, 6 août 2026)** : alimente `fin_transactions` en direct depuis l'API Business (remplace les imports CSV, qui restent en secours). OAuth par certificat X509 (expire août 2031 ; clé privée = secret Edge Function `REVOLUT_PRIVATE_KEY`, client id dans le code — non secret) ; le GET ?code= est le callback de consentement (redirect URI enregistré chez Revolut), le refresh_token vit dans `app_settings.internal.revolut_b2b_refresh_token`. Sync horaire par pg_cron (`revolut-sync-hourly`, minute 10, x-cron-key) + bouton "Sync Revolut" dans Finance (JWT admin). Ne synchronise JAMAIS avant le 2026-08-01 (l'historique jan–juil vient des imports CSV/Google Sheet — dedup_keys différents, remonter avant créerait des doublons). Dedup par id Revolut (`revapi|{id}`), classification par `fin_rules` + heuristiques, rattachement auto aux événements. Si le refresh token meurt (~90 j d'inactivité possible), le cron envoie un email de re-autorisation à hello@ (max 1/3 jours, réarmé à la reconnexion).

**Automatisation post-paiement (étape 4, 29 juil. 2026)** : `stripe-webhook` marque payé puis (LIVE uniquement, jamais cs_test, best-effort via EdgeRuntime.waitUntil) appelle `moloni-invoice` (generate) et `payment-emails` (confirmation, template serveur) avec le header `x-cron-key` (= app_settings.internal.cron_key) — ces deux fonctions acceptent cet auth interne en plus du JWT admin. Une seule fatura-recibo par session Stripe (multi-lignes), PDF joint à l'email, visible guest + admin via invoice_file_url. Si l'automatisation échoue, les boutons manuels Invoice et ✉️ restent le filet de sécurité (voir logs `[auto-invoice]` / `[auto-email]`).

**Paiements Stripe (juillet 2026)** : clé API dans `app_settings.internal.stripe_secret_key` (actuellement **sk_test** — sandbox ; swap vers sk_live après validation). `stripe-checkout` (guest ou admin) crée une Checkout Session pour une échéance (bouton Pay du Dashboard guest, carte "Next payment"). `stripe-webhook` (`verify_jwt=false`, signature `stripe-signature` vérifiée avec `app_settings.internal.stripe_webhook_secret`) marque l'échéance payée sur `checkout.session.completed`/`async_payment_succeeded` (SEPA = asynchrone, quelques jours). Principe fiscal validé avec Geoffroy : **demande de paiement = guest area + emails ; l'argent reçu déclenche la fatura-recibo Moloni** (auto-génération à brancher en mode live — étape 4, avec email de confirmation Resend + PDF joint). Jamais de génération Moloni sur un paiement test.

`sync-transportation-calendar` parle directement aux API Google (service account : secrets `GOOGLE_SA_EMAIL`/`GOOGLE_SA_PRIVATE_KEY`, calendrier partagé avec l'email du SA ; Maps Routes API via `GOOGLE_MAPS_API_KEY`, optionnelle). `sync-google-sheets` appelle encore la passerelle Lovable morte (à réécrire ou retirer).

⚠️ Elles ne se déploient PAS via le push GitHub. Depuis que les connecteurs MCP Supabase/Vercel sont branchés sur la session, utiliser `mcp__Supabase__deploy_edge_function` (et `apply_migration` pour le SQL). Si une fonction est modifiée dans le repo, penser à la redéployer. Certaines ont `verify_jwt = false` dans `supabase/config.toml` (dont `payment-reminders`, appelée par le cron avec `x-cron-key`).

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
7. **Triggers "prevent update" (bookings, transportation_trips)** : ils doivent laisser passer `service_role`/`postgres`, sinon les écritures des Edge Functions sont annulées EN SILENCE (cause des doublons calendrier de juillet 2026 : les event ids ne se sauvaient jamais, chaque backfill recréait tout). Tout nouveau trigger de ce type doit commencer par ce même garde-fou.
8. **Toute nouvelle table dans `public` DOIT activer RLS immédiatement — y compris les tables de backup** (`create table ..._backup as select ...` n'hérite PAS du RLS : cause de l'alerte critique Supabase du 3 août 2026 sur `payment_installments_backup_20260730`, exposée 6 jours). Réflexe : `enable row level security` + `revoke all ... from anon, authenticated` dans la même migration. Les WARNs restants du linter sont intentionnels : `is_admin()`/`is_admin_email()`/`check_is_admin_email()` doivent rester exécutables par anon/authenticated (appelées dans les policies RLS avec les droits de l'appelant — les révoquer casserait tout l'admin) ; `admin_users` en RLS sans policy = verrouillage voulu ; `pg_net` reste dans public (non relogeable sans risque pour les crons).
