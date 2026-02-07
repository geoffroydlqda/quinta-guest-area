import { useState, useCallback, useEffect } from 'react';
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

  // Load guest profile and tool statuses
  const loadProfile = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    
    try {
      // Fetch or create guest profile
      let { data: profileData, error: profileError } = await supabase
        .from('guest_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (profileError) throw profileError;
      
      if (!profileData) {
        // Create new profile
        const { data: newProfile, error: createError } = await supabase
          .from('guest_profiles')
          .insert({
            user_id: user.id,
            full_name: user.user_metadata?.full_name || '',
            email: user.email || '',
            guests_count: 1,
          })
          .select()
          .single();
        
        if (createError) throw createError;
        profileData = newProfile;
      }
      
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
      console.error('Error loading profile:', error);
      toast({
        title: 'Error',
        description: 'Failed to load your profile.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user, loadProfile]);

  // Complete profile with first/last name
  const completeProfile = useCallback(async (firstName: string, lastName: string) => {
    if (!user || !profile) return false;
    
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
      
      setProfile(prev => prev ? {
        ...prev,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
      } : null);
      
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
