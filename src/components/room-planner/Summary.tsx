import { RoomConfig, EventInfo, RoomStats as RoomStatsType } from '@/types/room';
import { RoomStats } from './RoomStats';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Send, Check, Bed, Save, Copy, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface SummaryProps {
  eventInfo: EventInfo;
  rooms: RoomConfig[];
  stats: RoomStatsType;
  isSubmitted: boolean;
  isSaved: boolean;
  editUrl: string | null;
  isEmailValid: boolean;
  onPrev: () => void;
  onSave: () => void;
  onSubmit: () => void;
  onNewSetup: () => void;
}

export function Summary({
  eventInfo,
  rooms,
  stats,
  isSubmitted,
  isSaved,
  editUrl,
  isEmailValid,
  onPrev,
  onSave,
  onSubmit,
  onNewSetup,
}: SummaryProps) {
  const { toast } = useToast();

  const getBedLabel = (room: RoomConfig) => {
    switch (room.bedType) {
      case 'king':
        return 'King';
      case 'queen':
        return 'Queen';
      case 'twin':
        return '2 Twins';
      default:
        return 'Not selected';
    }
  };

  const getBathroomLabel = (room: RoomConfig) => {
    return room.bathroomType === 'en-suite' ? 'En-suite' : 'Shared';
  };

  const copyEditUrl = () => {
    if (editUrl) {
      navigator.clipboard.writeText(editUrl);
      toast({
        title: "Link copied!",
        description: "The edit link has been copied to your clipboard.",
      });
    }
  };

  // Submitted or saved confirmation view
  if (isSubmitted || isSaved) {
    return (
      <div className="max-w-2xl mx-auto text-center animate-fade-up">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
          <Check className="w-10 h-10 text-success" />
        </div>
        <h2 className="text-3xl md:text-4xl mb-3">
          {isSubmitted ? 'Setup Submitted!' : 'Progress Saved!'}
        </h2>
        <p className="text-muted-foreground mb-6">
          {isSubmitted 
            ? `Your room configuration has been submitted. A confirmation email has been sent to ${eventInfo.organizerEmail}.`
            : `Your progress has been saved. An edit link has been sent to ${eventInfo.organizerEmail}.`
          }
        </p>

        {/* Edit URL */}
        {editUrl && (
          <div className="bg-card rounded-2xl shadow-elegant p-6 text-left mb-6">
            <h4 className="font-medium mb-3">Your Edit Link</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Use this link to return and {isSubmitted ? 'view or modify' : 'continue editing'} your setup:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 rounded-lg bg-muted text-xs break-all">
                {editUrl}
              </code>
              <Button variant="outline" size="icon" onClick={copyEditUrl}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Housekeeping Summary */}
        <div className="bg-card rounded-2xl shadow-elegant p-6 text-left">
          <h3 className="text-xl mb-4">Housekeeping Setup Summary</h3>
          
          <div className="space-y-3 mb-6">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Event</span>
              <span className="font-medium">{eventInfo.eventName}</span>
            </div>
            {eventInfo.stayDates && (
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Stay Dates</span>
                <span className="font-medium">{eventInfo.stayDates}</span>
              </div>
            )}
            {eventInfo.notes && (
              <div className="py-2 border-b border-border">
                <span className="text-muted-foreground block mb-1">Notes</span>
                <span className="font-medium">{eventInfo.notes}</span>
              </div>
            )}
          </div>

          {/* Room list */}
          <div className="space-y-2 mb-6">
            {rooms.map((room) => (
              <div key={room.id} className="flex justify-between py-2 text-sm border-b border-border/50">
                <span>{room.name}</span>
                <span className="text-muted-foreground">
                  {getBedLabel(room)} — {getBathroomLabel(room)}
                </span>
              </div>
            ))}
          </div>

          <RoomStats stats={stats} />
        </div>

        <div className="mt-8">
          <Button onClick={onNewSetup} variant="outline" className="gap-2">
            <ExternalLink className="w-4 h-4" />
            Start New Setup
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-up">
      <div className="text-center mb-8">
        <h2 className="text-3xl md:text-4xl mb-3">Summary</h2>
        <p className="text-muted-foreground">
          Review your room setup before saving or submitting
        </p>
      </div>

      {/* Event info */}
      <div className="bg-card rounded-2xl shadow-elegant p-6 mb-6">
        <h3 className="text-xl mb-4">Event Information</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Event Name</p>
            <p className="font-medium">{eventInfo.eventName}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Organizer Email</p>
            <p className="font-medium">{eventInfo.organizerEmail}</p>
          </div>
          {eventInfo.stayDates && (
            <div>
              <p className="text-sm text-muted-foreground">Stay Dates</p>
              <p className="font-medium">{eventInfo.stayDates}</p>
            </div>
          )}
        </div>
        {eventInfo.notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">Notes for the Team</p>
            <p className="font-medium">{eventInfo.notes}</p>
          </div>
        )}
      </div>

      {/* Stats */}
      <RoomStats stats={stats} className="mb-6" />

      {/* Room configuration table */}
      <div className="bg-card rounded-2xl shadow-elegant overflow-hidden">
        <div className="p-6 border-b border-border">
          <h3 className="text-xl">Room Configuration</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary">
              <tr>
                <th className="text-left px-6 py-4 font-medium">Room</th>
                <th className="text-left px-6 py-4 font-medium">Bed</th>
                <th className="text-left px-6 py-4 font-medium">Bathroom</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room, index) => (
                <tr
                  key={room.id}
                  className={cn(
                    "border-b border-border/50",
                    index % 2 === 0 ? "bg-card" : "bg-secondary/30"
                  )}
                >
                  <td className="px-6 py-4">
                    <span className="font-medium">{room.name}</span>
                    {room.specialNote && (
                      <span className="block text-xs text-muted-foreground">{room.specialNote}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        "bed-badge",
                        room.bedType === 'king' && "bed-badge-king",
                        room.bedType === 'queen' && "bed-badge-queen",
                        room.bedType === 'twin' && "bed-badge-twin",
                        !room.bedType && "bed-badge-unselected"
                      )}
                    >
                      <Bed className="w-3 h-3 mr-1" />
                      {getBedLabel(room)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">
                    {getBathroomLabel(room)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Email validation warning */}
      {!isEmailValid && (
        <div className="mt-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-center">
          <p className="text-sm text-destructive">
            Please provide a valid organizer email to save or submit your setup.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex flex-col sm:flex-row justify-between gap-4 mt-8 pt-6 border-t border-border">
        <Button variant="outline" onClick={onPrev} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button 
            variant="outline" 
            onClick={onSave} 
            disabled={!isEmailValid}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            Save and come back later
          </Button>
          <Button 
            onClick={onSubmit} 
            size="lg" 
            disabled={!isEmailValid}
            className="gap-2"
          >
            <Send className="w-4 h-4" />
            Submit final setup
          </Button>
        </div>
      </div>
    </div>
  );
}
