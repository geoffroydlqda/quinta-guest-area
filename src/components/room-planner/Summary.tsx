import { RoomConfig, ReservationInfo, RoomStats as RoomStatsType } from '@/types/room';
import { RoomStats } from './RoomStats';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Send, Check, Bed, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SummaryProps {
  reservationInfo: ReservationInfo;
  rooms: RoomConfig[];
  stats: RoomStatsType;
  isSubmitted: boolean;
  onPrev: () => void;
  onSubmit: () => void;
}

export function Summary({
  reservationInfo,
  rooms,
  stats,
  isSubmitted,
  onPrev,
  onSubmit,
}: SummaryProps) {
  const configuredRooms = rooms.filter((room) => room.bedType !== null);

  const getBedLabel = (bedType: string | null) => {
    switch (bedType) {
      case 'king':
        return 'King size';
      case 'queen':
        return 'Queen size';
      case 'twin':
        return '2 Twin beds';
      default:
        return '-';
    }
  };

  if (isSubmitted) {
    return (
      <div className="max-w-2xl mx-auto text-center animate-fade-up">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-success/20 flex items-center justify-center">
          <Check className="w-10 h-10 text-success" />
        </div>
        <h2 className="font-display text-3xl md:text-4xl mb-3">Configuration envoyée !</h2>
        <p className="text-muted-foreground mb-8">
          Votre configuration a été enregistrée avec succès. Un email de confirmation a été envoyé à{' '}
          <span className="font-medium text-foreground">{reservationInfo.email}</span>.
        </p>

        <div className="bg-card rounded-2xl shadow-elegant p-6 text-left">
          <h3 className="font-display text-xl mb-4">Récapitulatif de votre réservation</h3>
          
          <div className="space-y-3 mb-6">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Réservation</span>
              <span className="font-medium">{reservationInfo.reservationName}</span>
            </div>
            {reservationInfo.stayDates && (
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Dates</span>
                <span className="font-medium">{reservationInfo.stayDates}</span>
              </div>
            )}
          </div>

          <RoomStats stats={stats} />

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 font-medium">Chambre</th>
                  <th className="text-left py-3 font-medium">Lit</th>
                  <th className="text-left py-3 font-medium">Occupants</th>
                </tr>
              </thead>
              <tbody>
                {configuredRooms.map((room) => (
                  <tr key={room.id} className="border-b border-border/50">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {room.name}
                        {room.isFixed && <Crown className="w-3 h-3 text-accent" />}
                      </div>
                    </td>
                    <td className="py-3">{getBedLabel(room.bedType)}</td>
                    <td className="py-3">
                      <div>
                        {room.occupant1}
                        {room.occupant2 && <span className="text-muted-foreground">, {room.occupant2}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-up">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl md:text-4xl mb-3">Récapitulatif</h2>
        <p className="text-muted-foreground">
          Vérifiez votre configuration avant de soumettre
        </p>
      </div>

      {/* Reservation info */}
      <div className="bg-card rounded-2xl shadow-elegant p-6 mb-6">
        <h3 className="font-display text-xl mb-4">Informations de réservation</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Nom de la réservation</p>
            <p className="font-medium">{reservationInfo.reservationName}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="font-medium">{reservationInfo.email}</p>
          </div>
          {reservationInfo.phone && (
            <div>
              <p className="text-sm text-muted-foreground">Téléphone</p>
              <p className="font-medium">{reservationInfo.phone}</p>
            </div>
          )}
          {reservationInfo.stayDates && (
            <div>
              <p className="text-sm text-muted-foreground">Dates du séjour</p>
              <p className="font-medium">{reservationInfo.stayDates}</p>
            </div>
          )}
          {reservationInfo.numberOfPeople && (
            <div>
              <p className="text-sm text-muted-foreground">Nombre de personnes</p>
              <p className="font-medium">{reservationInfo.numberOfPeople}</p>
            </div>
          )}
        </div>
        {reservationInfo.generalNotes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">Notes générales</p>
            <p className="font-medium">{reservationInfo.generalNotes}</p>
          </div>
        )}
      </div>

      {/* Stats */}
      <RoomStats stats={stats} className="mb-6" />

      {/* Room configuration table */}
      <div className="bg-card rounded-2xl shadow-elegant overflow-hidden">
        <div className="p-6 border-b border-border">
          <h3 className="font-display text-xl">Configuration des chambres</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary">
              <tr>
                <th className="text-left px-6 py-4 font-medium">Chambre</th>
                <th className="text-left px-6 py-4 font-medium">Lit</th>
                <th className="text-left px-6 py-4 font-medium">Occupant 1</th>
                <th className="text-left px-6 py-4 font-medium">Occupant 2</th>
                <th className="text-left px-6 py-4 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {configuredRooms.map((room, index) => (
                <tr
                  key={room.id}
                  className={cn(
                    "border-b border-border/50",
                    index % 2 === 0 ? "bg-card" : "bg-secondary/30"
                  )}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{room.name}</span>
                      {room.isFixed && <Crown className="w-4 h-4 text-accent" />}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={cn(
                        "bed-badge",
                        room.bedType === 'king' && "bed-badge-king",
                        room.bedType === 'queen' && "bed-badge-queen",
                        room.bedType === 'twin' && "bed-badge-twin"
                      )}
                    >
                      <Bed className="w-3 h-3 mr-1" />
                      {getBedLabel(room.bedType)}
                    </span>
                  </td>
                  <td className="px-6 py-4">{room.occupant1 || '-'}</td>
                  <td className="px-6 py-4">{room.occupant2 || '-'}</td>
                  <td className="px-6 py-4 text-muted-foreground text-sm">{room.notes || '-'}</td>
                </tr>
              ))}
              {configuredRooms.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    Aucune chambre configurée
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-8 pt-6 border-t border-border">
        <Button variant="outline" onClick={onPrev} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Modifier
        </Button>
        <Button onClick={onSubmit} size="lg" className="gap-2">
          <Send className="w-4 h-4" />
          Envoyer la configuration
        </Button>
      </div>
    </div>
  );
}
