import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { LogOut, Edit, Send, Plus, Loader2, CheckCircle } from 'lucide-react';
import qdaLogo from '@/assets/qda-logo.png';
import type { Tables } from '@/integrations/supabase/types';

type RoomSetup = Tables<'room_setups'>;

const Dashboard = () => {
  const { user, isLoading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [roomSetup, setRoomSetup] = useState<RoomSetup | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Fetch user's room setup
  useEffect(() => {
    const fetchRoomSetup = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('room_setups')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;
        setRoomSetup(data);
      } catch (error: any) {
        console.error('Error fetching room setup:', error);
        toast({
          title: 'Error',
          description: 'Failed to load your room setup.',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (user) {
      fetchRoomSetup();
    }
  }, [user, toast]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-card/80 backdrop-blur-sm border-b border-border sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={qdaLogo} alt="Quinta do Amor" className="h-12 w-auto" />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 flex-1">
        <div className="max-w-2xl mx-auto animate-fade-up">
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl mb-3">My Room Setup</h1>
            <p className="text-muted-foreground">
              Manage your room configuration for Quinta do Amor
            </p>
          </div>

          {roomSetup ? (
            <div className="bg-card rounded-2xl shadow-elegant p-6 md:p-8 space-y-6">
              <div className="flex items-center gap-3 pb-4 border-b border-border">
                {roomSetup.status === 'submitted' ? (
                  <CheckCircle className="h-6 w-6 text-success" />
                ) : (
                  <Edit className="h-6 w-6 text-primary" />
                )}
                <div>
                  <h2 className="text-lg font-medium">
                    {roomSetup.status === 'submitted' ? 'Submitted' : 'Draft'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {roomSetup.status === 'submitted' 
                      ? 'Your room setup has been submitted'
                      : 'Your room setup is saved as a draft'
                    }
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{roomSetup.full_name}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border/50">
                  <span className="text-muted-foreground">King (en-suite) — fixed</span>
                  <span className="font-medium">2</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Queen (shared)</span>
                  <span className="font-medium">{roomSetup.queen_shared_qty}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Twins (shared)</span>
                  <span className="font-medium">{roomSetup.twins_shared_qty}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Queen (en-suite)</span>
                  <span className="font-medium">{roomSetup.queen_ensuite_qty}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Twins (en-suite)</span>
                  <span className="font-medium">{roomSetup.twins_ensuite_qty}</span>
                </div>
                {roomSetup.remarks && (
                  <div className="pt-2">
                    <span className="text-muted-foreground text-sm">Remarks</span>
                    <p className="mt-1">{roomSetup.remarks}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button asChild className="flex-1 gap-2">
                  <Link to="/setup">
                    <Edit className="h-4 w-4" />
                    Edit Setup
                  </Link>
                </Button>
                {roomSetup.status !== 'submitted' && (
                  <Button asChild variant="secondary" className="flex-1 gap-2">
                    <Link to="/setup?submit=true">
                      <Send className="h-4 w-4" />
                      Submit Final Setup
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card rounded-2xl shadow-elegant p-8 md:p-12 text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Plus className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-medium">No room setup yet</h2>
                <p className="text-muted-foreground mt-2">
                  Create your room configuration for your stay at Quinta do Amor.
                </p>
              </div>
              <Button asChild size="lg" className="gap-2">
                <Link to="/setup">
                  Start my setup
                </Link>
              </Button>
            </div>
          )}
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
