import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronRight, BedDouble, Car, Utensils, Users } from 'lucide-react';
import type { ToolStatuses, GuestProfile } from '@/types/guest';

interface GlobalSummaryProps {
  profile: GuestProfile;
  toolStatuses: ToolStatuses;
  roomSetupData?: {
    queenSharedCount: number;
    twinsSharedCount: number;
    queenEnsuiteCount: number;
    twinsEnsuiteCount: number;
  };
  transportationData?: {
    tripCount: number;
    totalPrice: number;
    customOfferCount: number;
  };
  foodData?: {
    fullBoardDays: number;
    breakfastOnlyDays: number;
    customDays: number;
    dietPreference?: string | null;
  };
}

export function GlobalSummary({
  profile,
  toolStatuses,
  roomSetupData,
  transportationData,
  foodData,
}: GlobalSummaryProps) {
  const hasDates = !!(profile.check_in_date && profile.check_out_date);
  const hasRoomSetup = toolStatuses.roomSetup !== 'not_set' && roomSetupData;
  const hasTransportation = toolStatuses.transportation !== 'not_set' && transportationData;
  const hasFood = toolStatuses.food !== 'not_set' && foodData && 
    (foodData.fullBoardDays > 0 || foodData.breakfastOnlyDays > 0 || foodData.customDays > 0);

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h2 className="text-xl font-medium mb-6">Summary</h2>

      <div className="space-y-4">
        {/* Stay Dates & Guests */}
        <div className="flex items-center justify-between py-3 border-b border-border">
          <span className="text-muted-foreground">Stay dates</span>
          {hasDates ? (
            <span className="font-medium">
              {new Date(profile.check_in_date!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — {new Date(profile.check_out_date!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          ) : (
            <span className="text-muted-foreground italic">Not set</span>
          )}
        </div>

        {/* Guests Count */}
        <div className="flex items-center justify-between py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            <span className="text-muted-foreground">Guests</span>
          </div>
          <span className="font-medium">{profile.guests_count}</span>
        </div>

        {/* Room Setup */}
        <div className="py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <BedDouble className="w-4 h-4 text-primary" />
            <span className="font-medium">Room Setup</span>
          </div>
          {hasRoomSetup ? (
            <div className="text-sm text-muted-foreground space-y-1 pl-6">
              <div className="flex justify-between">
                <span>King (en-suite) — fixed</span>
                <span className="font-medium text-foreground">2</span>
              </div>
              <div className="flex justify-between">
                <span>Queen (shared)</span>
                <span className="font-medium text-foreground">{roomSetupData!.queenSharedCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Twins (shared)</span>
                <span className="font-medium text-foreground">{roomSetupData!.twinsSharedCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Queen (en-suite)</span>
                <span className="font-medium text-foreground">{roomSetupData!.queenEnsuiteCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Twins (en-suite)</span>
                <span className="font-medium text-foreground">{roomSetupData!.twinsEnsuiteCount}</span>
              </div>
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-6">
              <Link to="/room-setup">
                Not set <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>

        {/* Transportation */}
        <div className="py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <Car className="w-4 h-4 text-primary" />
            <span className="font-medium">Transportation</span>
          </div>
          {hasTransportation ? (
            <div className="text-sm text-muted-foreground pl-6 space-y-1">
              <div>{transportationData!.tripCount} trip{transportationData!.tripCount !== 1 ? 's' : ''} scheduled</div>
              {transportationData!.totalPrice > 0 && (
                <div>Estimated total: €{transportationData!.totalPrice}</div>
              )}
              {transportationData!.customOfferCount > 0 && (
                <div>{transportationData!.customOfferCount} trip{transportationData!.customOfferCount !== 1 ? 's' : ''} with custom pricing</div>
              )}
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-6">
              <Link to="/transportation">
                Not set <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>

        {/* Food */}
        <div className="py-3">
          <div className="flex items-center gap-2 mb-2">
            <Utensils className="w-4 h-4 text-primary" />
            <span className="font-medium">Food</span>
          </div>
          {hasFood ? (
            <div className="text-sm text-muted-foreground space-y-1 pl-6">
              {foodData!.dietPreference && (
                <div className="font-medium text-foreground">{foodData!.dietPreference}</div>
              )}
              {foodData!.fullBoardDays > 0 && (
                <div>Full board: {foodData!.fullBoardDays} day{foodData!.fullBoardDays !== 1 ? 's' : ''}</div>
              )}
              {foodData!.breakfastOnlyDays > 0 && (
                <div>Breakfast only: {foodData!.breakfastOnlyDays} day{foodData!.breakfastOnlyDays !== 1 ? 's' : ''}</div>
              )}
              {foodData!.customDays > 0 && (
                <div>Custom selection: {foodData!.customDays} day{foodData!.customDays !== 1 ? 's' : ''}</div>
              )}
            </div>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-6" disabled={!hasDates}>
              <Link to={hasDates ? "/food" : "#"}>
                Not set <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
