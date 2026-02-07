import { useState, useEffect } from 'react';
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
  onSave: (checkIn: Date | null, checkOut: Date | null, guestsCount: number) => Promise<boolean>;
}

export function StayDatesPicker({ checkInDate, checkOutDate, guestsCount, onSave }: StayDatesPickerProps) {
  const [checkIn, setCheckIn] = useState<Date | undefined>(
    checkInDate ? parseISO(checkInDate) : undefined
  );
  const [checkOut, setCheckOut] = useState<Date | undefined>(
    checkOutDate ? parseISO(checkOutDate) : undefined
  );
  const [guests, setGuests] = useState(guestsCount || 1);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isLocked = isEditingLocked(checkInDate);

  useEffect(() => {
    if (checkInDate) setCheckIn(parseISO(checkInDate));
    if (checkOutDate) setCheckOut(parseISO(checkOutDate));
    if (guestsCount) setGuests(guestsCount);
  }, [checkInDate, checkOutDate, guestsCount]);

  useEffect(() => {
    const currentCheckIn = checkInDate ? parseISO(checkInDate) : undefined;
    const currentCheckOut = checkOutDate ? parseISO(checkOutDate) : undefined;
    
    const changed = 
      (checkIn?.toISOString() !== currentCheckIn?.toISOString()) ||
      (checkOut?.toISOString() !== currentCheckOut?.toISOString()) ||
      (guests !== guestsCount);
    
    setHasChanges(changed);
  }, [checkIn, checkOut, guests, checkInDate, checkOutDate, guestsCount]);

  const isValid = checkIn && checkOut && isAfter(checkOut, checkIn) && guests >= 1 && guests <= 21;
  const hasDates = !!(checkInDate && checkOutDate);

  const handleSave = async () => {
    if (!checkIn || !checkOut || isLocked) return;
    setIsSaving(true);
    const success = await onSave(checkIn, checkOut, guests);
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

      {isLocked && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Edits are locked</p>
              <p className="text-sm text-muted-foreground mt-1">
                Edits are locked within 5 days of check-in. Please contact{' '}
                <a href="mailto:hello@quintamor.com" className="text-primary hover:underline">
                  hello@quintamor.com
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {/* Check-in Date */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">
            Check-in <span className="text-destructive">*</span>
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={isLocked}
                className={cn(
                  "w-full justify-start text-left font-normal h-11",
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
                  if (date && checkOut && checkOut <= date) {
                    setCheckOut(undefined);
                  }
                }}
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
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                disabled={isLocked}
                className={cn(
                  "w-full justify-start text-left font-normal h-11",
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
                disabled={(date) => (checkIn ? date <= checkIn : date < new Date())}
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
          </Label>
          <Input
            type="number"
            min={1}
            max={21}
            value={guests}
            onChange={(e) => setGuests(Math.min(21, Math.max(1, parseInt(e.target.value) || 1)))}
            disabled={isLocked}
            className="h-11"
            placeholder="Number of guests"
          />
        </div>
      </div>

      {/* Validation / Save */}
      {hasChanges && isValid && !isLocked && (
        <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
          {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isSaving ? 'Saving...' : 'Save dates'}
        </Button>
      )}

      {checkIn && checkOut && !isAfter(checkOut, checkIn) && (
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
