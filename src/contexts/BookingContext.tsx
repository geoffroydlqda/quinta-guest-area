import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
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
}

interface BookingContextValue {
  bookings: Booking[];
  activeBookingId: string | null;
  activeBooking: Booking | null;
  isLoading: boolean;
  setActiveBookingId: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'qda_active_booking_id';

const BookingContext = createContext<BookingContextValue | undefined>(undefined);

export function BookingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [activeBookingId, setActiveBookingIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

    // Resolve active booking
    const stored = localStorage.getItem(STORAGE_KEY);
    const storedValid = stored && list.some((b) => b.id === stored);
    if (storedValid) {
      setActiveBookingIdState(stored);
    } else if (list.length === 1) {
      setActiveBookingIdState(list[0].id);
      localStorage.setItem(STORAGE_KEY, list[0].id);
    } else {
      setActiveBookingIdState(null);
      localStorage.removeItem(STORAGE_KEY);
    }
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const activeBooking = bookings.find((b) => b.id === activeBookingId) ?? null;

  return (
    <BookingContext.Provider
      value={{ bookings, activeBookingId, activeBooking, isLoading, setActiveBookingId, refresh: loadBookings }}
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
