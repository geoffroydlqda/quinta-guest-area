import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Calendar as CalendarIcon, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface StayDatesPickerProps {
  checkInDate: string | null;
  checkOutDate: string | null;
  onSave: (checkIn: Date | null, checkOut: Date | null) => Promise<boolean>;
}

export function StayDatesPicker({ checkInDate, checkOutDate, onSave }: StayDatesPickerProps) {
  const [checkIn, setCheckIn] = useState<Date | undefined>(
    checkInDate ? parseISO(checkInDate) : undefined
  );
  const [checkOut, setCheckOut] = useState<Date | undefined>(
    checkOutDate ? parseISO(checkOutDate) : undefined
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const currentCheckIn = checkInDate ? parseISO(checkInDate) : undefined;
    const currentCheckOut = checkOutDate ? parseISO(checkOutDate) : undefined;
    
    const changed = 
      (checkIn?.toISOString() !== currentCheckIn?.toISOString()) ||
      (checkOut?.toISOString() !== currentCheckOut?.toISOString());
    
    setHasChanges(changed);
  }, [checkIn, checkOut, checkInDate, checkOutDate]);

  const isValid = checkIn && checkOut && checkOut > checkIn;
  const hasDates = !!(checkInDate && checkOutDate);

  const handleSave = async () => {
    if (!checkIn || !checkOut) return;
    setIsSaving(true);
    const success = await onSave(checkIn, checkOut);
    if (success) {
      setHasChanges(false);
    }
    setIsSaving(false);
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <CalendarIcon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-medium">Your stay dates</h2>
          <p className="text-sm text-muted-foreground">
            When are you visiting Quinta do Amor?
          </p>
        </div>
        {hasDates && (
          <Check className="w-5 h-5 text-success ml-auto" />
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        {/* Check-in Date */}
        <div>
          <label className="text-sm text-muted-foreground mb-2 block">Check-in</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !checkIn && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {checkIn ? format(checkIn, "PPP") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={checkIn}
                onSelect={(date) => {
                  setCheckIn(date);
                  // Reset checkout if it's before or same as checkin
                  if (date && checkOut && checkOut <= date) {
                    setCheckOut(undefined);
                  }
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Check-out Date */}
        <div>
          <label className="text-sm text-muted-foreground mb-2 block">Check-out</label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !checkOut && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {checkOut ? format(checkOut, "PPP") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={checkOut}
                onSelect={setCheckOut}
                disabled={(date) => (checkIn ? date <= checkIn : false)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Validation / Save */}
      {hasChanges && isValid && (
        <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
          {isSaving ? 'Saving...' : 'Save dates'}
        </Button>
      )}

      {checkIn && checkOut && checkOut <= checkIn && (
        <div className="flex items-center gap-2 text-destructive text-sm mt-2">
          <AlertCircle className="w-4 h-4" />
          Check-out must be after check-in
        </div>
      )}

      {!hasDates && (
        <div className="mt-4 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">
                Please select your stay dates
              </p>
              <p className="text-sm text-muted-foreground">
                Food planning is only available after setting your check-in and check-out dates.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
