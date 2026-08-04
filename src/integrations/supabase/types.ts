export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      fin_transactions: {
        Row: {
          id: string
          source: string
          dedup_key: string | null
          date: string
          description: string | null
          amount: number
          currency: string
          kind: string
          category: string | null
          vat_rate: number | null
          amount_net: number | null
          booking_id: string | null
          notes: string | null
          reviewed: boolean
          created_at: string
        }
        Insert: {
          id?: string
          source?: string
          dedup_key?: string | null
          date: string
          description?: string | null
          amount: number
          currency?: string
          kind?: string
          category?: string | null
          vat_rate?: number | null
          amount_net?: number | null
          booking_id?: string | null
          notes?: string | null
          reviewed?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          source?: string
          dedup_key?: string | null
          date?: string
          description?: string | null
          amount?: number
          currency?: string
          kind?: string
          category?: string | null
          vat_rate?: number | null
          amount_net?: number | null
          booking_id?: string | null
          notes?: string | null
          reviewed?: boolean
          created_at?: string
        }
        Relationships: []
      }
      fin_rules: {
        Row: {
          id: string
          pattern: string
          kind: string
          category: string | null
          vat_rate: number | null
          created_at: string
        }
        Insert: {
          id?: string
          pattern: string
          kind?: string
          category?: string | null
          vat_rate?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          pattern?: string
          kind?: string
          category?: string | null
          vat_rate?: number | null
          created_at?: string
        }
        Relationships: []
      }
      housekeeping_sessions: {
        Row: {
          id: string
          booking_id: string
          date: string
          start_time: string | null
          end_time: string | null
          team: string[]
          notes: string | null
          gcal_event_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          booking_id: string
          date: string
          start_time?: string | null
          end_time?: string | null
          team?: string[]
          notes?: string | null
          gcal_event_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          booking_id?: string
          date?: string
          start_time?: string | null
          end_time?: string | null
          team?: string[]
          notes?: string | null
          gcal_event_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      hk_incidents: {
        Row: {
          id: string
          booking_id: string
          description: string | null
          photo_urls: string[]
          created_at: string
        }
        Insert: {
          id?: string
          booking_id: string
          description?: string | null
          photo_urls?: string[]
          created_at?: string
        }
        Update: {
          id?: string
          booking_id?: string
          description?: string | null
          photo_urls?: string[]
          created_at?: string
        }
        Relationships: []
      }
      bar_sales: {
        Row: {
          id: string
          revolut_order_id: string
          paid_at: string
          amount: number
          currency: string
          qty_wine: number | null
          qty_coconut: number | null
          qty_soft: number | null
          state: string
          booking_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          revolut_order_id: string
          paid_at: string
          amount: number
          currency?: string
          qty_wine?: number | null
          qty_coconut?: number | null
          qty_soft?: number | null
          state?: string
          booking_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          revolut_order_id?: string
          paid_at?: string
          amount?: number
          currency?: string
          qty_wine?: number | null
          qty_coconut?: number | null
          qty_soft?: number | null
          state?: string
          booking_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      reminder_log: {
        Row: {
          booking_id: string | null
          created_at: string
          error: string | null
          id: string
          installment_id: string | null
          recipient: string
          status: string
          subject: string | null
          type: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          installment_id?: string | null
          recipient: string
          status?: string
          subject?: string | null
          type: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          installment_id?: string | null
          recipient?: string
          status?: string
          subject?: string | null
          type?: string
        }
        Relationships: []
      }
      pricing_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      bookings: {
        Row: {
          admin_managed: boolean
          edit_lock_override: boolean
          event_type: string
          catering_expected: boolean
          client_id: string | null
          check_in_time: string
          check_out_time: string
          google_calendar_event_id: string | null
          calendar_sync_status: string | null
          calendar_synced_at: string | null
          check_in_date: string | null
          check_out_date: string | null
          created_at: string
          created_by_admin: boolean
          deposit_amount: number | null
          disabled_rooms: number[]
          email: string
          first_name: string | null
          guest_count: number
          id: string
          internal_notes: string | null
          invitation_claimed: boolean
          invitation_expires_at: string | null
          invitation_token: string | null
          last_name: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          payment_status_override: string | null
          remaining_balance: number | null
          retreat_name: string
          total_rental_price: number | null
          rental_discount: number | null
          is_test: boolean
          updated_at: string
          user_id: string | null
          whatsapp_group_url: string | null
        }
        Insert: {
          admin_managed?: boolean
          edit_lock_override?: boolean
          event_type?: string
          catering_expected?: boolean
          client_id?: string | null
          check_in_time?: string
          check_out_time?: string
          google_calendar_event_id?: string | null
          calendar_sync_status?: string | null
          calendar_synced_at?: string | null
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          created_by_admin?: boolean
          deposit_amount?: number | null
          disabled_rooms?: number[]
          email: string
          first_name?: string | null
          guest_count?: number
          id?: string
          internal_notes?: string | null
          invitation_claimed?: boolean
          invitation_expires_at?: string | null
          invitation_token?: string | null
          last_name?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          payment_status_override?: string | null
          remaining_balance?: number | null
          retreat_name?: string
          total_rental_price?: number | null
          rental_discount?: number | null
          is_test?: boolean
          updated_at?: string
          user_id?: string | null
          whatsapp_group_url?: string | null
        }
        Update: {
          admin_managed?: boolean
          edit_lock_override?: boolean
          event_type?: string
          catering_expected?: boolean
          client_id?: string | null
          check_in_time?: string
          check_out_time?: string
          google_calendar_event_id?: string | null
          calendar_sync_status?: string | null
          calendar_synced_at?: string | null
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          created_by_admin?: boolean
          deposit_amount?: number | null
          disabled_rooms?: number[]
          email?: string
          first_name?: string | null
          guest_count?: number
          id?: string
          internal_notes?: string | null
          invitation_claimed?: boolean
          invitation_expires_at?: string | null
          invitation_token?: string | null
          last_name?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          payment_status_override?: string | null
          remaining_balance?: number | null
          retreat_name?: string
          total_rental_price?: number | null
          rental_discount?: number | null
          is_test?: boolean
          updated_at?: string
          user_id?: string | null
          whatsapp_group_url?: string | null
        }
        Relationships: []
      }
      client_profiles: {
        Row: {
          address: string | null
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          nationality: string | null
          notes: string | null
          phone: string | null
          tax_number: string | null
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          nationality?: string | null
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          nationality?: string | null
          notes?: string | null
          phone?: string | null
          tax_number?: string | null
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      deleted_entries_log: {
        Row: {
          also_deleted_auth_user: boolean
          deleted_at: string
          deleted_by_admin: string
          deleted_guest_email: string | null
          deleted_guest_id: string
          id: string
        }
        Insert: {
          also_deleted_auth_user?: boolean
          deleted_at?: string
          deleted_by_admin: string
          deleted_guest_email?: string | null
          deleted_guest_id: string
          id?: string
        }
        Update: {
          also_deleted_auth_user?: boolean
          deleted_at?: string
          deleted_by_admin?: string
          deleted_guest_email?: string | null
          deleted_guest_id?: string
          id?: string
        }
        Relationships: []
      }
      docs_ack: {
        Row: {
          booking_id: string | null
          id: string
          last_viewed_at: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          id?: string
          last_viewed_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          id?: string
          last_viewed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "docs_ack_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      food_plans: {
        Row: {
          booking_id: string | null
          created_at: string
          diet_config: Json
          diet_preference: string | null
          id: string
          meal_times: Json
          notes_food: string | null
          selections: Json
          status_food: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          diet_config?: Json
          diet_preference?: string | null
          id?: string
          meal_times?: Json
          notes_food?: string | null
          selections?: Json
          status_food?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          diet_config?: Json
          diet_preference?: string | null
          id?: string
          meal_times?: Json
          notes_food?: string | null
          selections?: Json
          status_food?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "food_plans_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      event_staff: {
        Row: {
          booking_id: string
          created_at: string
          daily_fee: number
          id: string
          name: string
          notes: string | null
          paid_days: number
          role: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          daily_fee?: number
          id?: string
          name: string
          notes?: string | null
          paid_days?: number
          role?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          daily_fee?: number
          id?: string
          name?: string
          notes?: string | null
          paid_days?: number
          role?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      guest_profiles: {
        Row: {
          check_in_date: string | null
          check_out_date: string | null
          created_at: string
          email: string
          first_name: string | null
          full_name: string
          guests_count: number | null
          id: string
          last_name: string | null
          status_overall: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          full_name: string
          guests_count?: number | null
          id?: string
          last_name?: string | null
          status_overall?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          full_name?: string
          guests_count?: number | null
          id?: string
          last_name?: string | null
          status_overall?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_installments: {
        Row: {
          amount_due: number
          amount_excl_vat: number | null
          payment_link: string | null
          booking_id: string
          category: string
          created_at: string
          due_date: string | null
          id: string
          invoice_file_name: string | null
          is_cash: boolean
          moloni_document_id: number | null
          vat_rate: number | null
          paid_usd: number | null
          group_id: string | null
          usd_rate: number | null
          stripe_session_id: string | null
          invoice_number: string | null
          invoice_file_url: string | null
          label: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_excl_vat?: number | null
          payment_link?: string | null
          booking_id: string
          category?: string
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_file_name?: string | null
          is_cash?: boolean
          moloni_document_id?: number | null
          vat_rate?: number | null
          paid_usd?: number | null
          group_id?: string | null
          usd_rate?: number | null
          stripe_session_id?: string | null
          invoice_number?: string | null
          invoice_file_url?: string | null
          label: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_excl_vat?: number | null
          payment_link?: string | null
          booking_id?: string
          category?: string
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_file_name?: string | null
          is_cash?: boolean
          moloni_document_id?: number | null
          vat_rate?: number | null
          paid_usd?: number | null
          group_id?: string | null
          usd_rate?: number | null
          stripe_session_id?: string | null
          invoice_number?: string | null
          invoice_file_url?: string | null
          label?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_installments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      room_setups: {
        Row: {
          booking_id: string | null
          created_at: string
          edit_token: string
          email: string
          full_name: string
          id: string
          queen_ensuite_qty: number
          queen_shared_qty: number
          remarks: string | null
          remarks_roomsetup: string | null
          room_plan: Json
          status: string
          status_roomsetup: string
          twins_ensuite_qty: number
          twins_shared_qty: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          edit_token: string
          email: string
          full_name: string
          id?: string
          queen_ensuite_qty?: number
          queen_shared_qty?: number
          remarks?: string | null
          remarks_roomsetup?: string | null
          room_plan?: Json
          status?: string
          status_roomsetup?: string
          twins_ensuite_qty?: number
          twins_shared_qty?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          edit_token?: string
          email?: string
          full_name?: string
          id?: string
          queen_ensuite_qty?: number
          queen_shared_qty?: number
          remarks?: string | null
          remarks_roomsetup?: string | null
          room_plan?: Json
          status?: string
          status_roomsetup?: string
          twins_ensuite_qty?: number
          twins_shared_qty?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "room_setups_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      transportation_passengers: {
        Row: {
          booking_id: string | null
          created_at: string
          first_name: string
          flight_number: string | null
          id: string
          phone: string
          trip_id: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          first_name: string
          flight_number?: string | null
          id?: string
          phone: string
          trip_id: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          first_name?: string
          flight_number?: string | null
          id?: string
          phone?: string
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transportation_passengers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transportation_passengers_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "transportation_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      transportation_requests: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          notes_transportation: string | null
          status_transportation: string
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          notes_transportation?: string | null
          status_transportation?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          notes_transportation?: string | null
          status_transportation?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transportation_requests_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      transportation_trips: {
        Row: {
          booking_id: string | null
          created_at: string
          custom_price: number | null
          dropoff_location: string
          google_calendar_event_id: string | null
          id: string
          last_synced_at: string | null
          passengers_count: number
          pickup_location: string
          price_estimate: string
          sync_error: string | null
          sync_status: string
          taxi_size: string
          trip_date: string
          trip_direction: string
          trip_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          custom_price?: number | null
          dropoff_location: string
          google_calendar_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          passengers_count?: number
          pickup_location: string
          price_estimate?: string
          sync_error?: string | null
          sync_status?: string
          taxi_size: string
          trip_date: string
          trip_direction: string
          trip_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          custom_price?: number | null
          dropoff_location?: string
          google_calendar_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          passengers_count?: number
          pickup_location?: string
          price_estimate?: string
          sync_error?: string | null
          sync_status?: string
          taxi_size?: string
          trip_date?: string
          trip_direction?: string
          trip_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transportation_trips_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      is_admin_email: { Args: never; Returns: boolean }
    }
    Enums: {
      payment_status: "pending" | "deposit_paid" | "paid_in_full" | "overdue"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      payment_status: ["pending", "deposit_paid", "paid_in_full", "overdue"],
    },
  },
} as const
