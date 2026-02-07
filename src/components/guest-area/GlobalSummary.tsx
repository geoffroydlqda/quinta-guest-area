import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ChevronRight, Check, BedDouble, Car, Utensils } from 'lucide-react';
import type { ToolStatuses } from '@/types/guest';

interface GlobalSummaryProps {
  profile: {
    check_in_date: string | null;
    check_out_date: string | null;
    full_name: string;
  };
  toolStatuses: ToolStatuses;
  roomSetupData?: {
    queenSharedCount: number;
    twinsSharedCount: number;
    queenEnsuiteCount: number;
    twinsEnsuiteCount: number;
  };
  transportationData?: {
    tripCount: number;
  };
  foodData?: {
    fullBoardDays: number;
    breakfastOnlyDays: number;
    customDays: number;
  };
  onEmailSummary: () => void;
  isEmailSending?: boolean;
}

export function GlobalSummary({
  profile,
  toolStatuses,
  roomSetupData,
  transportationData,
  foodData,
  onEmailSummary,
  isEmailSending,
}: GlobalSummaryProps) {
  const hasDates = !!(profile.check_in_date && profile.check_out_date);

  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <h2 className="text-xl font-medium mb-6">Summary</h2>

      <div className="space-y-4">
        {/* Stay Dates */}
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

        {/* Room Setup */}
        <div className="py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <BedDouble className="w-4 h-4 text-primary" />
            <span className="font-medium">Room Setup</span>
          </div>
          {toolStatuses.roomSetup === 'submitted' && roomSetupData ? (
            <div className="text-sm text-muted-foreground space-y-1 pl-6">
              <div className="flex justify-between">
                <span>King (en-suite) — fixed</span>
                <span className="font-medium text-foreground">2</span>
              </div>
              <div className="flex justify-between">
                <span>Queen (shared)</span>
                <span className="font-medium text-foreground">{roomSetupData.queenSharedCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Twins (shared)</span>
                <span className="font-medium text-foreground">{roomSetupData.twinsSharedCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Queen (en-suite)</span>
                <span className="font-medium text-foreground">{roomSetupData.queenEnsuiteCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Twins (en-suite)</span>
                <span className="font-medium text-foreground">{roomSetupData.twinsEnsuiteCount}</span>
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
          {toolStatuses.transportation === 'submitted' && transportationData ? (
            <div className="text-sm text-muted-foreground pl-6">
              <span>{transportationData.tripCount} trip{transportationData.tripCount !== 1 ? 's' : ''} scheduled</span>
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
        <div className="py-3 border-b border-border">
          <div className="flex items-center gap-2 mb-2">
            <Utensils className="w-4 h-4 text-primary" />
            <span className="font-medium">Food</span>
          </div>
          {toolStatuses.food === 'submitted' && foodData ? (
            <div className="text-sm text-muted-foreground space-y-1 pl-6">
              {foodData.fullBoardDays > 0 && (
                <div>Full board: {foodData.fullBoardDays} day{foodData.fullBoardDays !== 1 ? 's' : ''}</div>
              )}
              {foodData.breakfastOnlyDays > 0 && (
                <div>Breakfast only: {foodData.breakfastOnlyDays} day{foodData.breakfastOnlyDays !== 1 ? 's' : ''}</div>
              )}
              {foodData.customDays > 0 && (
                <div>Custom selection: {foodData.customDays} day{foodData.customDays !== 1 ? 's' : ''}</div>
              )}
              {foodData.fullBoardDays === 0 && foodData.breakfastOnlyDays === 0 && foodData.customDays === 0 && (
                <div>No meals selected</div>
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

      {/* Email Summary Button */}
      <div className="mt-6 pt-4 border-t border-border">
        <Button 
          onClick={onEmailSummary} 
          disabled={!hasDates || isEmailSending}
          className="w-full"
          variant="outline"
        >
          {isEmailSending ? 'Sending...' : 'Email me a copy of my summary'}
        </Button>
        {!hasDates && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Set your stay dates to enable email summary
          </p>
        )}
      </div>
    </div>
  );
}
