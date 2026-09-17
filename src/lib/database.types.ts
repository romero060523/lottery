export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string
          nombre: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          nombre?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          nombre?: string | null
          user_id?: string
        }
        Relationships: []
      }
      boletos: {
        Row: {
          cantidad_comprada: number
          cantidad_gratis: number
          cantidad_total: number | null
          codigo: string
          comprobante_url: string | null
          created_at: string
          estado: string
          id: string
          metodo_pago: string | null
          monto_total: number
          motivo_corregido_en: string | null
          motivo_corregido_por: string | null
          motivo_rechazo: string | null
          nombre_comprador: string
          numero_documento: string
          pendiente_desde: string | null
          sorteo_id: string
          telefono: string
          tipo_documento: string
          validado_en: string | null
          validado_por: string | null
        }
        Insert: {
          cantidad_comprada: number
          cantidad_gratis?: number
          cantidad_total?: number | null
          codigo: string
          comprobante_url?: string | null
          created_at?: string
          estado?: string
          id?: string
          metodo_pago?: string | null
          monto_total: number
          motivo_corregido_en?: string | null
          motivo_corregido_por?: string | null
          motivo_rechazo?: string | null
          nombre_comprador: string
          numero_documento: string
          pendiente_desde?: string | null
          sorteo_id: string
          telefono: string
          tipo_documento: string
          validado_en?: string | null
          validado_por?: string | null
        }
        Update: {
          cantidad_comprada?: number
          cantidad_gratis?: number
          cantidad_total?: number | null
          codigo?: string
          comprobante_url?: string | null
          created_at?: string
          estado?: string
          id?: string
          metodo_pago?: string | null
          monto_total?: number
          motivo_corregido_en?: string | null
          motivo_corregido_por?: string | null
          motivo_rechazo?: string | null
          nombre_comprador?: string
          numero_documento?: string
          pendiente_desde?: string | null
          sorteo_id?: string
          telefono?: string
          tipo_documento?: string
          validado_en?: string | null
          validado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boletos_motivo_corregido_por_fkey"
            columns: ["motivo_corregido_por"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "boletos_sorteo_id_fkey"
            columns: ["sorteo_id"]
            isOneToOne: false
            referencedRelation: "ediciones_en_cuarentena"
            referencedColumns: ["sorteo_id"]
          },
          {
            foreignKeyName: "boletos_sorteo_id_fkey"
            columns: ["sorteo_id"]
            isOneToOne: false
            referencedRelation: "sorteos"
            referencedColumns: ["id"]
          },
        ]
      }
      ganadores: {
        Row: {
          boleto_id: string | null
          ciudad: string | null
          created_at: string
          fecha_entrega: string | null
          foto_url: string | null
          id: string
          nombre_ganador: string
          premio_id: string | null
          sorteo_id: string
        }
        Insert: {
          boleto_id?: string | null
          ciudad?: string | null
          created_at?: string
          fecha_entrega?: string | null
          foto_url?: string | null
          id?: string
          nombre_ganador: string
          premio_id?: string | null
          sorteo_id: string
        }
        Update: {
          boleto_id?: string | null
          ciudad?: string | null
          created_at?: string
          fecha_entrega?: string | null
          foto_url?: string | null
          id?: string
          nombre_ganador?: string
          premio_id?: string | null
          sorteo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ganadores_boleto_id_fkey"
            columns: ["boleto_id"]
            isOneToOne: false
            referencedRelation: "boletos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ganadores_premio_id_fkey"
            columns: ["premio_id"]
            isOneToOne: false
            referencedRelation: "sorteo_premios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ganadores_sorteo_id_fkey"
            columns: ["sorteo_id"]
            isOneToOne: false
            referencedRelation: "ediciones_en_cuarentena"
            referencedColumns: ["sorteo_id"]
          },
          {
            foreignKeyName: "ganadores_sorteo_id_fkey"
            columns: ["sorteo_id"]
            isOneToOne: false
            referencedRelation: "sorteos"
            referencedColumns: ["id"]
          },
        ]
      }
      incidencias_caducidad: {
        Row: {
          boleto_id: string
          codigo_error: string
          intentos: number
          mensaje: string
          primera_incidencia_en: string
          registrado_en: string
          reintentar_desde: string
          sorteo_id: string
        }
        Insert: {
          boleto_id: string
          codigo_error: string
          intentos?: number
          mensaje: string
          primera_incidencia_en: string
          registrado_en: string
          reintentar_desde: string
          sorteo_id: string
        }
        Update: {
          boleto_id?: string
          codigo_error?: string
          intentos?: number
          mensaje?: string
          primera_incidencia_en?: string
          registrado_en?: string
          reintentar_desde?: string
          sorteo_id?: string
        }
        Relationships: []
      }
      sorteo_premios: {
        Row: {
          actualizado_por: string | null
          badge_label: string | null
          creado_por: string | null
          id: string
          imagen_url: string | null
          nombre: string
          orden: number
          sorteo_id: string
          tipo: string
          valor_referencial: number | null
        }
        Insert: {
          actualizado_por?: string | null
          badge_label?: string | null
          creado_por?: string | null
          id?: string
          imagen_url?: string | null
          nombre: string
          orden?: number
          sorteo_id: string
          tipo?: string
          valor_referencial?: number | null
        }
        Update: {
          actualizado_por?: string | null
          badge_label?: string | null
          creado_por?: string | null
          id?: string
          imagen_url?: string | null
          nombre?: string
          orden?: number
          sorteo_id?: string
          tipo?: string
          valor_referencial?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sorteo_premios_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sorteo_premios_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sorteo_premios_sorteo_id_fkey"
            columns: ["sorteo_id"]
            isOneToOne: false
            referencedRelation: "ediciones_en_cuarentena"
            referencedColumns: ["sorteo_id"]
          },
          {
            foreignKeyName: "sorteo_premios_sorteo_id_fkey"
            columns: ["sorteo_id"]
            isOneToOne: false
            referencedRelation: "sorteos"
            referencedColumns: ["id"]
          },
        ]
      }
      sorteos: {
        Row: {
          activo: boolean
          actualizado_por: string | null
          banner_url: string | null
          codigo_prefijo: string
          color_hex: string | null
          creado_por: string | null
          created_at: string
          descripcion: string | null
          edicion_numero: number
          fecha_fin_ventas: string | null
          fecha_inicio_ventas: string
          fecha_sorteo: string | null
          id: string
          max_tickets_por_compra: number
          nombre: string
          precio_boleto: number
          subtitulo: string | null
          tickets_totales: number
          tickets_vendidos: number
          ttl_pendientes_horas: number
        }
        Insert: {
          activo?: boolean
          actualizado_por?: string | null
          banner_url?: string | null
          codigo_prefijo?: string
          color_hex?: string | null
          creado_por?: string | null
          created_at?: string
          descripcion?: string | null
          edicion_numero: number
          fecha_fin_ventas?: string | null
          fecha_inicio_ventas?: string
          fecha_sorteo?: string | null
          id?: string
          max_tickets_por_compra?: number
          nombre: string
          precio_boleto: number
          subtitulo?: string | null
          tickets_totales: number
          tickets_vendidos?: number
          ttl_pendientes_horas?: number
        }
        Update: {
          activo?: boolean
          actualizado_por?: string | null
          banner_url?: string | null
          codigo_prefijo?: string
          color_hex?: string | null
          creado_por?: string | null
          created_at?: string
          descripcion?: string | null
          edicion_numero?: number
          fecha_fin_ventas?: string | null
          fecha_inicio_ventas?: string
          fecha_sorteo?: string | null
          id?: string
          max_tickets_por_compra?: number
          nombre?: string
          precio_boleto?: number
          subtitulo?: string | null
          tickets_totales?: number
          tickets_vendidos?: number
          ttl_pendientes_horas?: number
        }
        Relationships: [
          {
            foreignKeyName: "sorteos_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sorteos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "admins"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      ediciones_en_cuarentena: {
        Row: {
          cuarentena_desde: string | null
          edicion_numero: number | null
          motivos: Json | null
          nombre: string | null
          reintentar_desde: string | null
          sorteo_id: string | null
          ultimo_fallo_en: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      caducar_boletos_pendientes: { Args: never; Returns: number }
      calcular_monto_total: {
        Args: { p_cantidad: number; p_precio_boleto: number }
        Returns: {
          cantidad_comprada: number
          cantidad_total: number
          monto_total: number
          tickets_gratis: number
        }[]
      }
      calcular_tickets_gratis: { Args: { cantidad: number }; Returns: number }
      comprar_tickets: {
        Args: {
          p_cantidad: number
          p_nombre_comprador: string
          p_numero_documento: string
          p_sorteo_id: string
          p_telefono: string
          p_tipo_documento: string
        }
        Returns: {
          cantidad_comprada: number
          cantidad_gratis: number
          cantidad_total: number | null
          codigo: string
          comprobante_url: string | null
          created_at: string
          estado: string
          id: string
          metodo_pago: string | null
          monto_total: number
          motivo_corregido_en: string | null
          motivo_corregido_por: string | null
          motivo_rechazo: string | null
          nombre_comprador: string
          numero_documento: string
          pendiente_desde: string | null
          sorteo_id: string
          telefono: string
          tipo_documento: string
          validado_en: string | null
          validado_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "boletos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

