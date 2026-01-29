import { EventInfo } from '@/types/room';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, Mail, Calendar, FileText } from 'lucide-react';

interface EventFormProps {
  eventInfo: EventInfo;
  setEventInfo: React.Dispatch<React.SetStateAction<EventInfo>>;
  isEmailValid: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function EventForm({
  eventInfo,
  setEventInfo,
  isEmailValid,
  onBack,
  onNext,
}: EventFormProps) {
  const handleChange = (field: keyof EventInfo, value: string) => {
    setEventInfo((prev) => ({ ...prev, [field]: value }));
  };

  const emailTouched = eventInfo.organizerEmail.length > 0;
  const emailError = emailTouched && !isEmailValid;

  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <div className="mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-primary hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Change event
        </button>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl mb-3">Event Details</h2>
        <p className="text-muted-foreground">
          Provide your contact information to save and submit your room setup
        </p>
      </div>

      <div className="bg-card rounded-2xl shadow-elegant p-6 md:p-8 space-y-6">
        {/* Event name (read-only) */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Event Name
          </Label>
          <div className="h-12 px-4 rounded-lg bg-muted flex items-center font-medium">
            {eventInfo.eventName}
          </div>
        </div>

        {/* Email - Required */}
        <div className="space-y-2">
          <Label htmlFor="organizerEmail" className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            Organizer Email <span className="text-destructive">*</span>
          </Label>
          <Input
            id="organizerEmail"
            type="email"
            placeholder="your@email.com"
            value={eventInfo.organizerEmail}
            onChange={(e) => handleChange('organizerEmail', e.target.value)}
            className={`h-12 ${emailError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
          />
          {emailError && (
            <p className="text-sm text-destructive">Please enter a valid email address</p>
          )}
          <p className="text-xs text-muted-foreground">
            Required to save your progress and receive confirmation
          </p>
        </div>

        {/* Optional fields */}
        <div className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground mb-4">Optional information</p>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stayDates" className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                Stay Dates
              </Label>
              <Input
                id="stayDates"
                placeholder="e.g., March 15-22, 2025"
                value={eventInfo.stayDates}
                onChange={(e) => handleChange('stayDates', e.target.value)}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes" className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                Notes for the Team
              </Label>
              <Textarea
                id="notes"
                placeholder="Any special requests or notes for the housekeeping team..."
                value={eventInfo.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            onClick={onNext}
            disabled={!isEmailValid}
            size="lg"
            className="gap-2"
          >
            Configure Rooms
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
