import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Booking {
  id: string;
  retreat_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  guest_count: number;
  check_in_date: string | null;
  check_out_date: string | null;
  payment_status: 'pending' | 'deposit_paid' | 'paid_in_full' | 'overdue';
  invitation_claimed: boolean;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  whatsapp_group_url: string | null;
  admin_managed: boolean;
  edit_lock_override: boolean;
}

interface BookingContextValue {
  bookings: Booking[];
  bookingsPersonal: Booking[];
  activeBookingId: string | null;
  activeBooking: Booking | null;
  isLoading: boolean;
  setActiveBookingId: (id: string | null) => void;
  refresh: () => Promise<void>;
  isImpersonating: boolean;
  impersonatedBooking: Booking | null;
  exitImpersonation: () => void;
}

const STORAGE_KEY = 'qda_active_booking_id';
const IMPERSONATION_KEY = 'qda_impersonate_booking_id';

const ADMIN_EMAILS = [
  'hello@quintamor.com',
  'loïs@quintamor.com',
  'lois@quintamor.com',
  '977luisferreira@gmail.com',
].map((e) => e.toLowerCase());

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

export function BookingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeBookingId, setActiveBookingIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());

  // Read URL param (re-evaluated each render)
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const urlImpersonateId = isAdmin ? params.get('impersonate') : null;

  const [impersonateId, setImpersonateId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    if (!isAdmin) return null;
    if (urlImpersonateId) return urlImpersonateId;
    return sessionStorage.getItem(IMPERSONATION_KEY);
  });
  const [impersonatedBooking, setImpersonatedBooking] = useState<Booking | null>(null);

  // Sync storage/state with URL & admin status
  useEffect(() => {
    if (!isAdmin) {
      sessionStorage.removeItem(IMPERSONATION_KEY);
      if (impersonateId !== null) setImpersonateId(null);
      return;
    }
    if (urlImpersonateId && urlImpersonateId !== impersonateId) {
      sessionStorage.setItem(IMPERSONATION_KEY, urlImpersonateId);
      setImpersonateId(urlImpersonateId);
    } else if (!urlImpersonateId && !impersonateId) {
      // Session admin arrivée après le premier rendu : restaure une éventuelle
      // impersonation en cours (sessionStorage), sinon l'initialisation l'a ratée.
      const stored = sessionStorage.getItem(IMPERSONATION_KEY);
      if (stored) setImpersonateId(stored);
    }
  }, [urlImpersonateId, isAdmin, impersonateId]);

  const setActiveBookingId = useCallback((id: string | null) => {
    setActiveBookingIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const fetchImpersonatedBooking = useCallback(async (id: string | null) => {
    if (!isAdmin || !id) {
      setImpersonatedBooking(null);
      return;
    }
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      console.error('[BookingContext] failed to load impersonated booking', error);
      setImpersonatedBooking(null);
      return;
    }
    setImpersonatedBooking(data as Booking);
  }, [isAdmin]);

  const loadBookings = useCallback(async () => {
    if (!user) {
      setBookings([]);
      setActiveBookingIdState(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('user_id', user.id)
      .order('check_in_date', { ascending: true });

    if (error) {
      console.error('[BookingContext] failed to load bookings', error);
      setBookings([]);
      setIsLoading(false);
      return;
    }

    const list = (data || []) as Booking[];
    setBookings(list);

    const stored = localStorage.getItem(STORAGE_KEY);
    const storedValid = stored && list.some((b) => b.id === stored);
    const personal = list.filter((b) => !b.admin_managed);
    if (storedValid) {
      setActiveBookingIdState(stored);
    } else if (personal.length === 1) {
      setActiveBookingIdState(personal[0].id);
      localStorage.setItem(STORAGE_KEY, personal[0].id);
    } else {
      setActiveBookingIdState(null);
      localStorage.removeItem(STORAGE_KEY);
    }
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await fetchImpersonatedBooking(impersonateId);
    })();
    return () => { cancelled = true; };
  }, [impersonateId, fetchImpersonatedBooking]);

  const refresh = useCallback(async () => {
    await loadBookings();
    if (isAdmin && impersonateId) {
      await fetchImpersonatedBooking(impersonateId);
    }
  }, [loadBookings, isAdmin, impersonateId, fetchImpersonatedBooking]);

  const exitImpersonation = useCallback(() => {
    sessionStorage.removeItem(IMPERSONATION_KEY);
    setImpersonateId(null);
    setImpersonatedBooking(null);
  }, []);

  // L'intention d'impersonation est lue de façon SYNCHRONE (URL en priorité) :
  // impersonateId (state) peut être en retard d'un rendu quand la session auth
  // arrive tard, ce qui envoyait le chargement de profil sur le mauvais chemin.
  const currentImpersonateId = isAdmin ? (urlImpersonateId ?? impersonateId) : null;
  const isImpersonating = isAdmin && !!currentImpersonateId;

  const effectiveActiveBooking = isImpersonating
    ? impersonatedBooking
    : (bookings.find((b) => b.id === activeBookingId) ?? null);

  const effectiveActiveBookingId = isImpersonating
    ? (impersonatedBooking?.id ?? currentImpersonateId)
    : activeBookingId;

  const bookingsPersonal = useMemo(() => bookings.filter((b) => !b.admin_managed), [bookings]);

  return (
    <BookingContext.Provider
      value={{
        bookings,
        bookingsPersonal,
        activeBookingId: effectiveActiveBookingId,
        activeBooking: effectiveActiveBooking,
        isLoading,
        setActiveBookingId,
        refresh,
        isImpersonating,
        impersonatedBooking,
        exitImpersonation,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function useActiveBooking() {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error('useActiveBooking must be used within BookingProvider');
  return ctx;
}
