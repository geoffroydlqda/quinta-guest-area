import { useState, useEffect, useRef, useCallback } from 'react';
import { format, isAfter } from 'date-fns';
import { Calendar as CalendarIcon, AlertCircle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { isEditingLocked } from '@/lib/editLock';
import { parseLocalDateString } from '@/lib/localDate';

interface StayDatesPickerProps {
  checkInDate: string | null;
  checkOutDate: string | null;
  guestsCount: number;
  statusOverall?: 'draft' | 'submitted' | string;
  onCheckInChange: (date: Date | null) => Promise<boolean>;
  onCheckOutChange: (date: Date | null) => Promise<boolean>;
  onGuestsCountChange: (count: number) => Promise<boolean>;
}

export function StayDatesPicker({ 
  checkInDate, 
  checkOutDate, 
  guestsCount,
  statusOverall = 'draft',
  onCheckInChange,
  onCheckOutChange,
  onGuestsCountChange,
}: StayDatesPickerProps) {
  // Local state - single source of truth for UI
  const [localCheckIn, setLocalCheckIn] = useState<Date | undefined>(() => parseLocalDateString(checkInDate));
  const [localCheckOut, setLocalCheckOut] = useState<Date | undefined>(() => parseLocalDateString(checkOutDate));
  const [localGuestsStr, setLocalGuestsStr] = useState(() => 
    guestsCount ? String(guestsCount) : ''
  );
  const [guestsError, setGuestsError] = useState<string | null>(null);
  
  const [isSavingCheckIn, setIsSavingCheckIn] = useState(false);
  const [isSavingCheckOut, setIsSavingCheckOut] = useState(false);
  const [isSavingGuests, setIsSavingGuests] = useState(false);
  
  const guestsDebounceRef = useRef<NodeJS.Timeout>();
  const isUserEditingCheckIn = useRef(false);
  const isUserEditingCheckOut = useRef(false);
  const isUserEditingGuests = useRef(false);

  const isLocked = isEditingLocked(checkInDate, statusOverall);
  const hasDates = !!(checkInDate && checkOutDate);
  
  // Sync check-in from props ONLY when not editing
  useEffect(() => {
    if (!isUserEditingCheckIn.current && checkInDate) {
      const parsed = parseLocalDateString(checkInDate);
      if (parsed && (!localCheckIn || parsed.getTime() !== localCheckIn.getTime())) {
        setLocalCheckIn(parsed);
      }
    }
  }, [checkInDate]);

  // Sync check-out from props ONLY when not editing
  useEffect(() => {
    if (!isUserEditingCheckOut.current && checkOutDate) {
      const parsed = parseLocalDateString(checkOutDate);
      if (parsed && (!localCheckOut || parsed.getTime() !== localCheckOut.getTime())) {
        setLocalCheckOut(parsed);
      }
    }
  }, [checkOutDate]);

  // Sync guests from props ONLY when not editing
  useEffect(() => {
    if (!isUserEditingGuests.current && !guestsDebounceRef.current) {
      const propStr = guestsCount ? String(guestsCount) : '';
      if (propStr !== localGuestsStr) {
        setLocalGuestsStr(propStr);
      }
    }
  }, [guestsCount]);

  // Handle check-in date change
  const handleCheckInSelect = useCallback(async (date: Date | undefined) => {
    if (!date) return;
    
    isUserEditingCheckIn.current = true;
    setLocalCheckIn(date);
    
    if (localCheckOut && localCheckOut <= date) {
      setLocalCheckOut(undefined);
    }
    
    setIsSavingCheckIn(true);
    await onCheckInChange(date);
    setIsSavingCheckIn(false);
    
    setTimeout(() => { isUserEditingCheckIn.current = false; }, 500);
  }, [localCheckOut, onCheckInChange]);

  // Handle check-out date change
  const handleCheckOutSelect = useCallback(async (date: Date | undefined) => {
    if (!date) return;
    
    isUserEditingCheckOut.current = true;
    setLocalCheckOut(date);
    
    setIsSavingCheckOut(true);
    await onCheckOutChange(date);
    setIsSavingCheckOut(false);
    
    setTimeout(() => { isUserEditingCheckOut.current = false; }, 500);
  }, [onCheckOutChange]);

  // Handle guests count change - fully controlled, no auto-clamping
  const handleGuestsChange = useCallback((rawValue: string) => {
    if (isLocked) return;
    
    isUserEditingGuests.current = true;
    setLocalGuestsStr(rawValue);
    
    // Validate
    const numValue = parseInt(rawValue, 10);
    if (rawValue === '' || isNaN(numValue)) {
      setGuestsError(null);
      // Clear existing timeout
      if (guestsDebounceRef.current) clearTimeout(guestsDebounceRef.current);
      guestsDebounceRef.current = undefined;
      isUserEditingGuests.current = false;
      return;
    }
    
    if (numValue < 1) {
      setGuestsError('Minimum 1 guest');
      isUserEditingGuests.current = false;
      return;
    }
    
    if (numValue > 22) {
      setGuestsError('Maximum 22 guests');
      isUserEditingGuests.current = false;
      return;
    }
    
    setGuestsError(null);
    
    // Clear existing timeout
    if (guestsDebounceRef.current) clearTimeout(guestsDebounceRef.current);
    
    // Debounce the save - PATCH only guests_count
    guestsDebounceRef.current = setTimeout(async () => {
      setIsSavingGuests(true);
      await onGuestsCountChange(numValue);
      setIsSavingGuests(false);
      guestsDebounceRef.current = undefined;
      isUserEditingGuests.current = false;
    }, 800);
  }, [isLocked, onGuestsCountChange]);

  const localGuestsNum = parseInt(localGuestsStr, 10);
  const isValid = localCheckIn && localCheckOut && isAfter(localCheckOut, localCheckIn) && 
    !isNaN(localGuestsNum) && localGuestsNum >= 1 && localGuestsNum <= 22;

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <CalendarIcon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-medium">Your stay dates</h2>
          <p className="text-sm text-muted-foreground">
            Set when you booked — contact us to change them
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
              Your information is finalized. Please contact{' '}
              <a href="mailto:hello@quintamor.com" className="text-primary hover:underline">hello@quintamor.com</a>{' '}
              for any changes.
            </p>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {/* Check-in Date */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">Check-in</Label>
          <div className="w-full h-11 flex items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium">
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            {localCheckIn ? format(localCheckIn, "PPP") : "To be confirmed"}
          </div>
        </div>

        {/* Check-out Date */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">Check-out</Label>
          <div className="w-full h-11 flex items-center rounded-md border border-input bg-muted/40 px-3 text-sm font-medium">
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
            {localCheckOut ? format(localCheckOut, "PPP") : "To be confirmed"}
          </div>
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
            max={22}
            value={localGuestsStr}
            onChange={(e) => handleGuestsChange(e.target.value)}
            disabled={isLocked}
            className={cn("h-11", guestsError && "border-destructive")}
            placeholder="Number of guests"
          />
          {guestsError && (
            <p className="text-xs text-destructive mt-1">{guestsError}</p>
          )}
        </div>
      </div>

      {hasDates ? (
        <p className="text-xs text-muted-foreground">
          Need different dates? Email{' '}
          <a href="mailto:hello@quintamor.com" className="text-primary hover:underline">hello@quintamor.com</a>{' '}
          and we'll adjust them for you.
        </p>
      ) : (
        <div className="mt-2 p-4 rounded-xl bg-muted/50 border border-border">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              Your stay dates will be confirmed by Quinta do Amor — food planning opens once they're set.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
