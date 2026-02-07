import { useState, useEffect, useRef } from 'react';
import { format, parseISO, isAfter } from 'date-fns';
import { Calendar as CalendarIcon, AlertCircle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { isEditingLocked } from '@/lib/editLock';

interface StayDatesPickerProps {
  checkInDate: string | null;
  checkOutDate: string | null;
  guestsCount: number;
  onCheckInChange: (date: Date | null) => Promise<boolean>;
  onCheckOutChange: (date: Date | null) => Promise<boolean>;
  onGuestsCountChange: (count: number) => Promise<boolean>;
}

export function StayDatesPicker({ 
  checkInDate, 
  checkOutDate, 
  guestsCount,
  onCheckInChange,
  onCheckOutChange,
  onGuestsCountChange,
}: StayDatesPickerProps) {
  // Local state for UI - sync from props
  const [localCheckIn, setLocalCheckIn] = useState<Date | undefined>(
    checkInDate ? parseISO(checkInDate) : undefined
  );
  const [localCheckOut, setLocalCheckOut] = useState<Date | undefined>(
    checkOutDate ? parseISO(checkOutDate) : undefined
  );
  const [localGuests, setLocalGuests] = useState(guestsCount || 1);
  
  const [isSavingCheckIn, setIsSavingCheckIn] = useState(false);
  const [isSavingCheckOut, setIsSavingCheckOut] = useState(false);
  const [isSavingGuests, setIsSavingGuests] = useState(false);
  
  const guestsDebounceRef = useRef<NodeJS.Timeout>();

  const isLocked = isEditingLocked(checkInDate);
  const hasDates = !!(checkInDate && checkOutDate);
  
  // Dates remain editable even when locked; only guests_count is locked

  // Sync from props when they change externally
  useEffect(() => {
    if (checkInDate) {
      setLocalCheckIn(parseISO(checkInDate));
    }
  }, [checkInDate]);

  useEffect(() => {
    if (checkOutDate) {
      setLocalCheckOut(parseISO(checkOutDate));
    }
  }, [checkOutDate]);

  useEffect(() => {
    setLocalGuests(guestsCount || 1);
  }, [guestsCount]);

  // Handle check-in date change - dates always editable (even when locked)
  const handleCheckInSelect = async (date: Date | undefined) => {
    if (!date) return;
    
    setLocalCheckIn(date);
    
    // If checkout is before or on the new checkin, clear it
    if (localCheckOut && localCheckOut <= date) {
      setLocalCheckOut(undefined);
    }
    
    setIsSavingCheckIn(true);
    await onCheckInChange(date);
    setIsSavingCheckIn(false);
  };

  // Handle check-out date change - dates always editable (even when locked)
  const handleCheckOutSelect = async (date: Date | undefined) => {
    if (!date) return;
    
    setLocalCheckOut(date);
    setIsSavingCheckOut(true);
    await onCheckOutChange(date);
    setIsSavingCheckOut(false);
  };

  // Handle guests count change with debounce
  const handleGuestsChange = (value: number) => {
    if (isLocked) return;
    
    const clampedValue = Math.min(21, Math.max(1, value));
    setLocalGuests(clampedValue);
    
    // Clear existing timeout
    if (guestsDebounceRef.current) {
      clearTimeout(guestsDebounceRef.current);
    }
    
    // Debounce the save
    guestsDebounceRef.current = setTimeout(async () => {
      setIsSavingGuests(true);
      await onGuestsCountChange(clampedValue);
      setIsSavingGuests(false);
    }, 800);
  };

  const isValid = localCheckIn && localCheckOut && isAfter(localCheckOut, localCheckIn) && localGuests >= 1 && localGuests <= 21;

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

      {isLocked && (
        <div className="rounded-xl bg-muted/50 border border-border p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              You can still change your stay dates. Other edits are locked within 5 days of check-in.
            </p>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {/* Check-in Date */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">
            Check-in <span className="text-destructive">*</span>
            {isSavingCheckIn && <Loader2 className="w-3 h-3 inline ml-2 animate-spin" />}
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-11",
                  !localCheckIn && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {localCheckIn ? format(localCheckIn, "PPP") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={localCheckIn}
                onSelect={handleCheckInSelect}
                disabled={(date) => date < new Date()}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Check-out Date */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">
            Check-out <span className="text-destructive">*</span>
            {isSavingCheckOut && <Loader2 className="w-3 h-3 inline ml-2 animate-spin" />}
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal h-11",
                  !localCheckOut && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {localCheckOut ? format(localCheckOut, "PPP") : "Select date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={localCheckOut}
                onSelect={handleCheckOutSelect}
                disabled={(date) => (localCheckIn ? date <= localCheckIn : date < new Date())}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Number of Guests */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">
            Guests <span className="text-destructive">*</span>
            {isSavingGuests && <Loader2 className="w-3 h-3 inline ml-2 animate-spin" />}
          </Label>
          <Input
            type="number"
            min={1}
            max={21}
            value={localGuests}
            onChange={(e) => handleGuestsChange(parseInt(e.target.value) || 1)}
            disabled={isLocked}
            className="h-11"
            placeholder="Number of guests"
          />
        </div>
      </div>

      {localCheckIn && localCheckOut && !isAfter(localCheckOut, localCheckIn) && (
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
