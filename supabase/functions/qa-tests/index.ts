// Health endpoint for the QA tests function. Returns OK so the function has
// a serve() entrypoint; the real value is in `backfill_test.ts` alongside it.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
serve(() => new Response("qa-tests ok", { status: 200 }));
