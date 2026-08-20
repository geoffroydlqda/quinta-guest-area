import { useNavigate } from 'react-router-dom';
import { useActiveBooking } from '@/contexts/BookingContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, ChevronDown, CalendarDays } from 'lucide-react';

function shortRange(checkIn: string | null, checkOut: string | null) {
  if (!checkIn || !checkOut) return 'Dates TBD';
  const fmt = (s: string) =>
    new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(checkIn)} – ${fmt(checkOut)}`;
}

export function StaySwitcher() {
  const { bookingsPersonal, activeBooking, activeBookingId, setActiveBookingId } = useActiveBooking();
  const navigate = useNavigate();

  if (bookingsPersonal.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 max-w-[220px] rounded-full border-border/80 text-foreground">
          <CalendarDays className="h-4 w-4 shrink-0 text-[#6D7855]" />
          <span className="truncate font-medium">
            {activeBooking?.retreat_name || shortRange(activeBooking?.check_in_date ?? null, activeBooking?.check_out_date ?? null)}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Switch stay</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {bookingsPersonal.map((b) => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => {
              setActiveBookingId(b.id);
              navigate('/dashboard');
            }}
            className="flex items-start gap-2 py-2"
          >
            <div className="w-4 mt-0.5">
              {b.id === activeBookingId && <Check className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{b.retreat_name || 'Quinta do Amor stay'}</p>
              <p className="text-xs text-muted-foreground">{shortRange(b.check_in_date, b.check_out_date)}</p>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/bookings')}>View all stays</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
