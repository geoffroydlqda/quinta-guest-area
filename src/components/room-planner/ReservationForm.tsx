import { ReservationInfo } from '@/types/room';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowRight, Mail, Phone, Calendar, Users, FileText } from 'lucide-react';

interface ReservationFormProps {
  reservationInfo: ReservationInfo;
  setReservationInfo: React.Dispatch<React.SetStateAction<ReservationInfo>>;
  isValid: boolean;
  onNext: () => void;
}

export function ReservationForm({
  reservationInfo,
  setReservationInfo,
  isValid,
  onNext,
}: ReservationFormProps) {
  const handleChange = (field: keyof ReservationInfo, value: string) => {
    setReservationInfo((prev) => ({ ...prev, [field]: value }));
  };

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reservationInfo.email) || reservationInfo.email === '';

  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <div className="text-center mb-8">
        <h2 className="font-display text-3xl md:text-4xl mb-3">Informations de réservation</h2>
        <p className="text-muted-foreground">
          Commencez par nous indiquer les détails de votre séjour
        </p>
      </div>

      <div className="bg-card rounded-2xl shadow-elegant p-6 md:p-8 space-y-6">
        {/* Required fields */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reservationName" className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" />
              Nom de la réservation / groupe <span className="text-destructive">*</span>
            </Label>
            <Input
              id="reservationName"
              placeholder="Ex: Famille Martin, Séminaire entreprise..."
              value={reservationInfo.reservationName}
              onChange={(e) => handleChange('reservationName', e.target.value)}
              className="h-12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-accent" />
              Email organisateur <span className="text-destructive">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="organisateur@email.com"
              value={reservationInfo.email}
              onChange={(e) => handleChange('email', e.target.value)}
              className={`h-12 ${!isEmailValid ? 'border-destructive focus-visible:ring-destructive' : ''}`}
            />
            {!isEmailValid && reservationInfo.email && (
              <p className="text-sm text-destructive">Veuillez entrer une adresse email valide</p>
            )}
          </div>
        </div>

        {/* Optional fields */}
        <div className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground mb-4">Informations optionnelles</p>
          
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                Téléphone
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+33 6 00 00 00 00"
                value={reservationInfo.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stayDates" className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                Dates du séjour
              </Label>
              <Input
                id="stayDates"
                placeholder="Ex: 15 - 22 juillet 2024"
                value={reservationInfo.stayDates}
                onChange={(e) => handleChange('stayDates', e.target.value)}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="numberOfPeople" className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                Nombre de personnes
              </Label>
              <Input
                id="numberOfPeople"
                type="number"
                min="1"
                placeholder="8"
                value={reservationInfo.numberOfPeople}
                onChange={(e) => handleChange('numberOfPeople', e.target.value)}
                className="h-12"
              />
            </div>
          </div>

          <div className="space-y-2 mt-4">
            <Label htmlFor="generalNotes">Notes générales</Label>
            <Textarea
              id="generalNotes"
              placeholder="Informations complémentaires sur votre séjour..."
              value={reservationInfo.generalNotes}
              onChange={(e) => handleChange('generalNotes', e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            onClick={onNext}
            disabled={!isValid}
            size="lg"
            className="gap-2"
          >
            Configurer les chambres
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
