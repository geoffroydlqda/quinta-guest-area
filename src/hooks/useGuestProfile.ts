import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { GuestProfile, ToolStatuses } from '@/types/guest';

export function useGuestProfile() {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [profile, setProfile] = useState<GuestProfile | null>(null);
  const [toolStatuses, setToolStatuses] = useState<ToolStatuses>({
    roomSetup: 'not_set',
    transportation: 'not_set',
    food: 'not_set',
    documentation: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [needsProfileCompletion, setNeedsProfileCompletion] = useState(false);
  
  // Track if we're currently creating a profile to prevent duplicate attempts
  const isCreatingProfile = useRef(false);

  // Ensure profile exists - use upsert for idempotency
  const ensureProfileExists = useCallback(async (userId: string, email: string, metadata?: Record<string, any>) => {
    if (isCreatingProfile.current) return null;
    isCreatingProfile.current = true;
    
    try {
      // First try to get existing profile
      const { data: existingProfile, error: selectError } = await supabase
        .from('guest_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (selectError) {
        console.error('Error checking for existing profile:', selectError);
      }
      
      if (existingProfile) {
        isCreatingProfile.current = false;
        return existingProfile;
      }
      
      // Profile doesn't exist, create one using upsert (safe to repeat)
      const firstName = metadata?.first_name || '';
      const lastName = metadata?.last_name || '';
      const fullName = metadata?.full_name || 
        (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || '');
      
      const { data: newProfile, error: upsertError } = await supabase
        .from('guest_profiles')
        .upsert({
          user_id: userId,
          email: email,
          full_name: fullName || '',
          first_name: firstName || null,
          last_name: lastName || null,
          guests_count: 1,
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false,
        })
        .select()
        .single();
      
      if (upsertError) {
        console.error('Error creating profile:', upsertError);
        // Try one more time to fetch - maybe another process created it
        const { data: retryProfile } = await supabase
          .from('guest_profiles')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        
        if (retryProfile) {
          isCreatingProfile.current = false;
          return retryProfile;
        }
        
        isCreatingProfile.current = false;
        return null;
      }
      
      isCreatingProfile.current = false;
      return newProfile;
    } catch (error) {
      console.error('Error in ensureProfileExists:', error);
      isCreatingProfile.current = false;
      return null;
    }
  }, []);

  // Load guest profile and tool statuses
  const loadProfile = useCallback(async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Ensure profile exists (upsert is idempotent)
      const profileData = await ensureProfileExists(
        user.id, 
        user.email || '', 
        user.user_metadata
      );
      
      if (!profileData) {
        // Silent retry after a short delay
        await new Promise(resolve => setTimeout(resolve, 500));
        const retryData = await ensureProfileExists(
          user.id, 
          user.email || '', 
          user.user_metadata
        );
        
        if (!retryData) {
          console.error('Failed to create or load profile after retry');
          setIsLoading(false);
          // Don't show error toast - just show loading state and allow retry
          return;
        }
        
        processProfileData(retryData);
      } else {
        processProfileData(profileData);
      }
      
    } catch (error: any) {
      console.error('Error loading profile:', error);
      // Don't show error toast - profile will be created on next attempt
      setIsLoading(false);
    }
  }, [user, ensureProfileExists]);

  // Process profile data and load tool statuses
  const processProfileData = useCallback(async (profileData: any) => {
    if (!user) return;
    
    try {
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
      
      setProfile(typedProfile);
      
      // Check if profile needs completion (no first/last name)
      setNeedsProfileCompletion(!typedProfile.first_name || !typedProfile.last_name);
      
      // Fetch room setup status
      const { data: roomData } = await supabase
        .from('room_setups')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();
      
      // Fetch transportation trips count (if any trips exist, consider it set)
      const { data: tripData } = await supabase
        .from('transportation_trips')
        .select('id')
        .eq('user_id', user.id);
      
      // Fetch food plan
      const { data: foodData } = await supabase
        .from('food_plans')
        .select('selections')
        .eq('user_id', user.id)
        .maybeSingle();
      
      // Check if food has any selections
      const hasFood = foodData?.selections && Array.isArray(foodData.selections) && 
        (foodData.selections as any[]).some((sel: any) => 
          sel.fullBoard || sel.breakfast || sel.lunch || sel.dinner
        );
      
      // Fetch docs ack
      const { data: docsData } = await supabase
        .from('docs_ack')
        .select('last_viewed_at')
        .eq('user_id', user.id)
        .maybeSingle();
      
      // Determine tool statuses - show "submitted" if overall is submitted
      const isSubmitted = typedProfile.status_overall === 'submitted';
      
      setToolStatuses({
        roomSetup: roomData ? (isSubmitted ? 'submitted' : 'draft') : 'not_set',
        transportation: tripData && tripData.length > 0 ? (isSubmitted ? 'submitted' : 'draft') : 'not_set',
        food: hasFood ? (isSubmitted ? 'submitted' : 'draft') : 'not_set',
        documentation: !!docsData,
      });
      
    } catch (error: any) {
      console.error('Error processing profile data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadProfile();
    } else {
      setProfile(null);
      setIsLoading(false);
    }
  }, [user, loadProfile]);

  // Complete profile with first/last name
  const completeProfile = useCallback(async (firstName: string, lastName: string) => {
    if (!user) return false;
    
    try {
      const fullName = `${firstName} ${lastName}`;
      
      // Use upsert to ensure profile exists and update it
      const { error } = await supabase
        .from('guest_profiles')
        .upsert({
          user_id: user.id,
          email: user.email || '',
          first_name: firstName,
          last_name: lastName,
          full_name: fullName,
          guests_count: profile?.guests_count || 1,
        }, {
          onConflict: 'user_id',
        });
      
      if (error) throw error;
      
      setProfile(prev => prev ? {
        ...prev,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
      } : {
        id: '',
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        email: user.email || '',
        check_in_date: null,
        check_out_date: null,
        guests_count: 1,
        submitted_at: null,
        status_overall: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      setNeedsProfileCompletion(false);
      return true;
    } catch (error: any) {
      console.error('Error completing profile:', error);
      return false;
    }
  }, [user, profile]);

  // Update individual field - patch update
  const updateCheckInDate = useCallback(async (checkIn: Date | null) => {
    if (!user || !profile) return false;
    
    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({ check_in_date: checkIn?.toISOString().split('T')[0] || null })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setProfile(prev => prev ? {
        ...prev,
        check_in_date: checkIn?.toISOString().split('T')[0] || null,
      } : null);
      
      return true;
    } catch (error: any) {
      console.error('Error updating check-in date:', error);
      return false;
    }
  }, [user, profile]);

  const updateCheckOutDate = useCallback(async (checkOut: Date | null) => {
    if (!user || !profile) return false;
    
    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({ check_out_date: checkOut?.toISOString().split('T')[0] || null })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setProfile(prev => prev ? {
        ...prev,
        check_out_date: checkOut?.toISOString().split('T')[0] || null,
      } : null);
      
      return true;
    } catch (error: any) {
      console.error('Error updating check-out date:', error);
      return false;
    }
  }, [user, profile]);

  const updateGuestsCount = useCallback(async (guestsCount: number) => {
    if (!user || !profile) return false;
    
    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({ guests_count: guestsCount })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setProfile(prev => prev ? {
        ...prev,
        guests_count: guestsCount,
      } : null);
      
      return true;
    } catch (error: any) {
      console.error('Error updating guests count:', error);
      return false;
    }
  }, [user, profile]);

  // Legacy combined update (still used for save button)
  const updateStayInfo = useCallback(async (
    checkIn: Date | null, 
    checkOut: Date | null,
    guestsCount: number
  ) => {
    if (!user || !profile) return false;
    
    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({
          check_in_date: checkIn?.toISOString().split('T')[0] || null,
          check_out_date: checkOut?.toISOString().split('T')[0] || null,
          guests_count: guestsCount,
        })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setProfile(prev => prev ? {
        ...prev,
        check_in_date: checkIn?.toISOString().split('T')[0] || null,
        check_out_date: checkOut?.toISOString().split('T')[0] || null,
        guests_count: guestsCount,
      } : null);
      
      toast({
        title: 'Saved',
        description: 'Your stay information has been updated.',
      });
      
      return true;
    } catch (error: any) {
      console.error('Error updating stay info:', error);
      toast({
        title: 'Error',
        description: 'Failed to save.',
        variant: 'destructive',
      });
      return false;
    }
  }, [user, profile, toast]);

  // Submit overall profile
  const submitProfile = useCallback(async () => {
    if (!user || !profile) return false;
    
    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({
          status_overall: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setProfile(prev => prev ? {
        ...prev,
        status_overall: 'submitted',
        submitted_at: new Date().toISOString(),
      } : null);
      
      return true;
    } catch (error: any) {
      console.error('Error submitting profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit.',
        variant: 'destructive',
      });
      return false;
    }
  }, [user, profile, toast]);

  // Update profile name
  const updateProfile = useCallback(async (fullName: string) => {
    if (!user || !profile) return false;
    
    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({ full_name: fullName })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setProfile(prev => prev ? { ...prev, full_name: fullName } : null);
      return true;
    } catch (error: any) {
      console.error('Error updating profile:', error);
      return false;
    }
  }, [user, profile]);

  const hasDatesSet = !!(profile?.check_in_date && profile?.check_out_date);

  return {
    profile,
    toolStatuses,
    isLoading,
    hasDatesSet,
    needsProfileCompletion,
    updateStayInfo,
    updateCheckInDate,
    updateCheckOutDate,
    updateGuestsCount,
    updateProfile,
    completeProfile,
    submitProfile,
    refreshProfile: loadProfile,
  };
}
