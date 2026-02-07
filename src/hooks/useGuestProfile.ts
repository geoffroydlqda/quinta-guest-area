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
          })
          .select()
          .single();
        
        if (createError) throw createError;
        profileData = newProfile;
      }
      
      setProfile(profileData as GuestProfile);
      
      // Fetch room setup status
      const { data: roomData } = await supabase
        .from('room_setups')
        .select('status')
        .eq('user_id', user.id)
        .maybeSingle();
      
      // Fetch transportation status
      const { data: transportData } = await supabase
        .from('transportation_requests')
        .select('status_transportation')
        .eq('user_id', user.id)
        .maybeSingle();
      
      // Fetch food plan status
      const { data: foodData } = await supabase
        .from('food_plans')
        .select('status_food')
        .eq('user_id', user.id)
        .maybeSingle();
      
      // Fetch docs ack
      const { data: docsData } = await supabase
        .from('docs_ack')
        .select('last_viewed_at')
        .eq('user_id', user.id)
        .maybeSingle();
      
      setToolStatuses({
        roomSetup: roomData?.status as 'draft' | 'submitted' || 'not_set',
        transportation: transportData?.status_transportation as 'draft' | 'submitted' || 'not_set',
        food: foodData?.status_food as 'draft' | 'submitted' || 'not_set',
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

  // Update stay dates
  const updateStayDates = useCallback(async (checkIn: Date | null, checkOut: Date | null) => {
    if (!user || !profile) return false;
    
    try {
      const { error } = await supabase
        .from('guest_profiles')
        .update({
          check_in_date: checkIn?.toISOString().split('T')[0] || null,
          check_out_date: checkOut?.toISOString().split('T')[0] || null,
        })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setProfile(prev => prev ? {
        ...prev,
        check_in_date: checkIn?.toISOString().split('T')[0] || null,
        check_out_date: checkOut?.toISOString().split('T')[0] || null,
      } : null);
      
      toast({
        title: 'Dates saved',
        description: 'Your stay dates have been updated.',
      });
      
      return true;
    } catch (error: any) {
      console.error('Error updating dates:', error);
      toast({
        title: 'Error',
        description: 'Failed to save dates.',
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
    updateStayDates,
    updateProfile,
    refreshProfile: loadProfile,
  };
}
