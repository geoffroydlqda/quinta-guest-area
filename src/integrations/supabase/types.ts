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
      docs_ack: {
        Row: {
          id: string
          last_viewed_at: string
          user_id: string
        }
        Insert: {
          id?: string
          last_viewed_at?: string
          user_id: string
        }
        Update: {
          id?: string
          last_viewed_at?: string
          user_id?: string
        }
        Relationships: []
      }
      food_plans: {
        Row: {
          created_at: string
          id: string
          notes_food: string | null
          selections: Json
          status_food: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes_food?: string | null
          selections?: Json
          status_food?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes_food?: string | null
          selections?: Json
          status_food?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      guest_profiles: {
        Row: {
          check_in_date: string | null
          check_out_date: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          check_in_date?: string | null
          check_out_date?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      room_setups: {
        Row: {
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
        Relationships: []
      }
      transportation_passengers: {
        Row: {
          created_at: string
          first_name: string
          flight_number: string | null
          id: string
          phone: string
          trip_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          first_name: string
          flight_number?: string | null
          id?: string
          phone: string
          trip_id: string
          user_id: string
        }
        Update: {
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
          created_at: string
          id: string
          notes_transportation: string | null
          status_transportation: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes_transportation?: string | null
          status_transportation?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes_transportation?: string | null
          status_transportation?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transportation_trips: {
        Row: {
          created_at: string
          dropoff_location: string
          id: string
          passengers_count: number
          pickup_location: string
          price_estimate: string
          taxi_size: string
          trip_date: string
          trip_direction: string
          trip_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dropoff_location: string
          id?: string
          passengers_count?: number
          pickup_location: string
          price_estimate?: string
          taxi_size: string
          trip_date: string
          trip_direction: string
          trip_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dropoff_location?: string
          id?: string
          passengers_count?: number
          pickup_location?: string
          price_estimate?: string
          taxi_size?: string
          trip_date?: string
          trip_direction?: string
          trip_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
