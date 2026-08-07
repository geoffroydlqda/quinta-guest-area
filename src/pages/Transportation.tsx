import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useTransportation } from '@/hooks/useTransportation';
import { useAutoSave } from '@/hooks/useAutoSave';
import { getGuestStatus } from '@/lib/editLock';
import { calculateTransportationCost } from '@/lib/transportationPricing';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';

import { TransportationCostSummaryCard } from '@/components/guest-area/TransportationCostSummary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, Trash2, UserPlus, X, Car, Info, Copy, AlertCircle, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import type { TransportationTrip } from '@/types/guest';
import { getTaxiPrices } from '@/lib/pricing';

// Parse a YYYY-MM-DD calendar date into a local Date (no timezone shift).
function parseLocalDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
}
// Today's calendar date in local time as YYYY-MM-DD (no UTC shift).
function todayLocalISO(): string {
  const n = new Date();
  const mm = String(n.getMonth() + 1).padStart(2, '0');
  const dd = String(n.getDate()).padStart(2, '0');
  return `${n.getFullYear()}-${mm}-${dd}`;
}

// Import driver image
import driverImage from '@/assets/driver-luis.jpeg';

const PICKUP_OPTIONS = ['Lisbon', 'Lisbon Airport', 'Quinta do Amor', 'Custom'];
const DROPOFF_OPTIONS = ['Quinta do Amor', 'Lisbon', 'Lisbon Airport', 'Custom'];

