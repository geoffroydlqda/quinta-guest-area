import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useGuestProfile } from '@/hooks/useGuestProfile';
import { useTransportation } from '@/hooks/useTransportation';
import { useAutoSave } from '@/hooks/useAutoSave';
import { isEditingLocked } from '@/lib/editLock';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { AutoSaveIndicator } from '@/components/guest-area/AutoSaveIndicator';
import { EditLockBanner } from '@/components/guest-area/EditLockBanner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, Trash2, UserPlus, X, Car, Info, Copy } from 'lucide-react';
import { format } from 'date-fns';
import type { TransportationTrip } from '@/types/guest';
import { STANDARD_TAXI_PRICE_4_SEATS, STANDARD_TAXI_PRICE_6_SEATS } from '@/types/guest';

// Import driver image
import driverImage from '@/assets/rooms-arrangement.png';

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
  const isLocked = isEditingLocked(profile?.check_in_date || null);

  const [showAddTrip, setShowAddTrip] = useState(false);
  const [newTrip, setNewTrip] = useState({
    trip_direction: 'To Quinta' as 'To Quinta' | 'From Quinta',
    pickup_location: '',
    pickup_custom: '',
    dropoff_location: 'Quinta do Amor',
    dropoff_custom: '',
    trip_date: '',
    trip_time: '',
    passengers_count: 1,
    taxi_size: '4 seats' as '4 seats' | '6 seats',
  });

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/');
    }
  }, [user, authLoading, navigate]);

  // Trigger auto-save when notes change
  useEffect(() => {
    if (request && !isLocked) {
      triggerSave();
    }
  }, [request?.notes_transportation]);

  const handleAddTrip = async () => {
    const pickup = newTrip.pickup_location === 'Custom' ? newTrip.pickup_custom : newTrip.pickup_location;
    const dropoff = newTrip.dropoff_location === 'Custom' ? newTrip.dropoff_custom : newTrip.dropoff_location;

    if (!pickup || !dropoff || !newTrip.trip_date || !newTrip.trip_time) {
      return;
    }

    await addTrip({
      trip_direction: newTrip.trip_direction,
      pickup_location: pickup,
      dropoff_location: dropoff,
      trip_date: newTrip.trip_date,
      trip_time: newTrip.trip_time,
      passengers_count: newTrip.passengers_count,
      taxi_size: newTrip.taxi_size,
    });

    setShowAddTrip(false);
    setNewTrip({
      trip_direction: 'To Quinta',
      pickup_location: '',
      pickup_custom: '',
      dropoff_location: 'Quinta do Amor',
      dropoff_custom: '',
      trip_date: '',
      trip_time: '',
      passengers_count: 1,
      taxi_size: '4 seats',
    });
  };

  const handleDuplicateTrip = async (trip: TransportationTrip) => {
    await addTrip({
      trip_direction: trip.trip_direction,
      pickup_location: trip.pickup_location,
      dropoff_location: trip.dropoff_location,
      trip_date: trip.trip_date,
      trip_time: trip.trip_time,
      passengers_count: trip.passengers_count,
      taxi_size: trip.taxi_size,
    });
  };

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
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {isLocked && <EditLockBanner />}

        {/* Auto-save indicator */}
        <div className="flex justify-end">
          <AutoSaveIndicator status={saveStatus} />
        </div>

        {/* Driver Intro Card */}
        <div className="rounded-2xl bg-card border border-border p-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 bg-muted">
              <img 
                src={driverImage} 
                alt="Luis" 
                className="w-full h-full object-cover"
              />
            </div>
            <div>
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
                <li>• 4-seat taxi: <strong>€{STANDARD_TAXI_PRICE_4_SEATS}</strong> per trip (Lisbon / Lisbon Airport ↔ Quinta)</li>
                <li>• 6-seat taxi: <strong>€{STANDARD_TAXI_PRICE_6_SEATS}</strong> per trip (Lisbon / Lisbon Airport ↔ Quinta)</li>
                <li>• Other routes: Custom offer</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Existing Trips */}
        {trips.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-medium">Your trips</h2>
            {trips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                onDelete={() => deleteTrip(trip.id)}
                onDuplicate={() => handleDuplicateTrip(trip)}
                onAddPassenger={(passenger) => addPassenger(trip.id, passenger)}
                onRemovePassenger={(passengerId) => removePassenger(passengerId, trip.id)}
                disabled={isLocked}
              />
            ))}
          </div>
        )}

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
                  {/* Direction */}
                  <div>
                    <Label>Direction</Label>
                    <Select
                      value={newTrip.trip_direction}
                      onValueChange={(v) => setNewTrip(prev => ({ ...prev, trip_direction: v as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="To Quinta">To Quinta do Amor</SelectItem>
                        <SelectItem value="From Quinta">From Quinta do Amor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Pickup */}
                  <div>
                    <Label>Pickup location</Label>
                    <Select
                      value={newTrip.pickup_location}
                      onValueChange={(v) => setNewTrip(prev => ({ ...prev, pickup_location: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select pickup" />
                      </SelectTrigger>
                      <SelectContent>
                        {PICKUP_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {newTrip.pickup_location === 'Custom' && (
                      <Input
                        className="mt-2"
                        placeholder="Enter custom pickup location"
                        value={newTrip.pickup_custom}
                        onChange={(e) => setNewTrip(prev => ({ ...prev, pickup_custom: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* Dropoff */}
                  <div>
                    <Label>Dropoff location</Label>
                    <Select
                      value={newTrip.dropoff_location}
                      onValueChange={(v) => setNewTrip(prev => ({ ...prev, dropoff_location: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select dropoff" />
                      </SelectTrigger>
                      <SelectContent>
                        {DROPOFF_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {newTrip.dropoff_location === 'Custom' && (
                      <Input
                        className="mt-2"
                        placeholder="Enter custom dropoff location"
                        value={newTrip.dropoff_custom}
                        onChange={(e) => setNewTrip(prev => ({ ...prev, dropoff_custom: e.target.value }))}
                      />
                    )}
                  </div>

                  {/* Date & Time */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={newTrip.trip_date}
                        onChange={(e) => setNewTrip(prev => ({ ...prev, trip_date: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Time</Label>
                      <Input
                        type="time"
                        value={newTrip.trip_time}
                        onChange={(e) => setNewTrip(prev => ({ ...prev, trip_time: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Passengers & Taxi Size */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Number of passengers</Label>
                      <Input
                        type="number"
                        min={1}
                        max={6}
                        value={newTrip.passengers_count}
                        onChange={(e) => setNewTrip(prev => ({ ...prev, passengers_count: parseInt(e.target.value) || 1 }))}
                      />
                    </div>
                    <div>
                      <Label>Taxi size</Label>
                      <Select
                        value={newTrip.taxi_size}
                        onValueChange={(v) => setNewTrip(prev => ({ ...prev, taxi_size: v as any }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="4 seats">4 seats</SelectItem>
                          <SelectItem value="6 seats">6 seats</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-4">
                    <Button variant="outline" onClick={() => setShowAddTrip(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddTrip}>
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
      </div>
    </ToolPageLayout>
  );
};

// Trip Card Component
function TripCard({
  trip,
  onDelete,
  onDuplicate,
  onAddPassenger,
  onRemovePassenger,
  disabled,
}: {
  trip: TransportationTrip;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddPassenger: (p: { first_name: string; phone: string; flight_number?: string }) => void;
  onRemovePassenger: (id: string) => void;
  disabled?: boolean;
}) {
  const [showAddPassenger, setShowAddPassenger] = useState(false);
  const [newPassenger, setNewPassenger] = useState({ first_name: '', phone: '', flight_number: '' });

  const handleAddPassenger = () => {
    if (!newPassenger.first_name || !newPassenger.phone) return;
    onAddPassenger(newPassenger);
    setNewPassenger({ first_name: '', phone: '', flight_number: '' });
    setShowAddPassenger(false);
  };

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
            {format(new Date(trip.trip_date), 'dd MMM yyyy')}
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
            <span className="text-muted-foreground">Price: </span>
            <span className="font-medium">{trip.price_estimate}</span>
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
                  <Button size="sm" onClick={handleAddPassenger}>
                    Add
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setShowAddPassenger(true)} className="gap-2">
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