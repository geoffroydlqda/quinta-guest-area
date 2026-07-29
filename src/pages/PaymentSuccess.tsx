import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

// Page publique de retour des liens de paiement envoyés par email
// (la cliente n'est pas forcément connectée à la guest area).
const CONTENT: Record<string, { icon: JSX.Element; title: string; text: string }> = {
  success: {
    icon: <CheckCircle2 className="w-12 h-12 text-green-600" />,
    title: "Payment received — thank you!",
    text: "You're all set. Your invoice will arrive in your inbox shortly. We look forward to welcoming you at Quinta do Amor.",
  },
  cancelled: {
    icon: <Info className="w-12 h-12 text-amber-600" />,
    title: "Payment cancelled",
    text: "No worries — you can use the payment link in your email whenever you're ready.",
  },
  already: {
    icon: <CheckCircle2 className="w-12 h-12 text-green-600" />,
    title: "Already settled",
    text: "This payment has already been received — nothing left to do. See you soon at the quinta!",
  },
  invalid: {
    icon: <XCircle className="w-12 h-12 text-red-600" />,
    title: "This link is no longer valid",
    text: "Please use the most recent payment email, or reply to it and we'll send you a fresh link.",
  },
};

const PaymentSuccess = () => {
  const [params] = useSearchParams();
  const outcome = params.get("payment") ?? "success";
  const c = CONTENT[outcome] ?? CONTENT.success;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-10 text-center space-y-4">
        <div className="flex justify-center">{c.icon}</div>
        <h1 className="text-2xl">{c.title}</h1>
        <p className="text-muted-foreground">{c.text}</p>
        <div className="pt-2">
          <Button asChild variant="outline">
            <Link to="/dashboard">Open your guest area</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PaymentSuccess;
