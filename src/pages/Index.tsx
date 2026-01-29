import { useRoomPlanner } from '@/hooks/useRoomPlanner';
import { Header } from '@/components/room-planner/Header';
import { EventSelection } from '@/components/room-planner/EventSelection';
import { EventForm } from '@/components/room-planner/EventForm';
import { RoomConfiguration } from '@/components/room-planner/RoomConfiguration';
import { Summary } from '@/components/room-planner/Summary';

const Index = () => {
  const {
    currentStep,
    setCurrentStep,
    eventInfo,
    setEventInfo,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    isSubmitted,
    isSaved,
    editUrl,
    stats,
    isEmailValid,
    selectEvent,
    goBackToEvents,
    updateRoom,
    resetRoom,
    handleSave,
    handleSubmit,
    resetAll,
  } = useRoomPlanner();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        {currentStep === 'events' && (
          <EventSelection onSelectEvent={selectEvent} />
        )}

        {currentStep === 'form' && (
          <EventForm
            eventInfo={eventInfo}
            setEventInfo={setEventInfo}
            isEmailValid={isEmailValid}
            onBack={goBackToEvents}
            onNext={() => setCurrentStep('rooms')}
          />
        )}

        {currentStep === 'rooms' && (
          <RoomConfiguration
            rooms={rooms}
            selectedRoomId={selectedRoomId}
            stats={stats}
            onSelectRoom={setSelectedRoomId}
            onUpdateRoom={updateRoom}
            onResetRoom={resetRoom}
            onPrev={() => setCurrentStep('form')}
            onNext={() => setCurrentStep('summary')}
          />
        )}

        {currentStep === 'summary' && (
          <Summary
            eventInfo={eventInfo}
            rooms={rooms}
            stats={stats}
            isSubmitted={isSubmitted}
            isSaved={isSaved}
            editUrl={editUrl}
            isEmailValid={isEmailValid}
            onPrev={() => setCurrentStep('rooms')}
            onSave={handleSave}
            onSubmit={handleSubmit}
            onNewSetup={resetAll}
          />
        )}
      </main>

      <footer className="border-t border-border py-6 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Quinta Mor © {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
