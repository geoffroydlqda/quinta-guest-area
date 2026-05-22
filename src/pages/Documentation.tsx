import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useActiveBooking } from '@/contexts/BookingContext';
import { supabase } from '@/integrations/supabase/client';
import { ToolPageLayout } from '@/components/guest-area/ToolPageLayout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Home, MapPin, Clock, Book, Building, Phone, Compass } from 'lucide-react';
import { Loader2 } from 'lucide-react';

const documentationSections = [
  {
    id: 'welcome',
    icon: Home,
    title: 'Welcome',
    content: `
      Welcome to Quinta do Amor! We're delighted to host you at our beautiful retreat property in Portugal.
      
      This documentation contains everything you need to know about your stay. Please read through each section carefully to ensure a comfortable and enjoyable experience.
      
      If you have any questions not covered here, don't hesitate to reach out to us.
    `,
  },
  {
    id: 'getting-here',
    icon: MapPin,
    title: 'Getting Here',
    content: `
      **Address:**
      Quinta do Amor
      [Full address will be provided]
      Portugal
      
      **From Lisbon Airport:**
      - By car: approximately 1 hour 30 minutes
      - We can arrange taxi transfers through the Transportation section of this Guest Area
      
      **From Lisbon City Center:**
      - By car: approximately 1 hour 15 minutes
      - Public transport options are limited; we recommend private transfer
      
      **GPS Coordinates:**
      [Coordinates will be provided closer to your stay]
      
      **Parking:**
      Free parking is available on-site for all guests.
    `,
  },
  {
    id: 'check-in-out',
    icon: Clock,
    title: 'Check-in / Check-out',
    content: `
      **Check-in Time:** 3:00 PM (15:00)
      - Early check-in may be available upon request, subject to availability
      - Please inform us of your expected arrival time
      
      **Check-out Time:** 11:00 AM (11:00)
      - Late check-out may be arranged upon request
      - Please leave your room key at the reception area
      
      **Key Collection:**
      You will receive details about key collection closer to your arrival date.
      
      **Contact on Arrival:**
      [Contact details will be provided]
    `,
  },
  {
    id: 'house-rules',
    icon: Book,
    title: 'House Rules',
    content: `
      To ensure a peaceful experience for all guests:
      
      **General:**
      - Please treat the property and its surroundings with respect
      - Quiet hours are from 11:00 PM to 8:00 AM
      - Smoking is only permitted in designated outdoor areas
      
      **Kitchen:**
      - The shared kitchen is available for guest use
      - Please clean up after yourself
      - Label any food you store in the refrigerator
      
      **Pool & Outdoor Areas:**
      - Pool hours: 8:00 AM to 8:00 PM
      - Please shower before using the pool
      - No glass containers in the pool area
      
      **Sustainability:**
      - We encourage water conservation
      - Please turn off lights and AC when leaving your room
      - Recycling bins are provided throughout the property
    `,
  },
  {
    id: 'facilities',
    icon: Building,
    title: 'Facilities',
    content: `
      **Accommodation:**
      - 11 bedrooms (mix of King, Queen, and Twin configurations)
      - Both en-suite and shared bathroom options
      - All rooms include fresh linens and towels
      
      **Common Areas:**
      - Large living room with fireplace
      - Fully equipped kitchen
      - Dining area for group meals
      - Outdoor terrace with seating
      
      **Amenities:**
      - Swimming pool
      - Garden and grounds
      - WiFi throughout the property
      - Yoga/meditation space
      
      **Services (upon request):**
      - Catering for meals
      - Housekeeping
      - Laundry service
    `,
  },
  {
    id: 'emergency',
    icon: Phone,
    title: 'Emergency & Contacts',
    content: `
      **Emergency Numbers:**
      - General Emergency (Police, Fire, Ambulance): 112
      - Police: 112
      - Fire Department: 112
      
      **Property Contacts:**
      - Property Manager: [To be provided]
      - Email: hello@quintamor.com
      
      **Nearest Facilities:**
      - Hospital: [Location and distance]
      - Pharmacy: [Location and distance]
      - Supermarket: [Location and distance]
      
      **First Aid:**
      A first aid kit is located in the main kitchen.
    `,
  },
  {
    id: 'local-info',
    icon: Compass,
    title: 'Useful Local Info',
    content: `
      **Weather:**
      The region enjoys a Mediterranean climate with warm, dry summers and mild winters.
      
      **Currency:**
      Euro (€)
      
      **Language:**
      Portuguese is the official language. English is widely spoken in tourist areas.
      
      **Tipping:**
      Tipping is appreciated but not mandatory. 10% is customary for good service.
      
      **Nearby Attractions:**
      - Local beaches (approx. 30 min drive)
      - Historic towns and villages
      - Hiking trails
      - Wine regions
      
      **Restaurants:**
      We can provide recommendations for local restaurants. Just ask!
    `,
  },
];

const Documentation = () => {
  const { user, isLoading: authLoading } = useAuth();
  const { activeBookingId } = useActiveBooking();
  const navigate = useNavigate();

  // Note: Auth redirect is handled by ProtectedRoute in App.tsx

  // Mark as viewed
  useEffect(() => {
    const markViewed = async () => {
      if (!user) return;

      await supabase
        .from('docs_ack')
        .upsert({
          user_id: user.id,
          booking_id: activeBookingId,
          last_viewed_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });
    };

    if (user) {
      markViewed();
    }
  }, [user, activeBookingId]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <ToolPageLayout
      title="Documentation"
      description="Everything you need to know about Quinta do Amor"
    >
      <div className="max-w-3xl mx-auto space-y-4">
        {documentationSections.map((section) => (
          <Collapsible key={section.id} className="bg-card rounded-xl border border-border">
            <CollapsibleTrigger className="flex items-center justify-between w-full p-5 text-left hover:bg-muted/50 transition-colors rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <section.icon className="w-5 h-5 text-primary" />
                </div>
                <span className="font-medium text-lg">{section.title}</span>
              </div>
              <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform duration-200 [&[data-state=open]>svg]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-5 pb-5">
              <div className="pt-4 border-t border-border">
                <div className="prose prose-sm max-w-none text-muted-foreground">
                  {section.content.split('\n').map((line, i) => {
                    if (line.trim().startsWith('**') && line.trim().endsWith('**')) {
                      return (
                        <p key={i} className="font-medium text-foreground mt-4 mb-2">
                          {line.replace(/\*\*/g, '')}
                        </p>
                      );
                    }
                    if (line.trim().startsWith('- ')) {
                      return (
                        <p key={i} className="pl-4 my-1">
                          {line}
                        </p>
                      );
                    }
                    if (line.trim()) {
                      return <p key={i} className="my-2">{line}</p>;
                    }
                    return null;
                  })}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </ToolPageLayout>
  );
};

export default Documentation;