
# Room Setups Backend Implementation Plan

## Overview
This plan creates the complete backend infrastructure to store room configuration submissions and send email notifications. The implementation will enable the "Submit Final Setup" and "Save for Later" buttons to persist data and trigger emails.

---

## What Will Be Built

### 1. Database Table: `room_setups`
A table to store all room configuration submissions with the following structure:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `edit_token` | TEXT | Unique token for edit URL |
| `email` | TEXT | User's email address |
| `full_name` | TEXT | User's full name |
| `remarks` | TEXT | Optional notes |
| `queen_shared_qty` | INTEGER | Queen beds with shared bathroom |
| `twins_shared_qty` | INTEGER | Twin beds with shared bathroom |
| `queen_ensuite_qty` | INTEGER | Queen beds with en-suite |
| `twins_ensuite_qty` | INTEGER | Twin beds with en-suite |
| `room_plan` | JSONB | Generated room assignments |
| `status` | TEXT | 'draft' or 'submitted' |
| `created_at` | TIMESTAMP | Record creation time |
| `updated_at` | TIMESTAMP | Last modification time |

Note: Participant names are not stored per project requirements.

### 2. Edge Function: `send-room-setup-emails`
A backend function that sends email notifications using Resend:

- **On Save**: Sends edit link to user email
- **On Submit**: Sends housekeeping summary to both user and admin (hello@quintamor.com)

### 3. Updated Hook: `useRoomPlanner`
Modify the existing hook to:
- Save records to the database
- Call the email edge function
- Handle loading and error states
- Support editing existing records via URL parameter

---

## Implementation Steps

### Step 1: Create Database Table
Create migration with:
- Table structure as defined above
- Row Level Security (RLS) policies for public insert/update (no auth required)
- Unique constraint on `edit_token`

### Step 2: Add RESEND_API_KEY Secret
Request the Resend API key from you to enable email sending.

### Step 3: Create Edge Function
Build `send-room-setup-emails` function that:
- Accepts room setup data as JSON payload
- Formats housekeeping summary email
- Sends to user and admin using Resend
- Returns success/error response

### Step 4: Update useRoomPlanner Hook
Modify to:
- Import Supabase client
- Add `saveToDatabase()` function
- Add `sendEmails()` function
- Update `handleSave` to save as 'draft' and send edit link email
- Update `handleSubmit` to save as 'submitted' and send summary emails
- Add loading state management
- Add error handling with toast notifications

### Step 5: Support Edit URL
Add functionality to:
- Parse `?edit=` URL parameter on page load
- Fetch existing record by edit token
- Pre-populate form with saved data

---

## Technical Details

### Database Security
Since this app doesn't require user authentication, RLS policies will allow:
- **INSERT**: Anyone can create new records
- **UPDATE**: Anyone with the matching edit_token can update
- **SELECT**: Anyone with the matching edit_token can read

### Email Content
Housekeeping summary includes:
- Room configuration totals (Queens, Twins, unset rooms)
- Individual room assignments (Room 1-11 with bed types)
- Timestamp
- Edit URL
- User remarks (if provided)

Does NOT include participant names per project requirements.

### Error Handling
- Database errors show user-friendly toast messages
- Email failures don't block submission (logged for debugging)
- Network errors provide retry guidance

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/xxx_create_room_setups.sql` | Create (via migration tool) |
| `supabase/functions/send-room-setup-emails/index.ts` | Create |
| `src/hooks/useRoomPlanner.ts` | Modify |
| `src/pages/Index.tsx` | Modify (add edit token parsing) |

---

## Prerequisites
Before implementation:
1. RESEND_API_KEY must be configured (you'll be prompted)
2. Resend domain must be verified at resend.com/domains

