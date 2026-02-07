import { useRoomPlanner } from '@/hooks/useRoomPlanner';
import { Header } from '@/components/room-planner/Header';
import { UserForm } from '@/components/room-planner/UserForm';
import { RoomConfiguration } from '@/components/room-planner/RoomConfiguration';
import { Summary } from '@/components/room-planner/Summary';

const Index = () => {
  const {
    currentStep,
    setCurrentStep,
    userInfo,
    setUserInfo,
    roomSelection,
    isSubmitted,
    isSaved,
    editUrl,
    stats,
    isEmailValid,
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
    resetAll,
  } = useRoomPlanner();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        {currentStep === 'form' && (
          <UserForm
            userInfo={userInfo}
            setUserInfo={setUserInfo}
            isEmailValid={isEmailValid}
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
            editUrl={editUrl}
            canSubmit={canSubmit}
            onPrev={() => setCurrentStep('rooms')}
            onSave={handleSave}
            onSubmit={handleSubmit}
            onNewSetup={resetAll}
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

export default Index;
