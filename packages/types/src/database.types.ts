export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      appointment: {
        Row: {
          address_id: string | null;
          assigned_member_id: string | null;
          business_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          ends_at: string;
          id: string;
          job_id: string | null;
          notes: string | null;
          quote_id: string | null;
          slot_option_id: string | null;
          starts_at: string;
          status: Database['public']['Enums']['appointment_status'];
          updated_at: string;
        };
        Insert: {
          address_id?: string | null;
          assigned_member_id?: string | null;
          business_id: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          ends_at: string;
          id?: string;
          job_id?: string | null;
          notes?: string | null;
          quote_id?: string | null;
          slot_option_id?: string | null;
          starts_at: string;
          status?: Database['public']['Enums']['appointment_status'];
          updated_at?: string;
        };
        Update: {
          address_id?: string | null;
          assigned_member_id?: string | null;
          business_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          ends_at?: string;
          id?: string;
          job_id?: string | null;
          notes?: string | null;
          quote_id?: string | null;
          slot_option_id?: string | null;
          starts_at?: string;
          status?: Database['public']['Enums']['appointment_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'appointment_business_id_address_id_fkey';
            columns: ['business_id', 'address_id'];
            isOneToOne: false;
            referencedRelation: 'customer_address';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'appointment_business_id_assigned_member_id_fkey';
            columns: ['business_id', 'assigned_member_id'];
            isOneToOne: false;
            referencedRelation: 'business_member';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'appointment_business_id_customer_id_fkey';
            columns: ['business_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'appointment_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'appointment_business_id_job_id_fkey';
            columns: ['business_id', 'job_id'];
            isOneToOne: false;
            referencedRelation: 'job';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'appointment_business_id_quote_id_fkey';
            columns: ['business_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'appointment_slot_option_fk';
            columns: ['business_id', 'slot_option_id'];
            isOneToOne: false;
            referencedRelation: 'quote_slot_option';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      audit_log: {
        Row: {
          action: Database['public']['Enums']['audit_action'];
          actor_user_id: string | null;
          business_id: string;
          created_at: string;
          id: string;
          new_data: Json | null;
          old_data: Json | null;
          record_id: string | null;
          table_name: string;
        };
        Insert: {
          action: Database['public']['Enums']['audit_action'];
          actor_user_id?: string | null;
          business_id: string;
          created_at?: string;
          id?: string;
          new_data?: Json | null;
          old_data?: Json | null;
          record_id?: string | null;
          table_name: string;
        };
        Update: {
          action?: Database['public']['Enums']['audit_action'];
          actor_user_id?: string | null;
          business_id?: string;
          created_at?: string;
          id?: string;
          new_data?: Json | null;
          old_data?: Json | null;
          record_id?: string | null;
          table_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      business: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          email: string | null;
          id: string;
          legal_name: string | null;
          logo_path: string | null;
          name: string;
          phone_e164: string | null;
          tax_id: string | null;
          tax_status: Database['public']['Enums']['tax_status'] | null;
          trade: Database['public']['Enums']['business_trade'] | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          legal_name?: string | null;
          logo_path?: string | null;
          name: string;
          phone_e164?: string | null;
          tax_id?: string | null;
          tax_status?: Database['public']['Enums']['tax_status'] | null;
          trade?: Database['public']['Enums']['business_trade'] | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          legal_name?: string | null;
          logo_path?: string | null;
          name?: string;
          phone_e164?: string | null;
          tax_id?: string | null;
          tax_status?: Database['public']['Enums']['tax_status'] | null;
          trade?: Database['public']['Enums']['business_trade'] | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      business_member: {
        Row: {
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          role: Database['public']['Enums']['member_role'];
          status: Database['public']['Enums']['member_status'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          role?: Database['public']['Enums']['member_role'];
          status?: Database['public']['Enums']['member_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'business_member_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      business_settings: {
        Row: {
          business_id: string;
          created_at: string;
          currency: string;
          invoice_provider: string;
          next_invoice_number: number;
          next_quote_number: number;
          quote_valid_days: number;
          timezone: string;
          updated_at: string;
          vat_rate_bp: number;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          currency?: string;
          invoice_provider?: string;
          next_invoice_number?: number;
          next_quote_number?: number;
          quote_valid_days?: number;
          timezone?: string;
          updated_at?: string;
          vat_rate_bp?: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          currency?: string;
          invoice_provider?: string;
          next_invoice_number?: number;
          next_quote_number?: number;
          quote_valid_days?: number;
          timezone?: string;
          updated_at?: string;
          vat_rate_bp?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'business_settings_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: true;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      customer: {
        Row: {
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          email: string | null;
          full_name: string;
          id: string;
          notes: string | null;
          phone_e164: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          full_name: string;
          id?: string;
          notes?: string | null;
          phone_e164: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          full_name?: string;
          id?: string;
          notes?: string | null;
          phone_e164?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_address: {
        Row: {
          access_notes: string | null;
          apartment: string | null;
          business_id: string;
          city: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          house_number: string | null;
          id: string;
          is_primary: boolean;
          label: string | null;
          postal_code: string | null;
          street: string;
          updated_at: string;
        };
        Insert: {
          access_notes?: string | null;
          apartment?: string | null;
          business_id: string;
          city: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          house_number?: string | null;
          id?: string;
          is_primary?: boolean;
          label?: string | null;
          postal_code?: string | null;
          street: string;
          updated_at?: string;
        };
        Update: {
          access_notes?: string | null;
          apartment?: string | null;
          business_id?: string;
          city?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          house_number?: string | null;
          id?: string;
          is_primary?: boolean;
          label?: string | null;
          postal_code?: string | null;
          street?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_address_business_id_customer_id_fkey';
            columns: ['business_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'customer_address_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      file: {
        Row: {
          bucket: string;
          business_id: string;
          created_at: string;
          customer_id: string | null;
          deleted_at: string | null;
          id: string;
          invoice_id: string | null;
          job_id: string | null;
          kind: Database['public']['Enums']['file_kind'];
          mime_type: string | null;
          quote_id: string | null;
          size_bytes: number | null;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          bucket: string;
          business_id: string;
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          id?: string;
          invoice_id?: string | null;
          job_id?: string | null;
          kind?: Database['public']['Enums']['file_kind'];
          mime_type?: string | null;
          quote_id?: string | null;
          size_bytes?: number | null;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          bucket?: string;
          business_id?: string;
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          id?: string;
          invoice_id?: string | null;
          job_id?: string | null;
          kind?: Database['public']['Enums']['file_kind'];
          mime_type?: string | null;
          quote_id?: string | null;
          size_bytes?: number | null;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'file_business_id_customer_id_fkey';
            columns: ['business_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'file_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_business_id_invoice_id_fkey';
            columns: ['business_id', 'invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoice';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'file_business_id_job_id_fkey';
            columns: ['business_id', 'job_id'];
            isOneToOne: false;
            referencedRelation: 'job';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'file_business_id_quote_id_fkey';
            columns: ['business_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      invoice: {
        Row: {
          business_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          discount_minor: number;
          document_number: string | null;
          due_date: string | null;
          failed_at: string | null;
          failure_reason: string | null;
          id: string;
          idempotency_key: string | null;
          invoice_number: number;
          issued_at: string | null;
          job_id: string | null;
          notes: string | null;
          paid_at: string | null;
          provider: string;
          provider_document_id: string | null;
          quote_id: string | null;
          sent_at: string | null;
          snapshot: Json | null;
          status: Database['public']['Enums']['invoice_status'];
          subtotal_minor: number;
          total_minor: number;
          updated_at: string;
          vat_minor: number;
          vat_rate_bp: number;
          void_reason: string | null;
          voided_at: string | null;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          discount_minor?: number;
          document_number?: string | null;
          due_date?: string | null;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          idempotency_key?: string | null;
          invoice_number?: number;
          issued_at?: string | null;
          job_id?: string | null;
          notes?: string | null;
          paid_at?: string | null;
          provider?: string;
          provider_document_id?: string | null;
          quote_id?: string | null;
          sent_at?: string | null;
          snapshot?: Json | null;
          status?: Database['public']['Enums']['invoice_status'];
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
          vat_minor?: number;
          vat_rate_bp?: number;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          discount_minor?: number;
          document_number?: string | null;
          due_date?: string | null;
          failed_at?: string | null;
          failure_reason?: string | null;
          id?: string;
          idempotency_key?: string | null;
          invoice_number?: number;
          issued_at?: string | null;
          job_id?: string | null;
          notes?: string | null;
          paid_at?: string | null;
          provider?: string;
          provider_document_id?: string | null;
          quote_id?: string | null;
          sent_at?: string | null;
          snapshot?: Json | null;
          status?: Database['public']['Enums']['invoice_status'];
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
          vat_minor?: number;
          vat_rate_bp?: number;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_business_id_customer_id_fkey';
            columns: ['business_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'invoice_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_business_id_job_id_fkey';
            columns: ['business_id', 'job_id'];
            isOneToOne: false;
            referencedRelation: 'job';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'invoice_business_id_quote_id_fkey';
            columns: ['business_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      invoice_item: {
        Row: {
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          description: string;
          id: string;
          invoice_id: string;
          line_total_minor: number;
          quantity: number;
          service_id: string | null;
          sort_order: number;
          unit: string;
          unit_price_minor: number;
          updated_at: string;
          vat_included: boolean;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          description: string;
          id?: string;
          invoice_id: string;
          line_total_minor: number;
          quantity?: number;
          service_id?: string | null;
          sort_order?: number;
          unit?: string;
          unit_price_minor: number;
          updated_at?: string;
          vat_included?: boolean;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string;
          id?: string;
          invoice_id?: string;
          line_total_minor?: number;
          quantity?: number;
          service_id?: string | null;
          sort_order?: number;
          unit?: string;
          unit_price_minor?: number;
          updated_at?: string;
          vat_included?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'invoice_item_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoice_item_business_id_invoice_id_fkey';
            columns: ['business_id', 'invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoice';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'invoice_item_business_id_service_id_fkey';
            columns: ['business_id', 'service_id'];
            isOneToOne: false;
            referencedRelation: 'service';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      job: {
        Row: {
          address_id: string | null;
          assigned_member_id: string | null;
          business_id: string;
          completed_at: string | null;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          id: string;
          notes: string | null;
          quote_id: string | null;
          started_at: string | null;
          status: Database['public']['Enums']['job_status'];
          title: string;
          updated_at: string;
        };
        Insert: {
          address_id?: string | null;
          assigned_member_id?: string | null;
          business_id: string;
          completed_at?: string | null;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          id?: string;
          notes?: string | null;
          quote_id?: string | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['job_status'];
          title: string;
          updated_at?: string;
        };
        Update: {
          address_id?: string | null;
          assigned_member_id?: string | null;
          business_id?: string;
          completed_at?: string | null;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          id?: string;
          notes?: string | null;
          quote_id?: string | null;
          started_at?: string | null;
          status?: Database['public']['Enums']['job_status'];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'job_business_id_address_id_fkey';
            columns: ['business_id', 'address_id'];
            isOneToOne: false;
            referencedRelation: 'customer_address';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'job_business_id_assigned_member_id_fkey';
            columns: ['business_id', 'assigned_member_id'];
            isOneToOne: false;
            referencedRelation: 'business_member';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'job_business_id_customer_id_fkey';
            columns: ['business_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'job_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'job_business_id_quote_id_fkey';
            columns: ['business_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      notification: {
        Row: {
          business_id: string;
          channel: Database['public']['Enums']['notification_channel'];
          created_at: string;
          customer_id: string | null;
          deleted_at: string | null;
          error: string | null;
          id: string;
          payload: NonNullable<Json>;
          read_at: string | null;
          recipient_user_id: string | null;
          sent_at: string | null;
          status: Database['public']['Enums']['notification_status'];
          template: string;
          to_address: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          channel: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          error?: string | null;
          id?: string;
          payload?: NonNullable<Json>;
          read_at?: string | null;
          recipient_user_id?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          template: string;
          to_address?: string | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          channel?: Database['public']['Enums']['notification_channel'];
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          error?: string | null;
          id?: string;
          payload?: NonNullable<Json>;
          read_at?: string | null;
          recipient_user_id?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          template?: string;
          to_address?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_business_id_customer_id_fkey';
            columns: ['business_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'notification_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      payment: {
        Row: {
          amount_minor: number;
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          invoice_id: string;
          method: Database['public']['Enums']['payment_method'];
          notes: string | null;
          paid_at: string | null;
          reference: string | null;
          status: Database['public']['Enums']['payment_status'];
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          invoice_id: string;
          method: Database['public']['Enums']['payment_method'];
          notes?: string | null;
          paid_at?: string | null;
          reference?: string | null;
          status?: Database['public']['Enums']['payment_status'];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          invoice_id?: string;
          method?: Database['public']['Enums']['payment_method'];
          notes?: string | null;
          paid_at?: string | null;
          reference?: string | null;
          status?: Database['public']['Enums']['payment_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_business_id_invoice_id_fkey';
            columns: ['business_id', 'invoice_id'];
            isOneToOne: false;
            referencedRelation: 'invoice';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      quote: {
        Row: {
          address_id: string | null;
          approved_at: string | null;
          approved_ip: unknown;
          approved_name: string | null;
          business_id: string;
          cancelled_at: string | null;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          discount_minor: number;
          discount_type: string;
          discount_value: number;
          id: string;
          notes: string | null;
          quote_number: number | null;
          rejected_at: string | null;
          rejected_ip: unknown;
          rejected_reason: string | null;
          revision: number;
          root_quote_id: string | null;
          send_key: string | null;
          sent_at: string | null;
          sent_snapshot: Json | null;
          status: Database['public']['Enums']['quote_status'];
          subtotal_minor: number;
          superseded_at: string | null;
          supersedes_quote_id: string | null;
          title: string | null;
          token_expires_at: string | null;
          token_hash: string | null;
          token_revoked_at: string | null;
          total_minor: number;
          updated_at: string;
          valid_until: string | null;
          vat_minor: number;
          vat_rate_bp: number;
          viewed_at: string | null;
        };
        Insert: {
          address_id?: string | null;
          approved_at?: string | null;
          approved_ip?: unknown;
          approved_name?: string | null;
          business_id: string;
          cancelled_at?: string | null;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          discount_minor?: number;
          discount_type?: string;
          discount_value?: number;
          id?: string;
          notes?: string | null;
          quote_number?: number | null;
          rejected_at?: string | null;
          rejected_ip?: unknown;
          rejected_reason?: string | null;
          revision?: number;
          root_quote_id?: string | null;
          send_key?: string | null;
          sent_at?: string | null;
          sent_snapshot?: Json | null;
          status?: Database['public']['Enums']['quote_status'];
          subtotal_minor?: number;
          superseded_at?: string | null;
          supersedes_quote_id?: string | null;
          title?: string | null;
          token_expires_at?: string | null;
          token_hash?: string | null;
          token_revoked_at?: string | null;
          total_minor?: number;
          updated_at?: string;
          valid_until?: string | null;
          vat_minor?: number;
          vat_rate_bp?: number;
          viewed_at?: string | null;
        };
        Update: {
          address_id?: string | null;
          approved_at?: string | null;
          approved_ip?: unknown;
          approved_name?: string | null;
          business_id?: string;
          cancelled_at?: string | null;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          discount_minor?: number;
          discount_type?: string;
          discount_value?: number;
          id?: string;
          notes?: string | null;
          quote_number?: number | null;
          rejected_at?: string | null;
          rejected_ip?: unknown;
          rejected_reason?: string | null;
          revision?: number;
          root_quote_id?: string | null;
          send_key?: string | null;
          sent_at?: string | null;
          sent_snapshot?: Json | null;
          status?: Database['public']['Enums']['quote_status'];
          subtotal_minor?: number;
          superseded_at?: string | null;
          supersedes_quote_id?: string | null;
          title?: string | null;
          token_expires_at?: string | null;
          token_hash?: string | null;
          token_revoked_at?: string | null;
          total_minor?: number;
          updated_at?: string;
          valid_until?: string | null;
          vat_minor?: number;
          vat_rate_bp?: number;
          viewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_business_id_address_id_fkey';
            columns: ['business_id', 'address_id'];
            isOneToOne: false;
            referencedRelation: 'customer_address';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'quote_business_id_customer_id_fkey';
            columns: ['business_id', 'customer_id'];
            isOneToOne: false;
            referencedRelation: 'customer';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'quote_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_root_fk';
            columns: ['business_id', 'root_quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'quote_supersedes_fk';
            columns: ['business_id', 'supersedes_quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      quote_comment: {
        Row: {
          author: string;
          body: string;
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          ip: unknown;
          quote_id: string;
          updated_at: string;
        };
        Insert: {
          author: string;
          body: string;
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          ip?: unknown;
          quote_id: string;
          updated_at?: string;
        };
        Update: {
          author?: string;
          body?: string;
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          ip?: unknown;
          quote_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_comment_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_comment_business_id_quote_id_fkey';
            columns: ['business_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      quote_item: {
        Row: {
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          description: string;
          id: string;
          line_total_minor: number;
          quantity: number;
          quote_id: string;
          service_id: string | null;
          sort_order: number;
          unit: string;
          unit_price_minor: number;
          updated_at: string;
          vat_included: boolean;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          description: string;
          id?: string;
          line_total_minor: number;
          quantity?: number;
          quote_id: string;
          service_id?: string | null;
          sort_order?: number;
          unit?: string;
          unit_price_minor: number;
          updated_at?: string;
          vat_included?: boolean;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          description?: string;
          id?: string;
          line_total_minor?: number;
          quantity?: number;
          quote_id?: string;
          service_id?: string | null;
          sort_order?: number;
          unit?: string;
          unit_price_minor?: number;
          updated_at?: string;
          vat_included?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_item_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_item_business_id_quote_id_fkey';
            columns: ['business_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'quote_item_business_id_service_id_fkey';
            columns: ['business_id', 'service_id'];
            isOneToOne: false;
            referencedRelation: 'service';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      quote_slot_option: {
        Row: {
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          ends_at: string;
          id: string;
          quote_id: string;
          sort_order: number;
          starts_at: string;
          status: Database['public']['Enums']['quote_slot_option_status'];
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          ends_at: string;
          id?: string;
          quote_id: string;
          sort_order?: number;
          starts_at: string;
          status?: Database['public']['Enums']['quote_slot_option_status'];
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          ends_at?: string;
          id?: string;
          quote_id?: string;
          sort_order?: number;
          starts_at?: string;
          status?: Database['public']['Enums']['quote_slot_option_status'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'quote_slot_option_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'quote_slot_option_business_id_quote_id_fkey';
            columns: ['business_id', 'quote_id'];
            isOneToOne: false;
            referencedRelation: 'quote';
            referencedColumns: ['business_id', 'id'];
          },
        ];
      };
      service: {
        Row: {
          business_id: string;
          category_id: string | null;
          created_at: string;
          default_price_minor: number;
          deleted_at: string | null;
          description: string | null;
          id: string;
          is_active: boolean;
          is_favorite: boolean;
          last_used_at: string | null;
          name: string;
          starter_key: string | null;
          unit: string;
          updated_at: string;
          vat_included: boolean;
        };
        Insert: {
          business_id: string;
          category_id?: string | null;
          created_at?: string;
          default_price_minor?: number;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_favorite?: boolean;
          last_used_at?: string | null;
          name: string;
          starter_key?: string | null;
          unit?: string;
          updated_at?: string;
          vat_included?: boolean;
        };
        Update: {
          business_id?: string;
          category_id?: string | null;
          created_at?: string;
          default_price_minor?: number;
          deleted_at?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          is_favorite?: boolean;
          last_used_at?: string | null;
          name?: string;
          starter_key?: string | null;
          unit?: string;
          updated_at?: string;
          vat_included?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'service_business_id_category_id_fkey';
            columns: ['business_id', 'category_id'];
            isOneToOne: false;
            referencedRelation: 'service_category';
            referencedColumns: ['business_id', 'id'];
          },
          {
            foreignKeyName: 'service_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      service_category: {
        Row: {
          business_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          name: string;
          sort_order: number;
          starter_key: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name: string;
          sort_order?: number;
          starter_key?: string | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name?: string;
          sort_order?: number;
          starter_key?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'service_category_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: false;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      subscription: {
        Row: {
          business_id: string;
          cancel_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          deleted_at: string | null;
          id: string;
          plan_code: string;
          provider: string | null;
          provider_subscription_id: string | null;
          status: Database['public']['Enums']['subscription_status'];
          trial_ends_at: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          cancel_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          deleted_at?: string | null;
          id?: string;
          plan_code: string;
          provider?: string | null;
          provider_subscription_id?: string | null;
          status?: Database['public']['Enums']['subscription_status'];
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          cancel_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          deleted_at?: string | null;
          id?: string;
          plan_code?: string;
          provider?: string | null;
          provider_subscription_id?: string | null;
          status?: Database['public']['Enums']['subscription_status'];
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscription_business_id_fkey';
            columns: ['business_id'];
            isOneToOne: true;
            referencedRelation: 'business';
            referencedColumns: ['id'];
          },
        ];
      };
      user_profile: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          full_name: string | null;
          id: string;
          locale: string;
          phone_e164: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          full_name?: string | null;
          id: string;
          locale?: string;
          phone_e164?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          full_name?: string | null;
          id?: string;
          locale?: string;
          phone_e164?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cancel_quote: { Args: { p_quote_id: string }; Returns: undefined };
      create_business: { Args: { p_name: string }; Returns: string };
      create_invoice: {
        Args: { p_idempotency_key: string; p_job_id: string; p_user_id: string };
        Returns: {
          already_created: boolean;
          invoice_id: string;
        }[];
      };
      hit_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      import_starter_price_list: { Args: { p_business_id: string; p_list: Json }; Returns: number };
      public_quote_comment: {
        Args: { p_body: string; p_ip: unknown; p_token_hash: string };
        Returns: boolean;
      };
      public_quote_open: { Args: { p_ip: unknown; p_token_hash: string }; Returns: Json };
      public_quote_respond: {
        Args: {
          p_action: string;
          p_ip: unknown;
          p_name: string;
          p_reason: string;
          p_token_hash: string;
        };
        Returns: Json;
      };
      public_quote_schedule: {
        Args: { p_ip: unknown; p_slot_id: string; p_token_hash: string };
        Returns: Json;
      };
      revise_quote: { Args: { p_new_quote_id: string; p_quote_id: string }; Returns: string };
      save_quote_draft: { Args: { p_quote: Json }; Returns: undefined };
      send_quote: {
        Args: {
          p_quote_id: string;
          p_send_key: string;
          p_slots?: Json;
          p_snapshot: Json;
          p_token_expires_at: string;
          p_token_hash: string;
          p_totals: Json;
          p_user_id: string;
        };
        Returns: {
          already_sent: boolean;
          quote_number: number;
          sent_at: string;
          token_stored: boolean;
        }[];
      };
      setup_business: {
        Args: {
          p_business_id: string;
          p_name: string;
          p_tax_status: Database['public']['Enums']['tax_status'];
          p_trade: Database['public']['Enums']['business_trade'];
        };
        Returns: string;
      };
      transition_invoice: {
        Args: {
          p_details?: Json;
          p_invoice_id: string;
          p_status: Database['public']['Enums']['invoice_status'];
          p_user_id: string;
        };
        Returns: {
          changed: boolean;
          status: Database['public']['Enums']['invoice_status'];
        }[];
      };
    };
    Enums: {
      appointment_status: 'proposed' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
      audit_action: 'insert' | 'update' | 'delete';
      business_trade:
        'electrician' | 'plumber' | 'hvac' | 'handyman' | 'locksmith' | 'painter' | 'other';
      file_kind: 'logo' | 'quote_attachment' | 'job_photo' | 'invoice_pdf' | 'signature' | 'other';
      invoice_status: 'not_issued' | 'issued' | 'sent' | 'paid' | 'failed' | 'voided';
      job_status: 'scheduled' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
      member_role: 'OWNER' | 'ADMIN' | 'EMPLOYEE';
      member_status: 'invited' | 'active' | 'disabled';
      notification_channel: 'sms' | 'whatsapp' | 'email' | 'push' | 'in_app';
      notification_status: 'queued' | 'sent' | 'delivered' | 'failed' | 'read';
      payment_method:
        'cash' | 'bank_transfer' | 'credit_card' | 'bit' | 'paybox' | 'check' | 'other';
      payment_status: 'pending' | 'succeeded' | 'failed' | 'refunded';
      quote_slot_option_status: 'offered' | 'selected' | 'declined';
      quote_status:
        | 'draft'
        | 'sent'
        | 'viewed'
        | 'approved'
        | 'rejected'
        | 'expired'
        | 'cancelled'
        | 'superseded';
      subscription_status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
      tax_status: 'osek_patur' | 'osek_murshe' | 'company';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      appointment_status: ['proposed', 'confirmed', 'completed', 'cancelled', 'no_show'],
      audit_action: ['insert', 'update', 'delete'],
      business_trade: [
        'electrician',
        'plumber',
        'hvac',
        'handyman',
        'locksmith',
        'painter',
        'other',
      ],
      file_kind: ['logo', 'quote_attachment', 'job_photo', 'invoice_pdf', 'signature', 'other'],
      invoice_status: ['not_issued', 'issued', 'sent', 'paid', 'failed', 'voided'],
      job_status: ['scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled'],
      member_role: ['OWNER', 'ADMIN', 'EMPLOYEE'],
      member_status: ['invited', 'active', 'disabled'],
      notification_channel: ['sms', 'whatsapp', 'email', 'push', 'in_app'],
      notification_status: ['queued', 'sent', 'delivered', 'failed', 'read'],
      payment_method: ['cash', 'bank_transfer', 'credit_card', 'bit', 'paybox', 'check', 'other'],
      payment_status: ['pending', 'succeeded', 'failed', 'refunded'],
      quote_slot_option_status: ['offered', 'selected', 'declined'],
      quote_status: [
        'draft',
        'sent',
        'viewed',
        'approved',
        'rejected',
        'expired',
        'cancelled',
        'superseded',
      ],
      subscription_status: ['trialing', 'active', 'past_due', 'cancelled', 'expired'],
      tax_status: ['osek_patur', 'osek_murshe', 'company'],
    },
  },
} as const;
