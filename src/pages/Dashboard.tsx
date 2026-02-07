import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { GuestAreaHeader } from '@/components/guest-area/GuestAreaHeader';
import { StayDatesPicker } from '@/components/guest-area/StayDatesPicker';
import { ToolTile } from '@/components/guest-area/ToolTile';
import { GlobalSummary } from '@/components/guest-area/GlobalSummary';
import { Loader2 } from 'lucide-react';

const Dashboard = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { 
    profile, 
    toolStatuses, 
    isLoading, 
    hasDatesSet,
    updateStayDates,
    refreshProfile,
  } = useGuestProfile();

  const [roomSetupData, setRoomSetupData] = useState<any>(null);
  const [transportationData, setTransportationData] = useState<any>(null);
  const [foodData, setFoodData] = useState<any>(null);
  const [isEmailSending, setIsEmailSending] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Fetch summary data for submitted tools
  useEffect(() => {
    const fetchSummaryData = async () => {
      if (!user) return;

      // Fetch room setup data
      if (toolStatuses.roomSetup === 'submitted') {
        const { data } = await supabase
          .from('room_setups')
          .select('queen_shared_qty, twins_shared_qty, queen_ensuite_qty, twins_ensuite_qty')
          .eq('user_id', user.id)
          .single();
        
        if (data) {
          setRoomSetupData({
            queenSharedCount: data.queen_shared_qty,
            twinsSharedCount: data.twins_shared_qty,
            queenEnsuiteCount: data.queen_ensuite_qty,
            twinsEnsuiteCount: data.twins_ensuite_qty,
          });
        }
      }

      // Fetch transportation data
      if (toolStatuses.transportation === 'submitted') {
        const { data } = await supabase
          .from('transportation_trips')
          .select('id')
          .eq('user_id', user.id);
        
        setTransportationData({
          tripCount: data?.length || 0,
        });
      }

      // Fetch food data
      if (toolStatuses.food === 'submitted') {
        const { data } = await supabase
          .from('food_plans')
          .select('selections')
          .eq('user_id', user.id)
          .single();
        
        if (data?.selections && Array.isArray(data.selections)) {
          let fullBoardDays = 0;
          let breakfastOnlyDays = 0;
          let customDays = 0;
          
          (data.selections as any[]).forEach((sel: any) => {
            if (sel.fullBoard) {
              fullBoardDays++;
            } else if (sel.breakfast && !sel.lunch && !sel.dinner) {
              breakfastOnlyDays++;
            } else if (sel.breakfast || sel.lunch || sel.dinner) {
              customDays++;
            }
          });
          
          setFoodData({ fullBoardDays, breakfastOnlyDays, customDays });
        }
      }
    };

    fetchSummaryData();
  }, [user, toolStatuses]);

  const handleEmailSummary = async () => {
    if (!profile || !hasDatesSet) return;

    setIsEmailSending(true);

    try {
      const response = await supabase.functions.invoke('send-guest-summary', {
        body: {
          fullName: profile.full_name,
          email: profile.email,
          checkInDate: profile.check_in_date,
          checkOutDate: profile.check_out_date,
          roomSetup: toolStatuses.roomSetup === 'submitted' ? roomSetupData : null,
          transportation: toolStatuses.transportation === 'submitted' ? transportationData : null,
          food: toolStatuses.food === 'submitted' ? foodData : null,
        },
      });

      if (response.error) throw response.error;

      toast({
        title: 'Email sent',
        description: 'A copy of your summary has been sent to your email.',
      });
    } catch (error: any) {
      console.error('Error sending email:', error);
      toast({
        title: 'Error',
        description: 'Failed to send email. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsEmailSending(false);
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

          {/* Section 1: Stay Dates */}
          <StayDatesPicker
            checkInDate={profile.check_in_date}
            checkOutDate={profile.check_out_date}
            onSave={async (checkIn, checkOut) => {
              const success = await updateStayDates(checkIn, checkOut);
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
              />
              <ToolTile
                title="Transportation"
                description="Arrange taxi transfers"
                icon="transport"
                status={toolStatuses.transportation}
                href="/transportation"
              />
              <ToolTile
                title="Food"
                description="Plan your meals"
                icon="food"
                status={toolStatuses.food}
                href="/food"
                disabled={!hasDatesSet}
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
            onEmailSummary={handleEmailSummary}
            isEmailSending={isEmailSending}
          />
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