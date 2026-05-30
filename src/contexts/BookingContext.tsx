import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { isAdminEmail } from '@/lib/admin';

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
}

interface BookingContextValue {
  bookings: Booking[];
  bookingsPersonal: Booking[];
  activeBookingId: string | null;
  activeBooking: Booking | null;
  isLoading: boolean;
  setActiveBookingId: (id: string | null) => void;
  refresh: () => Promise<void>;
  // Admin impersonation
  isImpersonating: boolean;
  impersonatedBooking: Booking | null;
  exitImpersonation: () => void;
}

const STORAGE_KEY = 'qda_active_booking_id';

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

export function BookingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeBookingId, setActiveBookingIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [impersonatedBooking, setImpersonatedBooking] = useState<Booking | null>(null);

  const isAdmin = useMemo(() => isAdminEmail(user?.email), [user?.email]);
  const impersonateId = useMemo(() => {
    if (!isAdmin) return null;
    const p = new URLSearchParams(location.search);
    return p.get('impersonate');
  }, [isAdmin, location.search]);

  const setActiveBookingId = useCallback((id: string | null) => {
    setActiveBookingIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

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

  // Load impersonated booking (admin only)
  useEffect(() => {
    let cancelled = false;
    if (!impersonateId) {
      setImpersonatedBooking(null);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', impersonateId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('[BookingContext] failed to load impersonated booking', error);
        setImpersonatedBooking(null);
        return;
      }
      setImpersonatedBooking((data as Booking | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [impersonateId]);

  const isImpersonating = !!impersonateId && !!impersonatedBooking;

  const exitImpersonation = useCallback(() => {
    setImpersonatedBooking(null);
    navigate('/admin');
  }, [navigate]);

  const personalActive = bookings.find((b) => b.id === activeBookingId) ?? null;
  const activeBooking: Booking | null = isImpersonating ? impersonatedBooking : personalActive;
  const effectiveActiveBookingId = isImpersonating ? (impersonatedBooking?.id ?? null) : activeBookingId;
  const bookingsPersonal = useMemo(() => bookings.filter((b) => !b.admin_managed), [bookings]);

  return (
    <BookingContext.Provider
      value={{
        bookings,
        bookingsPersonal,
        activeBookingId: effectiveActiveBookingId,
        activeBooking,
        isLoading,
        setActiveBookingId,
        refresh: loadBookings,
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
