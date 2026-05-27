import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PaymentBooking = {
  id: string;
  total_rental_price: number | null;
  payment_status: string | null;
  payment_status_override: string | null;
};

export type PaymentInstallment = {
  id: string;
  booking_id: string;
  label: string;
  amount_due: number;
  amount_paid: number;
  due_date: string | null;
  paid_at: string | null;
  status: string;
};

export type PaymentInvoice = {
  id: string;
  booking_id: string;
  type: string; // 'rental' | 'food' | 'transport' | other
  period: string; // 'pre' | 'post'
  label: string | null;
  file_name: string;
  file_url: string;
  amount: number | null;
  paid: boolean;
  paid_at: string | null;
  uploaded_at: string;
};

export function usePaymentData(bookingId: string | null | undefined) {
  const [booking, setBooking] = useState<PaymentBooking | null>(null);
  const [installments, setInstallments] = useState<PaymentInstallment[]>([]);
  const [invoices, setInvoices] = useState<PaymentInvoice[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!!bookingId);

  useEffect(() => {
    let cancelled = false;
    if (!bookingId) {
      setBooking(null);
      setInstallments([]);
      setInvoices([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    (async () => {
      const [bRes, iRes, vRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,total_rental_price,payment_status,payment_status_override")
          .eq("id", bookingId)
          .maybeSingle(),
        supabase
          .from("payment_installments")
          .select("id,booking_id,label,amount_due,amount_paid,due_date,paid_at,status")
          .eq("booking_id", bookingId)
          .order("due_date", { ascending: true, nullsFirst: false }),
        supabase
          .from("invoices")
          .select("id,booking_id,type,period,label,file_name,file_url,amount,paid,paid_at,uploaded_at")
          .eq("booking_id", bookingId)
          .order("uploaded_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setBooking((bRes.data as PaymentBooking | null) ?? null);
      setInstallments((iRes.data as PaymentInstallment[] | null) ?? []);
      setInvoices((vRes.data as PaymentInvoice[] | null) ?? []);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  return { booking, installments, invoices, isLoading };
}
