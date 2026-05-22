# Booking-Based Guest Area — Progressive Migration Plan

This is a major architectural shift. To stay safe, I'll execute it in **5 phases**, each independently shippable and backward-compatible. I recommend approving phase-by-phase so we can QA between steps rather than landing a giant rewrite at once.

---

## Phase 1 — Foundation: `bookings` table + auto-migration

**Database**
- Create `public.bookings`:
  - `id`, `retreat_name`, `first_name`, `last_name`, `email`, `guest_count`, `check_in_date`, `check_out_date`, `payment_status` (enum: pending/deposit_paid/paid_in_full/overdue), `invitation_token` (unique), `invitation_claimed` (bool), `invitation_expires_at`, `user_id` (nullable, FK to auth.users), `created_by_admin` (bool), `internal_notes`, `created_at`, `updated_at`
- RLS: users see their own bookings (`user_id = auth.uid()`); admins see all (via existing email allowlist pattern).
- Add nullable `booking_id` column to: `food_plans`, `transportation_requests`, `transportation_trips`, `transportation_passengers`, `room_setups`, `docs_ack`.
- One-time backfill: for every existing `guest_profiles` row, create a matching `bookings` row (claimed, linked to same `user_id`) and set `booking_id` on all child rows that belong to that user.
- Trigger: when a new `guest_profile` is created (legacy path), auto-create a booking so old code keeps working.

**Outcome:** Zero user-visible change. Data is now dual-keyed (works via `user_id` *and* `booking_id`).

---

## Phase 2 — Booking context in the app

- New `BookingContext` provider exposing `activeBookingId` (persisted in localStorage).
- After login:
  - 1 booking → auto-select, go to dashboard.
  - Multiple bookings → `/bookings` selector page (cards with retreat name + dates + Open button).
- Header **stay switcher** dropdown when user has >1 booking.
- All hooks (`useGuestProfile`, `useFoodPlan`, `useTransportation`, `useRoomPlanner`, `useDocsAck`) updated to filter by `booking_id` instead of (or in addition to) `user_id`.
- Summary, costs, emails, calendar sync all read from the active booking.

**Outcome:** Single-booking users see no change. Architecture ready for multi-booking.

---

## Phase 3 — Admin "Create booking"

- New tab/button in Admin: **Create Booking**.
- Form: retreat name, first/last name, email, dates, guest count, payment status, internal notes, optional predefined room setup / transportation, deposit / balance.
- Edge function `create-booking` (admin-only): inserts booking with generated `invitation_token`, returns invitation link.
- Admin dashboard list switches from "guests" to "bookings" (same email can appear multiple times). Existing categorization (upcoming/live/past) reused on booking dates.

---

## Phase 4 — Invitation flow

- Public route `/invite/:token`:
  - Edge function `get-invitation` returns booking preview (name, retreat, dates) — no auth required.
  - "Welcome {first_name}" page → Continue with Google OR email/password signup/login.
  - On successful auth, edge function `claim-booking` validates token, sets `booking.user_id = auth.uid()`, `invitation_claimed = true`. Rejects if already claimed or expired.
- Optional email send via Resend with the invitation link.

---

## Phase 5 — Polish & payment status

- Payment status badges in admin + guest dashboard.
- Email templates reference specific booking (retreat name + dates in subject/body).
- Calendar sync events tagged with retreat name.
- Booking-scoped deadlines/lock dates already work since dates live on the booking.

---

## Technical Details

**Backward compatibility strategy**
- `booking_id` is nullable everywhere during migration. Hooks fall back to `user_id`-only queries if no active booking is set (legacy users mid-migration).
- The auto-created booking from `guest_profiles` backfill means every existing user immediately has exactly 1 booking → flows through the "auto-select" path → identical UX.

**Security**
- RLS on `bookings`: `user_id = auth.uid()` for select/update; insert only via admin edge function.
- Invitation tokens: 32-byte random, unique index, single-use, optional 30-day expiry.
- Claim endpoint validates: token exists, not claimed, not expired, email match optional (warn but allow).

**Files to add (Phase 1+2)**
- migration: `bookings` table + backfill + `booking_id` columns
- `src/contexts/BookingContext.tsx`
- `src/pages/BookingSelector.tsx`
- `src/components/guest-area/StaySwitcher.tsx`
- updates to all hooks + `GuestAreaHeader`

**Files to add (Phase 3+4)**
- `src/components/admin/CreateBookingDialog.tsx`
- `src/pages/Invite.tsx`
- edge functions: `create-booking`, `get-invitation`, `claim-booking`

---

## Recommendation

Approve **Phase 1 only** first. It's the foundation, fully invisible to users, and lets us verify the backfill before building UI on top. I'll come back with phase 2 once phase 1 is green.

Reply "approve phase 1" to proceed, or tell me to plan/execute differently (e.g., do all phases in one go, skip a phase, change field names).
