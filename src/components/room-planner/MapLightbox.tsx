import { Dialog, DialogContent } from '@/components/ui/dialog';
import roomsArrangement from '@/assets/rooms-arrangement.png';

interface MapLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MapLightbox({ open, onOpenChange }: MapLightboxProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] p-2 bg-card">
        <img
          src={roomsArrangement}
          alt="Rooms map (1-11)"
          className="w-full h-auto rounded-lg"
        />
      </DialogContent>
    </Dialog>
  );
}
