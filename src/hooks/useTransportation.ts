import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import { useToast } from '@/hooks/use-toast';
import type { TransportationTrip, TransportationPassenger, TransportationRequest } from '@/types/guest';
import { calculateTripPrice } from '@/types/guest';
import { triggerSheetsSync } from '@/lib/sheetsSync';
import { syncTripCalendar, deleteTripCalendarEvent } from '@/lib/calendarSync';

export function useTransportation() {
  const { user } = useAuth();
  const { activeBookingId } = useActiveBooking();
  const { toast } = useToast();
  
  const [request, setRequest] = useState<TransportationRequest | null>(null);
  const [trips, setTrips] = useState<TransportationTrip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Load transportation data
  const loadData = useCallback(async () => {
    if (!user) return;
    
    setIsLoading(true);
    
    try {
      // Get or create request (booking-scoped if active booking present)
      const reqQuery = supabase.from('transportation_requests').select('*');
      const scopedReqQuery = activeBookingId
        ? reqQuery.eq('booking_id', activeBookingId)
        : reqQuery.eq('user_id', user.id);
      let { data: requestData, error: reqError } = await scopedReqQuery.maybeSingle();

      if (reqError) throw reqError;

      if (!requestData) {
        const { data: newReq, error: createError } = await supabase
          .from('transportation_requests')
          .insert({ user_id: user.id, booking_id: activeBookingId })
          .select()
          .single();

        if (createError) throw createError;
        requestData = newReq;
      }

      setRequest(requestData as TransportationRequest);

      // Fetch trips (booking-scoped if available)
      const tripsBaseQuery = supabase.from('transportation_trips').select('*');
      const scopedTripsQuery = activeBookingId
        ? tripsBaseQuery.eq('booking_id', activeBookingId)
        : tripsBaseQuery.eq('user_id', user.id);
      const { data: tripsData, error: tripsError } = await scopedTripsQuery.order('trip_date', { ascending: true });

      if (tripsError) throw tripsError;
      
      // Fetch all passengers for user's trips
      const tripIds = tripsData?.map(t => t.id) || [];
      let passengersMap: Record<string, TransportationPassenger[]> = {};
      
      if (tripIds.length > 0) {
        const { data: passengersData } = await supabase
          .from('transportation_passengers')
          .select('*')
          .in('trip_id', tripIds);
        
        passengersData?.forEach(p => {
          if (!passengersMap[p.trip_id]) {
            passengersMap[p.trip_id] = [];
          }
          passengersMap[p.trip_id].push(p as TransportationPassenger);
        });
      }
      
      // Attach passengers to trips
      const tripsWithPassengers = (tripsData || []).map(trip => ({
        ...trip,
        passengers: passengersMap[trip.id] || [],
      })) as TransportationTrip[];
      
      setTrips(tripsWithPassengers);
      
    } catch (error: any) {
      console.error('Error loading transportation:', error);
      toast({
        title: 'Error',
        description: 'Failed to load transportation data.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, activeBookingId, toast]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, activeBookingId, loadData]);

  // Add a new trip
  const addTrip = useCallback(async (tripData: Partial<TransportationTrip>): Promise<TransportationTrip | null> => {
    if (!user) return null;
    
    try {
      const priceEstimate = calculateTripPrice(
        tripData.pickup_location || '',
        tripData.dropoff_location || '',
        tripData.taxi_size || '4 seats'
      );
      
      const { data, error } = await supabase
        .from('transportation_trips')
        .insert({
          user_id: user.id,
          booking_id: activeBookingId,
          trip_direction: tripData.trip_direction || 'To Quinta',
          pickup_location: tripData.pickup_location || '',
          dropoff_location: tripData.dropoff_location || 'Quinta do Amor',
          trip_date: tripData.trip_date,
          trip_time: tripData.trip_time,
          passengers_count: tripData.passengers_count || 1,
          taxi_size: tripData.taxi_size || '4 seats',
          price_estimate: priceEstimate,
        })
        .select()
        .single();

      if (error) throw error;
      
      const newTrip = { ...data, passengers: [] } as TransportationTrip;
      setTrips(prev => [...prev, newTrip]);
      triggerSheetsSync();
      syncTripCalendar(newTrip.id);
      return newTrip;
    } catch (error: any) {
      console.error('Error adding trip:', error);
      toast({
        title: 'Error',
        description: 'Failed to add trip.',
        variant: 'destructive',
      });
      return null;
    }
  }, [user, activeBookingId, toast]);

  // Update a trip
  const updateTrip = useCallback(async (tripId: string, updates: Partial<TransportationTrip>): Promise<boolean> => {
    if (!user) return false;
    
    try {
      // Recalculate price if locations or taxi size changed
      let priceEstimate = updates.price_estimate;
      if (updates.pickup_location || updates.dropoff_location || updates.taxi_size) {
        const trip = trips.find(t => t.id === tripId);
        if (trip) {
          priceEstimate = calculateTripPrice(
            updates.pickup_location || trip.pickup_location,
            updates.dropoff_location || trip.dropoff_location,
            updates.taxi_size || trip.taxi_size
          );
        }
      }
      
      let updQuery = supabase
        .from('transportation_trips')
        .update({ ...updates, price_estimate: priceEstimate })
        .eq('id', tripId);
      updQuery = activeBookingId
        ? updQuery.eq('booking_id', activeBookingId)
        : updQuery.eq('user_id', user.id);
      const { error } = await updQuery;
      
      if (error) throw error;
      
      setTrips(prev => prev.map(t => 
        t.id === tripId ? { ...t, ...updates, price_estimate: priceEstimate || t.price_estimate } : t
      ));
      triggerSheetsSync();
      syncTripCalendar(tripId);
      return true;
    } catch (error: any) {
      console.error('Error updating trip:', error);
      return false;
    }
  }, [user, activeBookingId, trips]);

  // Delete a trip
  const deleteTrip = useCallback(async (tripId: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const existing = trips.find(t => t.id === tripId);
      const eventId = (existing as any)?.google_calendar_event_id as string | undefined;

      let delQuery = supabase
        .from('transportation_trips')
        .delete()
        .eq('id', tripId);
      delQuery = activeBookingId
        ? delQuery.eq('booking_id', activeBookingId)
        : delQuery.eq('user_id', user.id);
      const { data: deletedRows, error } = await delQuery.select('id');

      if (error) throw error;
      if (!deletedRows || deletedRows.length === 0) {
        toast({ title: 'Could not delete trip', description: 'Please refresh and try again.', variant: 'destructive' });
        return false;
      }

      setTrips(prev => prev.filter(t => t.id !== tripId));
      triggerSheetsSync();
      if (eventId) deleteTripCalendarEvent(eventId);
      return true;
    } catch (error: any) {
      console.error('Error deleting trip:', error);
      return false;
    }
  }, [user, activeBookingId, trips, toast]);


  // Add passenger to trip
  const addPassenger = useCallback(async (tripId: string, passenger: Partial<TransportationPassenger>): Promise<boolean> => {
    if (!user) return false;
    
    try {
      const { data, error } = await supabase
        .from('transportation_passengers')
        .insert({
          user_id: user.id,
          booking_id: activeBookingId,
          trip_id: tripId,
          first_name: passenger.first_name || '',
          phone: passenger.phone || '',
          flight_number: passenger.flight_number || null,
        })
        .select()
        .single();

      if (error) throw error;
      
      setTrips(prev => prev.map(t => 
        t.id === tripId 
          ? { ...t, passengers: [...(t.passengers || []), data as TransportationPassenger] }
          : t
      ));
      syncTripCalendar(tripId);
      return true;
    } catch (error: any) {
      console.error('Error adding passenger:', error);
      return false;
    }
  }, [user, activeBookingId]);

  // Remove passenger
  const removePassenger = useCallback(async (passengerId: string, tripId: string): Promise<boolean> => {
    if (!user) return false;
    
    try {
      const { error } = await supabase
        .from('transportation_passengers')
        .delete()
        .eq('id', passengerId)
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setTrips(prev => prev.map(t => 
        t.id === tripId 
          ? { ...t, passengers: (t.passengers || []).filter(p => p.id !== passengerId) }
          : t
      ));
      syncTripCalendar(tripId);

      
      return true;
    } catch (error: any) {
      console.error('Error removing passenger:', error);
      return false;
    }
  }, [user]);

  // Update notes
  const updateNotes = useCallback((notes: string) => {
    setRequest(prev => prev ? { ...prev, notes_transportation: notes } : null);
  }, []);

  // Auto-save function (used by useAutoSave hook)
  const autoSave = useCallback(async (): Promise<boolean> => {
    if (!user || !request) return false;
    
    try {
      const updateQuery = supabase
        .from('transportation_requests')
        .update({ notes_transportation: request.notes_transportation || null });
      const { error } = await (activeBookingId
        ? updateQuery.eq('booking_id', activeBookingId)
        : updateQuery.eq('user_id', user.id));

      if (error) throw error;
      return true;
    } catch (error: any) {
      console.error('Error auto-saving transportation:', error);
      return false;
    }
  }, [user, activeBookingId, request]);

  return {
    request,
    trips,
    isLoading,
    isSaving,
    addTrip,
    updateTrip,
    deleteTrip,
    addPassenger,
    removePassenger,
    updateNotes,
    autoSave,
    refresh: loadData,
  };
}
