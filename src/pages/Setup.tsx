import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRoomPlanner } from '@/hooks/useRoomPlanner';
import { Header } from '@/components/room-planner/Header';
import { RoomConfiguration } from '@/components/room-planner/RoomConfiguration';
import { Summary } from '@/components/room-planner/Summary';
import { SetupUserForm } from '@/components/room-planner/SetupUserForm';
import { Loader2 } from 'lucide-react';

const Setup = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  
  const {
    currentStep,
    setCurrentStep,
    userInfo,
    setUserInfo,
    roomSelection,
    isSubmitted,
    isSaved,
    stats,
    isNameValid,
    isSharedValid,
    isEnsuiteValid,
    isSelectionValid,
    canSubmit,
    setQueenShared,
    setTwinsShared,
    setQueenEnsuite,
    setTwinsEnsuite,
    handleSave,
    handleSubmit,
    isLoading,
    isLoadingRecord,
  } = useRoomPlanner();

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Pre-fill email from logged-in user
  useEffect(() => {
    if (user?.email && userInfo.email !== user.email) {
      setUserInfo(prev => ({ ...prev, email: user.email || '' }));
    }
  }, [user, userInfo.email, setUserInfo]);

  if (authLoading || isLoadingRecord) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header showBackToDashboard />
      
      <main className="container mx-auto px-4 py-8">
        {currentStep === 'form' && (
          <SetupUserForm
            userInfo={userInfo}
            setUserInfo={setUserInfo}
            userEmail={user?.email || ''}
            isNameValid={isNameValid}
            onNext={() => setCurrentStep('rooms')}
          />
        )}

        {currentStep === 'rooms' && (
          <RoomConfiguration
            roomSelection={roomSelection}
            stats={stats}
            isSharedValid={isSharedValid}
            isEnsuiteValid={isEnsuiteValid}
            isSelectionValid={isSelectionValid}
            onSetQueenShared={setQueenShared}
            onSetTwinsShared={setTwinsShared}
            onSetQueenEnsuite={setQueenEnsuite}
            onSetTwinsEnsuite={setTwinsEnsuite}
            onPrev={() => setCurrentStep('form')}
            onNext={() => setCurrentStep('summary')}
          />
        )}

        {currentStep === 'summary' && (
          <Summary
            userInfo={userInfo}
            setUserInfo={setUserInfo}
            stats={stats}
            isSubmitted={isSubmitted}
            isSaved={isSaved}
            canSubmit={canSubmit}
            onPrev={() => setCurrentStep('rooms')}
            onSave={handleSave}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        )}
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Quinta do Amor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

export default Setup;
