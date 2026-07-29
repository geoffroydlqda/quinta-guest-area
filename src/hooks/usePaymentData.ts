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
  due_date: string | null;
  status: "pending" | "paid";
  category: "rental" | "catering" | "extra" | "discount";
  invoice_file_url: string | null;
  invoice_file_name: string | null;
  notes: string | null;
  is_cash: boolean | null;
};

export function usePaymentData(bookingId: string | null | undefined) {
  const [booking, setBooking] = useState<PaymentBooking | null>(null);
  const [payments, setPayments] = useState<PaymentInstallment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!!bookingId);

  useEffect(() => {
    let cancelled = false;
    if (!bookingId) {
      setBooking(null);
      setPayments([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    (async () => {
      const [bRes, iRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,total_rental_price,payment_status,payment_status_override")
          .eq("id", bookingId)
          .maybeSingle(),
        supabase
          .from("payment_installments")
          .select("id,booking_id,label,amount_due,due_date,status,category,invoice_file_url,invoice_file_name,notes,is_cash")
          .eq("booking_id", bookingId)
          .order("due_date", { ascending: true, nullsFirst: false }),
      ]);
      if (cancelled) return;
      setBooking((bRes.data as PaymentBooking | null) ?? null);
      setPayments((iRes.data as PaymentInstallment[] | null) ?? []);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  return { booking, payments, isLoading };
}
