import { EVENTS } from '@/types/room';
import { Calendar } from 'lucide-react';

interface EventSelectionProps {
  onSelectEvent: (eventName: string) => void;
}

export function EventSelection({ onSelectEvent }: EventSelectionProps) {
  return (
    <div className="max-w-3xl mx-auto animate-fade-up">
      <div className="text-center mb-10">
        <h1 className="text-3xl md:text-4xl mb-3">Room Setup</h1>
        <p className="text-muted-foreground text-lg">
          Select your event to configure the room bed setup. You can save and come back later.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {EVENTS.map((eventName) => (
          <button
            key={eventName}
            className="event-card text-left"
            onClick={() => onSelectEvent(eventName)}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <span className="font-medium">{eventName}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
