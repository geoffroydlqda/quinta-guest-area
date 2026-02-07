import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { isEditingLocked } from '@/lib/editLock';
import { GuestAreaHeader } from '@/components/guest-area/GuestAreaHeader';
import { StayDatesPicker } from '@/components/guest-area/StayDatesPicker';
import { ToolTile } from '@/components/guest-area/ToolTile';
import { GlobalSummary } from '@/components/guest-area/GlobalSummary';
import { EditLockBanner } from '@/components/guest-area/EditLockBanner';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { CUSTOM_OFFER_TEXT } from '@/types/guest';

const Dashboard = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { 
    profile, 
    toolStatuses, 
    isLoading, 
    hasDatesSet,
    updateStayInfo,
    submitProfile,
    refreshProfile,
  } = useGuestProfile();

  const [roomSetupData, setRoomSetupData] = useState<any>(null);
  const [transportationData, setTransportationData] = useState<any>(null);
  const [foodData, setFoodData] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLocked = isEditingLocked(profile?.check_in_date || null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Fetch summary data for tools
  useEffect(() => {
    const fetchSummaryData = async () => {
      if (!user) return;

      // Fetch room setup data
      const { data: roomData } = await supabase
        .from('room_setups')
        .select('queen_shared_qty, twins_shared_qty, queen_ensuite_qty, twins_ensuite_qty')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (roomData) {
        setRoomSetupData({
          queenSharedCount: roomData.queen_shared_qty,
          twinsSharedCount: roomData.twins_shared_qty,
          queenEnsuiteCount: roomData.queen_ensuite_qty,
          twinsEnsuiteCount: roomData.twins_ensuite_qty,
        });
      }

      // Fetch transportation data with trip details
      const { data: tripData } = await supabase
        .from('transportation_trips')
        .select('id, price_estimate')
        .eq('user_id', user.id);
      
      if (tripData && tripData.length > 0) {
        let totalPrice = 0;
        let customOfferCount = 0;
        
        tripData.forEach(trip => {
          if (trip.price_estimate === CUSTOM_OFFER_TEXT) {
            customOfferCount++;
          } else {
            const priceMatch = trip.price_estimate.match(/€(\d+)/);
            if (priceMatch) {
              totalPrice += parseInt(priceMatch[1]);
            }
          }
        });
        
        setTransportationData({
          tripCount: tripData.length,
          totalPrice,
          customOfferCount,
        });
      }

      // Fetch food data
      const { data: foodPlanData } = await supabase
        .from('food_plans')
        .select('selections, diet_preference')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (foodPlanData?.selections && Array.isArray(foodPlanData.selections)) {
        let fullBoardDays = 0;
        let breakfastOnlyDays = 0;
        let customDays = 0;
        
        (foodPlanData.selections as any[]).forEach((sel: any) => {
          if (sel.fullBoard) {
            fullBoardDays++;
          } else if (sel.breakfast && !sel.lunch && !sel.dinner) {
            breakfastOnlyDays++;
          } else if (sel.breakfast || sel.lunch || sel.dinner) {
            customDays++;
          }
        });
        
        setFoodData({ 
          fullBoardDays, 
          breakfastOnlyDays, 
          customDays,
          dietPreference: foodPlanData.diet_preference,
        });
      }
    };

    fetchSummaryData();
  }, [user, toolStatuses]);

  const handleSubmitInformation = async () => {
    if (!profile || !hasDatesSet) {
      toast({
        title: 'Missing information',
        description: 'Please set your check-in and check-out dates before submitting.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Submit the profile
      await submitProfile();

      // Send summary email via edge function
      const response = await supabase.functions.invoke('send-guest-summary', {
        body: {
          fullName: profile.full_name,
          email: profile.email,
          checkInDate: profile.check_in_date,
          checkOutDate: profile.check_out_date,
          guestsCount: profile.guests_count,
          roomSetup: roomSetupData,
          transportation: transportationData,
          food: foodData,
        },
      });

      if (response.error) throw response.error;

      toast({
        title: 'Information submitted',
        description: 'A confirmation email has been sent to you.',
      });

      refreshProfile();
    } catch (error: any) {
      console.error('Error submitting:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p>Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <GuestAreaHeader />

      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-up">
          {/* Welcome */}
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl mb-2">
              Welcome{profile.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-muted-foreground">
              Manage your stay at Quinta do Amor
            </p>
          </div>

          {/* Edit Lock Banner */}
          {isLocked && <EditLockBanner />}

          {/* Section 1: Stay Dates */}
          <StayDatesPicker
            checkInDate={profile.check_in_date}
            checkOutDate={profile.check_out_date}
            guestsCount={profile.guests_count}
            onSave={async (checkIn, checkOut, guests) => {
              const success = await updateStayInfo(checkIn, checkOut, guests);
              return success;
            }}
          />

          {/* Section 2: Tool Tiles */}
          <div>
            <h2 className="text-xl font-medium mb-4">Your setup</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <ToolTile
                title="Room Setup"
                description="Configure bed types for your group"
                icon="room"
                status={toolStatuses.roomSetup}
                href="/room-setup"
                disabled={isLocked}
              />
              <ToolTile
                title="Transportation"
                description="Arrange taxi transfers"
                icon="transport"
                status={toolStatuses.transportation}
                href="/transportation"
                disabled={isLocked}
              />
              <ToolTile
                title="Food"
                description="Plan your meals"
                icon="food"
                status={toolStatuses.food}
                href="/food"
                disabled={!hasDatesSet || isLocked}
              />
              <ToolTile
                title="Documentation"
                description="Property info & house rules"
                icon="docs"
                status={toolStatuses.documentation}
                href="/documentation"
              />
            </div>
          </div>

          {/* Section 3: Global Summary */}
          <GlobalSummary
            profile={profile}
            toolStatuses={toolStatuses}
            roomSetupData={roomSetupData}
            transportationData={transportationData}
            foodData={foodData}
          />

          {/* Submit Button */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <Button
              onClick={handleSubmitInformation}
              disabled={isSubmitting || !hasDatesSet || isLocked}
              size="lg"
              className="w-full sm:w-auto gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Submit information
            </Button>
            <p className="text-sm text-muted-foreground mt-3">
              Your information can still be edited until 5 days before check-in date.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Quinta do Amor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

export default Dashboard;