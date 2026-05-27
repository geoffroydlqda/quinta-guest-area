import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import type { GuestProfile, ToolStatuses } from '@/types/guest';
import { formatDateForDatabase } from '@/lib/localDate';
import { triggerSheetsSync } from '@/lib/sheetsSync';

// Timeout for profile loading (8 seconds)
const PROFILE_LOAD_TIMEOUT = 8000;

interface ProfileLoadState {
  profile: GuestProfile | null;
  toolStatuses: ToolStatuses;
  isLoading: boolean;
  needsProfileCompletion: boolean;
  error: string | null;
  timedOut: boolean;
}

export function useGuestProfile() {
  const { user } = useAuth();
  const { activeBookingId, activeBooking, refresh: refreshBookings } = useActiveBooking();
  
  const [state, setState] = useState<ProfileLoadState>({
    profile: null,
    toolStatuses: {
      roomSetup: 'not_set',
      transportation: 'not_set',
      food: 'not_set',
      documentation: false,
    },
    isLoading: true,
    needsProfileCompletion: false,
    error: null,
    timedOut: false,
  });

  // Guard to prevent multiple concurrent loads
  const loadingRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);
  const previousCheckOutDateRef = useRef<string | null>(null);
  const checkOutChangeSourceRef = useRef('initial_load');

  // Ensure profile exists via server-side edge function
  const ensureProfileOnServer = useCallback(async (userId: string, metadata?: Record<string, any>) => {
    try {
      const response = await supabase.functions.invoke('ensure-guest-profile', {
        body: { metadata },
      });

      if (response.error) {
        console.error('Error from ensure-guest-profile:', response.error);
        return null;
      }

      return response.data?.profile || null;
    } catch (error) {
      console.error('Failed to call ensure-guest-profile:', error);
      return null;
    }
  }, []);

  // Fetch profile from database (after ensuring it exists)
  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('guest_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    return data;
  }, []);

  // Load tool statuses
  const loadToolStatuses = useCallback(async (userId: string, profileStatus: 'draft' | 'submitted') => {
    const isSubmitted = profileStatus === 'submitted';
    const scope = <T extends { eq: any }>(q: T) =>
      activeBookingId ? q.eq('booking_id', activeBookingId) : q.eq('user_id', userId);

    const { data: roomData } = await scope(
      supabase.from('room_setups').select('status')
    ).maybeSingle();

    const { data: tripData } = await scope(
      supabase.from('transportation_trips').select('id')
    );

    const { data: foodData } = await scope(
      supabase.from('food_plans').select('selections')
    ).maybeSingle();

    const hasFood = foodData?.selections && Array.isArray(foodData.selections) &&
      (foodData.selections as any[]).some((sel: any) =>
        sel.fullBoard || sel.breakfast || sel.lunch || sel.dinner
      );

    const { data: docsData } = await scope(
      supabase.from('docs_ack').select('last_viewed_at')
    ).maybeSingle();

    return {
      roomSetup: roomData ? (isSubmitted ? 'submitted' : 'draft') : 'not_set',
      transportation: tripData && tripData.length > 0 ? (isSubmitted ? 'submitted' : 'draft') : 'not_set',
      food: hasFood ? (isSubmitted ? 'submitted' : 'draft') : 'not_set',
      documentation: !!docsData,
    } as ToolStatuses;
  }, [activeBookingId]);

  // Main load function
  const loadProfile = useCallback(async () => {
    if (!user) {
      setState(prev => ({ ...prev, isLoading: false, profile: null }));
      return;
    }

    // Prevent concurrent loads
    if (loadingRef.current) {
      return;
    }

    // Check if we already loaded for this user
    if (hasLoadedRef.current && currentUserIdRef.current === user.id) {
      return;
    }

    loadingRef.current = true;
    currentUserIdRef.current = user.id;

    setState(prev => ({ ...prev, isLoading: true, error: null, timedOut: false }));

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (loadingRef.current) {
        console.error('Profile loading timed out after', PROFILE_LOAD_TIMEOUT, 'ms');
        setState(prev => ({
          ...prev,
          isLoading: false,
          timedOut: true,
          error: 'Profile loading timed out. Please try again.',
        }));
        loadingRef.current = false;
      }
    }, PROFILE_LOAD_TIMEOUT);

    try {
      // Step 1: Ensure profile exists on server (idempotent)
      console.log('Ensuring profile exists for user:', user.id);
      const serverProfile = await ensureProfileOnServer(user.id, user.user_metadata);

      // Step 2: Fetch profile from database (uses user's RLS context)
      let profileData = serverProfile;
      if (!profileData) {
        console.log('Server returned no profile, fetching directly...');
        profileData = await fetchProfile(user.id);
      }

      if (!profileData) {
        throw new Error('Failed to create or load profile');
      }

      // Clear timeout since we succeeded
      clearTimeout(timeoutId);

      const typedProfile: GuestProfile = {
        id: profileData.id,
        user_id: profileData.user_id,
        full_name: profileData.full_name,
        first_name: profileData.first_name || null,
        last_name: profileData.last_name || null,
        email: profileData.email,
        check_in_date: profileData.check_in_date,
        check_out_date: profileData.check_out_date,
        guests_count: profileData.guests_count ?? 1,
        submitted_at: profileData.submitted_at,
        status_overall: (profileData.status_overall as 'draft' | 'submitted') || 'draft',
        created_at: profileData.created_at,
        updated_at: profileData.updated_at,
      };

      // Step 3: Load tool statuses
      const toolStatuses = await loadToolStatuses(user.id, typedProfile.status_overall);

      // Mark as loaded
      hasLoadedRef.current = true;
      loadingRef.current = false;

      checkOutChangeSourceRef.current = 'profile_load';
      setState({
        profile: typedProfile,
        toolStatuses,
        isLoading: false,
        needsProfileCompletion: !typedProfile.first_name || !typedProfile.last_name,
        error: null,
        timedOut: false,
      });

      console.log('Profile loaded successfully');

    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('Error loading profile:', error);
      loadingRef.current = false;

      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message || 'Failed to load profile',
        timedOut: false,
      }));
    }
  }, [user, ensureProfileOnServer, fetchProfile, loadToolStatuses]);

  useEffect(() => {
    const nextCheckOutDate = state.profile?.check_out_date ?? null;

    if (
      import.meta.env.DEV &&
      previousCheckOutDateRef.current !== null &&
      previousCheckOutDateRef.current !== nextCheckOutDate
    ) {
      console.debug('[GuestProfile] check_out_date changed', {
        previousCheckOutDate: previousCheckOutDateRef.current,
        nextCheckOutDate,
        triggerSource: checkOutChangeSourceRef.current,
      });
    }

    previousCheckOutDateRef.current = nextCheckOutDate;
    checkOutChangeSourceRef.current = 'state_sync';
  }, [state.profile?.check_out_date]);

  // Initial load effect - runs once per user
  const previousBookingIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset when user changes
    if (user?.id !== currentUserIdRef.current) {
      hasLoadedRef.current = false;
      loadingRef.current = false;
    }
    // Re-load when active booking changes (tool statuses are booking-scoped)
    if (previousBookingIdRef.current !== activeBookingId) {
      hasLoadedRef.current = false;
      previousBookingIdRef.current = activeBookingId;
    }

    if (user && !hasLoadedRef.current) {
      loadProfile();
    } else if (!user) {
      setState({
        profile: null,
        toolStatuses: {
          roomSetup: 'not_set',
          transportation: 'not_set',
          food: 'not_set',
          documentation: false,
        },
        isLoading: false,
        needsProfileCompletion: false,
        error: null,
        timedOut: false,
      });
      hasLoadedRef.current = false;
      currentUserIdRef.current = null;
    }
  }, [user, activeBookingId, loadProfile]);

  // Complete profile with first/last name
  const completeProfile = useCallback(async (firstName: string, lastName: string) => {
    if (!user) return false;

    try {
      const fullName = `${firstName} ${lastName}`;

      const { error } = await supabase
        .from('guest_profiles')
        .update({
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
        })
        .eq('user_id', user.id);

      if (error) throw error;
      triggerSheetsSync();

      setState(prev => ({
        ...prev,
        profile: prev.profile ? {
          ...prev.profile,
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
        } : null,
        needsProfileCompletion: false,
      }));

      return true;
    } catch (error: any) {
      console.error('Error completing profile:', error);
      return false;
    }
  }, [user]);

  // Update check-in date
  const updateCheckInDate = useCallback(async (checkIn: Date | null) => {
    if (!user || !state.profile) return false;

    try {
      const nextCheckInDate = formatDateForDatabase(checkIn);
      const { error } = await supabase
        .from('guest_profiles')
        .update({ check_in_date: nextCheckInDate })
        .eq('user_id', user.id);

      if (error) throw error;
      triggerSheetsSync();

      checkOutChangeSourceRef.current = 'user_check_in_change';
      setState(prev => ({
        ...prev,
        profile: prev.profile ? {
          ...prev.profile,
          check_in_date: nextCheckInDate,
        } : null,
      }));

      return true;
    } catch (error: any) {
      console.error('Error updating check-in date:', error);
      return false;
    }
  }, [user, state.profile]);

  // Update check-out date
  const updateCheckOutDate = useCallback(async (checkOut: Date | null) => {
    if (!user || !state.profile) return false;

    try {
      const nextCheckOutDate = formatDateForDatabase(checkOut);
      const { error } = await supabase
        .from('guest_profiles')
        .update({ check_out_date: nextCheckOutDate })
        .eq('user_id', user.id);

      if (error) throw error;
      triggerSheetsSync();

      checkOutChangeSourceRef.current = 'user_check_out_change';
      setState(prev => ({
        ...prev,
        profile: prev.profile ? {
          ...prev.profile,
          check_out_date: nextCheckOutDate,
        } : null,
      }));

      return true;
    } catch (error: any) {
      console.error('Error updating check-out date:', error);
      return false;
    }
  }, [user, state.profile]);

  // Update guests count
  const updateGuestsCount = useCallback(async (guestsCount: number) => {
    if (!user || !state.profile) return false;

    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({ guests_count: guestsCount })
        .eq('user_id', user.id);

      if (error) throw error;
      triggerSheetsSync();

      setState(prev => ({
        ...prev,
        profile: prev.profile ? {
          ...prev.profile,
          guests_count: guestsCount,
        } : null,
      }));

      return true;
    } catch (error: any) {
      console.error('Error updating guests count:', error);
      return false;
    }
  }, [user, state.profile]);

  // Update stay info (combined)
  const updateStayInfo = useCallback(async (
    checkIn: Date | null,
    checkOut: Date | null,
    guestsCount: number
  ) => {
    if (!user || !state.profile) return false;

    try {
      const nextCheckInDate = formatDateForDatabase(checkIn);
      const nextCheckOutDate = formatDateForDatabase(checkOut);
      const { error } = await supabase
        .from('guest_profiles')
        .update({
          check_in_date: nextCheckInDate,
          check_out_date: nextCheckOutDate,
          guests_count: guestsCount,
        })
        .eq('user_id', user.id);

      if (error) throw error;
      triggerSheetsSync();

      checkOutChangeSourceRef.current = 'combined_stay_update';
      setState(prev => ({
        ...prev,
        profile: prev.profile ? {
          ...prev.profile,
          check_in_date: nextCheckInDate,
          check_out_date: nextCheckOutDate,
          guests_count: guestsCount,
        } : null,
      }));

      return true;
    } catch (error: any) {
      console.error('Error updating stay info:', error);
      return false;
    }
  }, [user, state.profile]);

  // Submit profile
  const submitProfile = useCallback(async () => {
    if (!user || !state.profile) return false;

    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({
          status_overall: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;
      triggerSheetsSync();

      setState(prev => ({
        ...prev,
        profile: prev.profile ? {
          ...prev.profile,
          status_overall: 'submitted',
          submitted_at: new Date().toISOString(),
        } : null,
      }));

      return true;
    } catch (error: any) {
      console.error('Error submitting profile:', error);
      return false;
    }
  }, [user, state.profile]);

  // Update profile name
  const updateProfile = useCallback(async (fullName: string) => {
    if (!user || !state.profile) return false;

    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({ full_name: fullName })
        .eq('user_id', user.id);

      if (error) throw error;
      triggerSheetsSync();

      setState(prev => ({
        ...prev,
        profile: prev.profile ? { ...prev.profile, full_name: fullName } : null,
      }));

      return true;
    } catch (error: any) {
      console.error('Error updating profile:', error);
      return false;
    }
  }, [user, state.profile]);

  // Retry loading
  const retryLoad = useCallback(() => {
    hasLoadedRef.current = false;
    loadingRef.current = false;
    loadProfile();
  }, [loadProfile]);

  const hasDatesSet = !!(state.profile?.check_in_date && state.profile?.check_out_date);

  return {
    profile: state.profile,
    toolStatuses: state.toolStatuses,
    isLoading: state.isLoading,
    hasDatesSet,
    needsProfileCompletion: state.needsProfileCompletion,
    error: state.error,
    timedOut: state.timedOut,
    updateStayInfo,
    updateCheckInDate,
    updateCheckOutDate,
    updateGuestsCount,
    updateProfile,
    completeProfile,
    submitProfile,
    refreshProfile: retryLoad,
    retryLoad,
  };
}