const Transportation = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { profile } = useGuestProfile();
  
  const {
    request,
    trips,
    isLoading,
    addTrip,
    updateTrip,
    deleteTrip,
    addPassenger,
    removePassenger,
    updateNotes,
    autoSave,
  } = useTransportation();

  const { status: saveStatus, triggerSave } = useAutoSave({ onSave: autoSave });
  const lockCtx = useActiveBooking();
  const guestStatus = getGuestStatus(profile?.check_in_date || null, profile?.status_overall || "draft", {
    unlocked: lockCtx.isImpersonating || !!lockCtx.activeBooking?.edit_lock_override,
  });
  const isLocked = guestStatus.isEditingLocked;

  // Calculate cost summary
  const costSummary = useMemo(() => {
    return calculateTransportationCost(trips);
  }, [trips]);

  // Default trip date to check-in date if available
  const defaultTripDate = profile?.check_in_date || todayLocalISO();

  const [showAddTrip, setShowAddTrip] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [submittingTrip, setSubmittingTrip] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [newTrip, setNewTrip] = useState({
    trip_type: 'one_way' as 'one_way' | 'round_trip',
    pickup_location: '',
    pickup_custom: '',
    dropoff_location: 'Quinta do Amor',
    dropoff_custom: '',
    trip_date: defaultTripDate,
    trip_time: '',
    return_time: '',
    passengers_count: 1,
    taxi_size: '4 seats' as '4 seats' | '6 seats' | '8 seats',
  });

  // Note: Auth redirect is handled by ProtectedRoute in App.tsx

  // Update default date when check-in changes
  useEffect(() => {
    if (profile?.check_in_date) {
      setNewTrip(prev => ({ ...prev, trip_date: profile.check_in_date! }));
    }
  }, [profile?.check_in_date]);

  // Trigger auto-save when notes change
  useEffect(() => {
    if (request && !isLocked) {
      triggerSave();
    }
  }, [request?.notes_transportation]);

  const capacityOf = (size: string) => (size === '8 seats' ? 8 : size === '6 seats' ? 6 : 4);
  const checkoutDate = profile?.check_out_date || null;
  const MAX_CHECKOUT_TIME = '11:00';

  const deriveDirection = (dropoff: string): 'To Quinta' | 'From Quinta' =>
    dropoff === 'Quinta do Amor' ? 'To Quinta' : 'From Quinta';

  const handleAddTrip = async () => {
    if (submittingTrip) return;
    const pickup = newTrip.pickup_location === 'Custom' ? newTrip.pickup_custom : newTrip.pickup_location;
    const dropoff = newTrip.dropoff_location === 'Custom' ? newTrip.dropoff_custom : newTrip.dropoff_location;
    const isRound = newTrip.trip_type === 'round_trip';

    // Validate required fields
    const errors: string[] = [];
    if (!newTrip.pickup_location) errors.push('pickup_location');
    if (newTrip.pickup_location === 'Custom' && !newTrip.pickup_custom) errors.push('pickup_custom');
    if (!newTrip.dropoff_location) errors.push('dropoff_location');
    if (newTrip.dropoff_location === 'Custom' && !newTrip.dropoff_custom) errors.push('dropoff_custom');
    if (!newTrip.trip_date) errors.push('trip_date');
    if (!newTrip.trip_time) errors.push('trip_time');
    if (isRound && !newTrip.return_time) errors.push('return_time');
    if (!newTrip.taxi_size) errors.push('taxi_size');
    if (!newTrip.passengers_count || newTrip.passengers_count < 1) errors.push('passengers_count');

    // Capacity validation
    if (newTrip.passengers_count > capacityOf(newTrip.taxi_size)) {
      errors.push('passengers_capacity');
    }

    // Check-out time validation (apply to whichever leg lands on the checkout date)
    if (checkoutDate && newTrip.trip_date === checkoutDate) {
      if (newTrip.trip_time && newTrip.trip_time > MAX_CHECKOUT_TIME) errors.push('checkout_time');
      if (isRound && newTrip.return_time && newTrip.return_time > MAX_CHECKOUT_TIME) errors.push('checkout_time_return');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);

    setSubmittingTrip(true);
    try {
      await addTrip({
        trip_direction: deriveDirection(dropoff),
        pickup_location: pickup,
        dropoff_location: dropoff,
        trip_date: newTrip.trip_date,
        trip_time: newTrip.trip_time,
        passengers_count: newTrip.passengers_count,
        taxi_size: newTrip.taxi_size,
      });

      if (isRound) {
        await addTrip({
          trip_direction: deriveDirection(pickup),
          pickup_location: dropoff,
          dropoff_location: pickup,
          trip_date: newTrip.trip_date,
          trip_time: newTrip.return_time,
          passengers_count: newTrip.passengers_count,
          taxi_size: newTrip.taxi_size,
        });
      }

      setShowAddTrip(false);
      setNewTrip({
        trip_type: 'one_way',
        pickup_location: '',
        pickup_custom: '',
        dropoff_location: 'Quinta do Amor',
        dropoff_custom: '',
        trip_date: profile?.check_in_date || todayLocalISO(),
        trip_time: '',
        return_time: '',
        passengers_count: 1,
        taxi_size: '4 seats',
      });
    } finally {
      setSubmittingTrip(false);
    }
  };

  const handleDuplicateTrip = async (trip: TransportationTrip) => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      await addTrip({
        trip_direction: trip.trip_direction,
        pickup_location: trip.pickup_location,
        dropoff_location: trip.dropoff_location,
        trip_date: trip.trip_date,
        trip_time: trip.trip_time,
        passengers_count: trip.passengers_count,
        taxi_size: trip.taxi_size,
      });
    } finally {
      setDuplicating(false);
    }
  };

  // Garde multi-séjours : sans booking actif, les hooks ne peuvent pas scoper
  // leurs lectures/écritures (maybeSingle multi-lignes = spinner infini,
  // écritures cross-booking) -> sélecteur de séjour, ou dashboard si aucun.
  if (!lockCtx.isLoading && !lockCtx.activeBookingId) {
    if (lockCtx.bookingsPersonal.length > 1) return <Navigate to="/bookings" replace />;
    if (lockCtx.bookings.length === 0) return <Navigate to="/dashboard" replace />;
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ToolPageLayout
      title="Transportation"
      description="Arrange taxi transfers to and from Quinta do Amor"
      isLocked={isLocked}
      statusInfo={guestStatus}
    >
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Auto-save indicator */}
        <div className="flex justify-end">
          <AutoSaveIndicator status={saveStatus} />
        </div>

        {/* Driver Intro Card - Bigger image */}
        <div className="rounded-2xl bg-card border border-border p-6">
          <div className="flex items-start gap-5">
            <div className="w-24 h-24 md:w-32 md:h-32 rounded-full overflow-hidden flex-shrink-0 bg-muted border-4 border-primary/20">
              <img 
                src={driverImage} 
                alt="Luis" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1">
              <p className="text-foreground">
                <strong>Luis</strong> and his team will take care of the transportation of your guests and yourselves during your stay.
                They speak perfect English and will ensure you a smooth ride.
              </p>
            </div>
          </div>
        </div>

        {/* Luggage Note */}
        <div className="rounded-xl bg-primary/10 border border-primary/30 p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <p className="text-sm">
              Please consider the luggage of your guests. If you expect big suitcases, we recommend not filling the taxis.
            </p>
          </div>
        </div>

        {/* Pricing Info */}
        <div className="rounded-xl bg-muted/50 border border-border p-5">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium mb-2">Taxi pricing</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>• 4-seat taxi: <strong>€{getTaxiPrices().seats4}</strong> per trip (Lisbon / Lisbon Airport ↔ Quinta)</li>
                <li>• 6-seat taxi: <strong>€{getTaxiPrices().seats6}</strong> per trip (Lisbon / Lisbon Airport ↔ Quinta)</li>
                <li>• 8-seat taxi: <strong>€{getTaxiPrices().seats8}</strong> per trip (Lisbon / Lisbon Airport ↔ Quinta)</li>
                <li>• Other routes: Custom offer</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Existing Trips */}
        {trips.length > 0 && (() => {
          const sortedTrips = [...trips].sort((a, b) => {
            const dateCmp = (a.trip_date || '').localeCompare(b.trip_date || '');
            if (dateCmp !== 0) return dateCmp;
            return (a.trip_time || '').localeCompare(b.trip_time || '');
          });
          return (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Your trips</h2>
            {sortedTrips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                onDelete={() => deleteTrip(trip.id)}
                onDuplicate={() => handleDuplicateTrip(trip)}
                onUpdate={(updates) => updateTrip(trip.id, updates)}
                onAddPassenger={(passenger) => addPassenger(trip.id, passenger)}
                onRemovePassenger={(passengerId) => removePassenger(passengerId, trip.id)}
                checkoutDate={checkoutDate}
                disabled={isLocked}
              />
            ))}
          </div>
          );
        })()}

        {/* Add Trip Form */}
        {!isLocked && (
          <>
            {showAddTrip ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Car className="w-5 h-5" />
                    New Trip
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Validation Error Banner */}
                  {validationErrors.length > 0 && (
                    <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-destructive font-medium">
                        Please fill in the highlighted fields to add this trip.
                      </p>
                    </div>
                  )}

                  {/* Trip type */}
                  <div>
                    <Label>Trip type</Label>
                    <Select
                      value={newTrip.trip_type}
                      onValueChange={(v) => setNewTrip(prev => ({ ...prev, trip_type: v as 'one_way' | 'round_trip' }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one_way">One-way</SelectItem>
                        <SelectItem value="round_trip">Round-trip (creates 2 trips)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>




                  {/* Pickup */}
                  <div>
                    <Label>Pickup location <span className="text-destructive">*</span></Label>
                    <Select
                      value={newTrip.pickup_location}
                      onValueChange={(v) => setNewTrip(prev => ({ ...prev, pickup_location: v }))}
                    >
                      <SelectTrigger className={validationErrors.includes('pickup_location') ? 'border-destructive' : ''}>
                        <SelectValue placeholder="Select pickup" />
                      </SelectTrigger>
                      <SelectContent>
                        {PICKUP_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {validationErrors.includes('pickup_location') && (
                      <p className="text-xs text-destructive mt-1">Required</p>
                    )}
                    {newTrip.pickup_location === 'Custom' && (
                      <>
                        <Input
                          className={`mt-2 ${validationErrors.includes('pickup_custom') ? 'border-destructive' : ''}`}
                          placeholder="Enter custom pickup location"
                          value={newTrip.pickup_custom}
                          onChange={(e) => setNewTrip(prev => ({ ...prev, pickup_custom: e.target.value }))}
                        />
                        {validationErrors.includes('pickup_custom') && (
                          <p className="text-xs text-destructive mt-1">Required</p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Dropoff */}
                  <div>
                    <Label>Dropoff location <span className="text-destructive">*</span></Label>
                    <Select
                      value={newTrip.dropoff_location}
                      onValueChange={(v) => setNewTrip(prev => ({ ...prev, dropoff_location: v }))}
                    >
                      <SelectTrigger className={validationErrors.includes('dropoff_location') ? 'border-destructive' : ''}>
                        <SelectValue placeholder="Select dropoff" />
                      </SelectTrigger>
                      <SelectContent>
                        {DROPOFF_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {validationErrors.includes('dropoff_location') && (
                      <p className="text-xs text-destructive mt-1">Required</p>
                    )}
                    {newTrip.dropoff_location === 'Custom' && (
                      <>
                        <Input
                          className={`mt-2 ${validationErrors.includes('dropoff_custom') ? 'border-destructive' : ''}`}
                          placeholder="Enter custom dropoff location"
                          value={newTrip.dropoff_custom}
                          onChange={(e) => setNewTrip(prev => ({ ...prev, dropoff_custom: e.target.value }))}
                        />
                        {validationErrors.includes('dropoff_custom') && (
                          <p className="text-xs text-destructive mt-1">Required</p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Date & Time */}
                  {(() => {
                    const isRound = newTrip.trip_type === 'round_trip';
                    const pickupLabel = (newTrip.pickup_location === 'Custom' ? newTrip.pickup_custom : newTrip.pickup_location) || 'pickup';
                    const dropoffLabel = (newTrip.dropoff_location === 'Custom' ? newTrip.dropoff_custom : newTrip.dropoff_location) || 'destination';
                    return (
                      <div className={`grid gap-4 ${isRound ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-2'}`}>
                        <div>
                          <Label>Date <span className="text-destructive">*</span></Label>
                          <Input
                            type="date"
                            value={newTrip.trip_date}
                            onChange={(e) => setNewTrip(prev => ({ ...prev, trip_date: e.target.value }))}
                            className={validationErrors.includes('trip_date') ? 'border-destructive' : ''}
                          />
                          {validationErrors.includes('trip_date') && (
                            <p className="text-xs text-destructive mt-1">Required</p>
                          )}
                        </div>
                        <div>
                          <Label>
                            {isRound ? 'Pick-up time (outbound)' : 'Time'} <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            type="time"
                            value={newTrip.trip_time}
                            max={checkoutDate && newTrip.trip_date === checkoutDate ? MAX_CHECKOUT_TIME : undefined}
                            onChange={(e) => setNewTrip(prev => ({ ...prev, trip_time: e.target.value }))}
                            className={validationErrors.includes('trip_time') || validationErrors.includes('checkout_time') ? 'border-destructive' : ''}
                          />
                          {isRound && (
                            <p className="text-xs text-muted-foreground mt-1">Pick-up at {pickupLabel} → {dropoffLabel}</p>
                          )}
                          {validationErrors.includes('trip_time') && (
                            <p className="text-xs text-destructive mt-1">Required</p>
                          )}
                          {validationErrors.includes('checkout_time') && (
                            <p className="text-xs text-destructive mt-1">Pick-up time on check-out day cannot be later than 11:00 AM.</p>
                          )}
                        </div>
                        {isRound && (
                          <div>
                            <Label>Pick-up time (return) <span className="text-destructive">*</span></Label>
                            <Input
                              type="time"
                              value={newTrip.return_time}
                              max={checkoutDate && newTrip.trip_date === checkoutDate ? MAX_CHECKOUT_TIME : undefined}
                              onChange={(e) => setNewTrip(prev => ({ ...prev, return_time: e.target.value }))}
                              className={validationErrors.includes('return_time') || validationErrors.includes('checkout_time_return') ? 'border-destructive' : ''}
                            />
                            <p className="text-xs text-muted-foreground mt-1">Pick-up at {dropoffLabel} → {pickupLabel}</p>
                            {validationErrors.includes('return_time') && (
                              <p className="text-xs text-destructive mt-1">Required</p>
                            )}
                            {validationErrors.includes('checkout_time_return') && (
                              <p className="text-xs text-destructive mt-1">Return pick-up time on check-out day cannot be later than 11:00 AM.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Passengers & Taxi Size */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Number of passengers <span className="text-destructive">*</span></Label>
                      <Input
                        type="number"
                        min={1}
                        max={capacityOf(newTrip.taxi_size)}
                        value={newTrip.passengers_count}
                        onChange={(e) => setNewTrip(prev => ({ ...prev, passengers_count: parseInt(e.target.value) || 1 }))}
                        className={validationErrors.includes('passengers_count') || validationErrors.includes('passengers_capacity') ? 'border-destructive' : ''}
                      />
                      {validationErrors.includes('passengers_count') && (
                        <p className="text-xs text-destructive mt-1">Required</p>
                      )}
                      {validationErrors.includes('passengers_capacity') && (
                        <p className="text-xs text-destructive mt-1">Passenger count cannot exceed vehicle capacity.</p>
                      )}
                    </div>
                    <div>
                      <Label>Taxi size <span className="text-destructive">*</span></Label>
                      <Select
                        value={newTrip.taxi_size}
                        onValueChange={(v) => setNewTrip(prev => {
                          const cap = capacityOf(v);
                          return {
                            ...prev,
                            taxi_size: v as any,
                            passengers_count: prev.passengers_count > cap ? cap : prev.passengers_count,
                          };
                        })}
                      >
                        <SelectTrigger className={validationErrors.includes('taxi_size') ? 'border-destructive' : ''}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="4 seats">4-seat taxi</SelectItem>
                          <SelectItem value="6 seats">6-seat taxi</SelectItem>
                          <SelectItem value="8 seats">8-seat taxi</SelectItem>
                        </SelectContent>
                      </Select>
                      {validationErrors.includes('taxi_size') && (
                        <p className="text-xs text-destructive mt-1">Required</p>
                      )}
                    </div>
                  </div>


                  <div className="flex gap-2 pt-4">
                    <Button variant="outline" onClick={() => { setShowAddTrip(false); setValidationErrors([]); }}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddTrip} disabled={submittingTrip}>
                      {submittingTrip ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                      Add Trip
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Button onClick={() => setShowAddTrip(true)} variant="outline" className="w-full gap-2">
                <Plus className="w-4 h-4" />
                Add trip
              </Button>
            )}
          </>
        )}

        {/* Notes */}
        <div>
          <Label>Notes (optional)</Label>
          <Textarea
            placeholder="Any special requirements or notes..."
            value={request?.notes_transportation || ''}
            onChange={(e) => !isLocked && updateNotes(e.target.value)}
            disabled={isLocked}
            rows={3}
          />
        </div>

        {/* Cost Summary */}
        <TransportationCostSummaryCard summary={costSummary} />
      </div>
    </ToolPageLayout>
  );
};

// Trip Card Component
function TripCard({
  trip,
  onDelete,
  onDuplicate,
  onUpdate,
  onAddPassenger,
  onRemovePassenger,
  checkoutDate,
  disabled,
}: {
  trip: TransportationTrip;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdate: (updates: Partial<TransportationTrip>) => Promise<boolean>;
  onAddPassenger: (p: { first_name: string; phone: string; flight_number?: string }) => void;
  onRemovePassenger: (id: string) => void;
  checkoutDate?: string | null;
  disabled?: boolean;
}) {
  const [showAddPassenger, setShowAddPassenger] = useState(false);
  const [newPassenger, setNewPassenger] = useState({ first_name: '', phone: '', flight_number: '' });
  const [isEditing, setIsEditing] = useState(false);

  const [addingPassenger, setAddingPassenger] = useState(false);

  const handleAddPassenger = async () => {
    if (addingPassenger) return;
    if (!newPassenger.first_name || !newPassenger.phone) return;
    setAddingPassenger(true);
    try {
      await onAddPassenger(newPassenger);
      setNewPassenger({ first_name: '', phone: '', flight_number: '' });
      setShowAddPassenger(false);
    } finally {
      setAddingPassenger(false);
    }
  };

  if (isEditing) {
    return (
      <EditTripForm
        trip={trip}
        checkoutDate={checkoutDate || null}
        onCancel={() => setIsEditing(false)}
        onSave={async (updates) => {
          const ok = await onUpdate(updates);
          if (ok) setIsEditing(false);
          return ok;
        }}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-medium">{trip.trip_direction}</p>
            <p className="text-sm text-muted-foreground">
              {trip.pickup_location} → {trip.dropoff_location}
            </p>
          </div>
          {!disabled && (
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => setIsEditing(true)} title="Edit trip">
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDuplicate} title="Duplicate trip">
                <Copy className="w-4 h-4 text-muted-foreground" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onDelete}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <span className="text-muted-foreground">Date: </span>
            {format(parseLocalDate(trip.trip_date), 'dd MMM yyyy')}
          </div>
          <div>
            <span className="text-muted-foreground">Time: </span>
            {trip.trip_time}
          </div>
          <div>
            <span className="text-muted-foreground">Taxi: </span>
            {trip.taxi_size}
          </div>
          <div>
            <span className="text-muted-foreground">Passengers: </span>
            {trip.passengers_count}
          </div>
          <div>
            <span className="text-muted-foreground">Price: </span>
            <span className="font-medium">
              {trip.custom_price !== null && trip.custom_price !== undefined
                ? `${Number(trip.custom_price)}€`
                : trip.price_estimate}
            </span>
          </div>
        </div>

        {/* Passengers */}
        {trip.passengers && trip.passengers.length > 0 && (
          <div className="border-t border-border pt-3 mt-3">
            <p className="text-sm font-medium mb-2">Passengers</p>
            <div className="space-y-2">
              {trip.passengers.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm bg-muted/50 rounded-lg p-2">
                  <div>
                    <span className="font-medium">{p.first_name}</span>
                    <span className="text-muted-foreground ml-2">{p.phone}</span>
                    {p.flight_number && (
                      <span className="text-muted-foreground ml-2">Flight: {p.flight_number}</span>
                    )}
                  </div>
                  {!disabled && (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onRemovePassenger(p.id)}>
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Passenger */}
        {!disabled && (
          <div className="border-t border-border pt-3 mt-3">
            {showAddPassenger ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="First name"
                    value={newPassenger.first_name}
                    onChange={(e) => setNewPassenger(prev => ({ ...prev, first_name: e.target.value }))}
                  />
                  <Input
                    placeholder="Phone"
                    value={newPassenger.phone}
                    onChange={(e) => setNewPassenger(prev => ({ ...prev, phone: e.target.value }))}
                  />
                </div>
                <Input
                  placeholder="Flight number (optional)"
                  value={newPassenger.flight_number}
                  onChange={(e) => setNewPassenger(prev => ({ ...prev, flight_number: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setShowAddPassenger(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleAddPassenger} disabled={addingPassenger}>
                    {addingPassenger ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setShowAddPassenger(true)} className="gap-1">
                <UserPlus className="w-4 h-4" />
                Add passenger
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default Transportation;

// Edit Trip Form Component
function EditTripForm({
  trip,
  checkoutDate,
  onSave,
  onCancel,
}: {
  trip: TransportationTrip;
  checkoutDate: string | null;
  onSave: (updates: Partial<TransportationTrip>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const capacityOf = (size: string) => (size === '8 seats' ? 8 : size === '6 seats' ? 6 : 4);
  const MAX_CHECKOUT_TIME = '11:00';

  const initialPickupIsPreset = PICKUP_OPTIONS.includes(trip.pickup_location) && trip.pickup_location !== 'Custom';
  const initialDropoffIsPreset = DROPOFF_OPTIONS.includes(trip.dropoff_location) && trip.dropoff_location !== 'Custom';

  const [form, setForm] = useState({
    pickup_location: initialPickupIsPreset ? trip.pickup_location : 'Custom',
    pickup_custom: initialPickupIsPreset ? '' : trip.pickup_location,
    dropoff_location: initialDropoffIsPreset ? trip.dropoff_location : 'Custom',
    dropoff_custom: initialDropoffIsPreset ? '' : trip.dropoff_location,
    trip_date: trip.trip_date,
    trip_time: trip.trip_time,
    passengers_count: trip.passengers_count,
    taxi_size: trip.taxi_size as '4 seats' | '6 seats' | '8 seats',
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const pickup = form.pickup_location === 'Custom' ? form.pickup_custom : form.pickup_location;
    const dropoff = form.dropoff_location === 'Custom' ? form.dropoff_custom : form.dropoff_location;

    const errors: string[] = [];
    if (!form.pickup_location) errors.push('pickup_location');
    if (form.pickup_location === 'Custom' && !form.pickup_custom) errors.push('pickup_custom');
    if (!form.dropoff_location) errors.push('dropoff_location');
    if (form.dropoff_location === 'Custom' && !form.dropoff_custom) errors.push('dropoff_custom');
    if (!form.trip_date) errors.push('trip_date');
    if (!form.trip_time) errors.push('trip_time');
    if (!form.taxi_size) errors.push('taxi_size');
    if (!form.passengers_count || form.passengers_count < 1) errors.push('passengers_count');
    if (form.passengers_count > capacityOf(form.taxi_size)) errors.push('passengers_capacity');
    if (checkoutDate && form.trip_date === checkoutDate && form.trip_time && form.trip_time > MAX_CHECKOUT_TIME) {
      errors.push('checkout_time');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setSaving(true);
    await onSave({
      trip_direction: dropoff === 'Quinta do Amor' ? 'To Quinta' : 'From Quinta',
      pickup_location: pickup,
      dropoff_location: dropoff,
      trip_date: form.trip_date,
      trip_time: form.trip_time,
      passengers_count: form.passengers_count,
      taxi_size: form.taxi_size,
    });
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Pencil className="w-5 h-5" />
          Edit Trip
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {validationErrors.length > 0 && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive font-medium">
              Please fix the highlighted fields.
            </p>
          </div>
        )}




        <div>
          <Label>Pickup location <span className="text-destructive">*</span></Label>
          <Select
            value={form.pickup_location}
            onValueChange={(v) => setForm(p => ({ ...p, pickup_location: v }))}
          >
            <SelectTrigger className={validationErrors.includes('pickup_location') ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select pickup" />
            </SelectTrigger>
            <SelectContent>
              {PICKUP_OPTIONS.map(opt => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.pickup_location === 'Custom' && (
            <Input
              className={`mt-2 ${validationErrors.includes('pickup_custom') ? 'border-destructive' : ''}`}
              placeholder="Enter custom pickup location"
              value={form.pickup_custom}
              onChange={(e) => setForm(p => ({ ...p, pickup_custom: e.target.value }))}
            />
          )}
        </div>

        <div>
          <Label>Dropoff location <span className="text-destructive">*</span></Label>
          <Select
            value={form.dropoff_location}
            onValueChange={(v) => setForm(p => ({ ...p, dropoff_location: v }))}
          >
            <SelectTrigger className={validationErrors.includes('dropoff_location') ? 'border-destructive' : ''}>
              <SelectValue placeholder="Select dropoff" />
            </SelectTrigger>
            <SelectContent>
              {DROPOFF_OPTIONS.map(opt => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.dropoff_location === 'Custom' && (
            <Input
              className={`mt-2 ${validationErrors.includes('dropoff_custom') ? 'border-destructive' : ''}`}
              placeholder="Enter custom dropoff location"
              value={form.dropoff_custom}
              onChange={(e) => setForm(p => ({ ...p, dropoff_custom: e.target.value }))}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Date <span className="text-destructive">*</span></Label>
            <Input
              type="date"
              value={form.trip_date}
              onChange={(e) => setForm(p => ({ ...p, trip_date: e.target.value }))}
              className={validationErrors.includes('trip_date') ? 'border-destructive' : ''}
            />
          </div>
          <div>
            <Label>Time <span className="text-destructive">*</span></Label>
            <Input
              type="time"
              value={form.trip_time}
              max={checkoutDate && form.trip_date === checkoutDate ? MAX_CHECKOUT_TIME : undefined}
              onChange={(e) => setForm(p => ({ ...p, trip_time: e.target.value }))}
              className={validationErrors.includes('trip_time') || validationErrors.includes('checkout_time') ? 'border-destructive' : ''}
            />
            {validationErrors.includes('checkout_time') && (
              <p className="text-xs text-destructive mt-1">Pick-up time on check-out day cannot be later than 11:00 AM.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Number of passengers <span className="text-destructive">*</span></Label>
            <Input
              type="number"
              min={1}
              max={capacityOf(form.taxi_size)}
              value={form.passengers_count}
              onChange={(e) => setForm(p => ({ ...p, passengers_count: parseInt(e.target.value) || 1 }))}
              className={validationErrors.includes('passengers_count') || validationErrors.includes('passengers_capacity') ? 'border-destructive' : ''}
            />
            {validationErrors.includes('passengers_capacity') && (
              <p className="text-xs text-destructive mt-1">Passenger count cannot exceed vehicle capacity.</p>
            )}
          </div>
          <div>
            <Label>Taxi size <span className="text-destructive">*</span></Label>
            <Select
              value={form.taxi_size}
              onValueChange={(v) => setForm(p => {
                const cap = capacityOf(v);
                return {
                  ...p,
                  taxi_size: v as any,
                  passengers_count: p.passengers_count > cap ? cap : p.passengers_count,
                };
              })}
            >
              <SelectTrigger className={validationErrors.includes('taxi_size') ? 'border-destructive' : ''}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4 seats">4-seat taxi</SelectItem>
                <SelectItem value="6 seats">6-seat taxi</SelectItem>
                <SelectItem value="8 seats">8-seat taxi</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
