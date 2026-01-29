import { useRoomPlanner } from '@/hooks/useRoomPlanner';
import { Header } from '@/components/room-planner/Header';
import { StepIndicator } from '@/components/room-planner/StepIndicator';
import { ReservationForm } from '@/components/room-planner/ReservationForm';
import { RoomConfiguration } from '@/components/room-planner/RoomConfiguration';
import { Summary } from '@/components/room-planner/Summary';

const STEP_LABELS = ['Informations', 'Chambres', 'Récapitulatif'];

const Index = () => {
  const {
    currentStep,
    setCurrentStep,
    reservationInfo,
    setReservationInfo,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    isSubmitted,
    stats,
    isReservationValid,
    isRoomsValid,
    getRoomErrors,
    getDuplicateOccupants,
    updateRoom,
    resetRoom,
    handleSubmit,
  } = useRoomPlanner();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        {!isSubmitted && (
          <div className="mb-8">
            <StepIndicator
              currentStep={currentStep}
              totalSteps={3}
              labels={STEP_LABELS}
              onStepClick={(step) => {
                if (step === 1 || (step === 2 && isReservationValid) || (step === 3 && isReservationValid && isRoomsValid)) {
                  setCurrentStep(step);
                }
              }}
            />
          </div>
        )}

        {currentStep === 1 && !isSubmitted && (
          <ReservationForm
            reservationInfo={reservationInfo}
            setReservationInfo={setReservationInfo}
            isValid={isReservationValid}
            onNext={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && !isSubmitted && (
          <RoomConfiguration
            rooms={rooms}
            selectedRoomId={selectedRoomId}
            stats={stats}
            duplicates={getDuplicateOccupants()}
            isValid={isRoomsValid}
            getRoomErrors={getRoomErrors}
            onSelectRoom={setSelectedRoomId}
            onUpdateRoom={updateRoom}
            onResetRoom={resetRoom}
            onPrev={() => setCurrentStep(1)}
            onNext={() => setCurrentStep(3)}
          />
        )}

        {(currentStep === 3 || isSubmitted) && (
          <Summary
            reservationInfo={reservationInfo}
            rooms={rooms}
            stats={stats}
            isSubmitted={isSubmitted}
            onPrev={() => setCurrentStep(2)}
            onSubmit={handleSubmit}
          />
        )}
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Room Planner © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
