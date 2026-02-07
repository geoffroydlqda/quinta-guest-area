import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTransportation } from '@/hooks/useTransportation';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, Trash2, UserPlus, X, Save, Send, Car, Info } from 'lucide-react';
import { format } from 'date-fns';
import type { TransportationTrip } from '@/types/guest';

const PICKUP_OPTIONS = ['Lisbon', 'Lisbon Airport', 'Quinta do Amor', 'Custom'];
const DROPOFF_OPTIONS = ['Quinta do Amor', 'Lisbon', 'Lisbon Airport', 'Custom'];

const Transportation = () => {
  const { user, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  
  const {
    request,
    trips,
    isLoading,
    isSaving,
    addTrip,
    updateTrip,
    deleteTrip,
    addPassenger,
    removePassenger,
    saveDraft,
    submitRequest,
  } = useTransportation();

  const [notes, setNotes] = useState('');
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

  useEffect(() => {
    if (request?.notes_transportation) {
      setNotes(request.notes_transportation);
    }
  }, [request]);

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

  const handleSave = async () => {
    const success = await saveDraft(notes);
    if (success) {
      navigate('/dashboard');
    }
  };

  const handleSubmit = async () => {
    const success = await submitRequest(notes);
    if (success) {
      navigate('/dashboard');
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isSubmitted = request?.status_transportation === 'submitted';

  return (
    <ToolPageLayout
      title="Transportation"
      description="Arrange taxi transfers to and from Quinta do Amor"
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Info Box */}
        <div className="rounded-xl bg-primary/10 border border-primary/30 p-5">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium mb-2">Taxi pricing</p>
              <ul className="space-y-1 text-muted-foreground">
                <li>• 4-seat taxi: <strong>€60</strong> per trip (Lisbon / Lisbon Airport ↔ Quinta)</li>
                <li>• 6-seat taxi: Custom offer</li>
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
                onAddPassenger={(passenger) => addPassenger(trip.id, passenger)}
                onRemovePassenger={(passengerId) => removePassenger(passengerId, trip.id)}
                disabled={isSubmitted}
              />
            ))}
          </div>
        )}

        {/* Add Trip Form */}
        {!isSubmitted && (
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isSubmitted}
            rows={3}
          />
        </div>

        {/* Actions */}
        {!isSubmitted && (
          <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-border">
            <Button
              variant="outline"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Draft
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving || trips.length === 0}
              className="gap-2"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Submit Transportation Request
            </Button>
          </div>
        )}

        {isSubmitted && (
          <div className="rounded-xl bg-success/10 border border-success/30 p-4">
            <p className="text-success font-medium">Transportation request submitted</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your transportation request has been submitted. We'll be in touch to confirm.
            </p>
          </div>
        )}
      </div>
    </ToolPageLayout>
  );
};

// Trip Card Component
function TripCard({
  trip,
  onDelete,
  onAddPassenger,
  onRemovePassenger,
  disabled,
}: {
  trip: TransportationTrip;
  onDelete: () => void;
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
            <Button variant="ghost" size="icon" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
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