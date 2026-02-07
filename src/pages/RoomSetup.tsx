import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRoomPlanner } from '@/hooks/useRoomPlanner';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { RoomConfiguration } from '@/components/room-planner/RoomConfiguration';
import { Summary } from '@/components/room-planner/Summary';
import { SetupUserForm } from '@/components/room-planner/SetupUserForm';
import { Loader2 } from 'lucide-react';

const RoomSetup = () => {
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

  const handleSaveAndReturn = async () => {
    await handleSave();
    navigate('/dashboard');
  };

  const handleSubmitAndReturn = async () => {
    await handleSubmit();
    // After submit, if successful, navigate to dashboard
    // The handleSubmit already sets isSubmitted to true
  };

  if (authLoading || isLoadingRecord) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ToolPageLayout
      title="Room Setup"
      description="Configure the bed types for your group's stay"
    >
      <div className="max-w-4xl mx-auto">
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
            onSave={handleSaveAndReturn}
            onSubmit={handleSubmitAndReturn}
            isLoading={isLoading}
          />
        )}
      </div>
    </ToolPageLayout>
  );
};

export default RoomSetup;