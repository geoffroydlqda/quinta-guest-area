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
      bookings: {
        Row: {
          check_in_date: string | null
          check_out_date: string | null
          created_at: string
          created_by_admin: boolean
          deposit_amount: number | null
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
          updated_at: string
          user_id: string | null
        }
        Insert: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          created_by_admin?: boolean
          deposit_amount?: number | null
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
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          created_by_admin?: boolean
          deposit_amount?: number | null
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
          updated_at?: string
          user_id?: string | null
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
          user_id: string
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
          user_id: string
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
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "food_plans_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
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
      invoices: {
        Row: {
          amount: number | null
          booking_id: string
          file_name: string
          file_url: string
          id: string
          label: string | null
          paid: boolean
          paid_at: string | null
          period: string
          type: string
          uploaded_at: string
        }
        Insert: {
          amount?: number | null
          booking_id: string
          file_name: string
          file_url: string
          id?: string
          label?: string | null
          paid?: boolean
          paid_at?: string | null
          period?: string
          type: string
          uploaded_at?: string
        }
        Update: {
          amount?: number | null
          booking_id?: string
          file_name?: string
          file_url?: string
          id?: string
          label?: string | null
          paid?: boolean
          paid_at?: string | null
          period?: string
          type?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_installments: {
        Row: {
          amount_due: number
          amount_paid: number
          booking_id: string
          created_at: string
          due_date: string | null
          id: string
          label: string
          notes: string | null
          paid_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_paid?: number
          booking_id: string
          created_at?: string
          due_date?: string | null
          id?: string
          label: string
          notes?: string | null
          paid_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          booking_id?: string
          created_at?: string
          due_date?: string | null
          id?: string
          label?: string
          notes?: string | null
          paid_at?: string | null
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
          user_id: string
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
          user_id: string
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
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_setups_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
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
