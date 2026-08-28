CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"governorate_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"is_served" boolean DEFAULT true NOT NULL,
	"is_remote" boolean DEFAULT false NOT NULL,
	"remote_surcharge_p" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "governorates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"zone_id" uuid NOT NULL,
	"is_served" boolean DEFAULT true NOT NULL,
	"sla_override_hours" integer,
	"cod_enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" text NOT NULL,
	"name_ar" text NOT NULL,
	"is_working_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" text,
	"close_time" text,
	"is_working_day" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"sla_working_hours" integer,
	"sla_working_days_min" integer,
	"sla_working_days_max" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" text,
	"after" text,
	"ip" text,
	"user_agent" text,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"governorate_id" uuid,
	"address" text,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"success" boolean NOT NULL,
	"failure_reason" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"device_label" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"username" text NOT NULL,
	"phone" text,
	"email" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"branch_id" uuid,
	"extra_permissions" text[] DEFAULT '{}' NOT NULL,
	"revoked_permissions" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"two_factor_secret" text,
	"two_factor_enabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid,
	"zone_id" uuid,
	"governorate_id" uuid,
	"basis" text DEFAULT 'per_delivery' NOT NULL,
	"amount_p" bigint NOT NULL,
	"conditions" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"calc_type" text NOT NULL,
	"value_p" bigint DEFAULT 0 NOT NULL,
	"percent_bp" integer DEFAULT 0 NOT NULL,
	"threshold_p" bigint DEFAULT 0 NOT NULL,
	"basis" text DEFAULT 'full_amount' NOT NULL,
	"applies_to" text DEFAULT 'shipment' NOT NULL,
	"is_auto" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_zone_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_code" text NOT NULL,
	"zone_id" uuid,
	"governorate_id" uuid,
	"value_p" bigint NOT NULL,
	"percent_bp" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_fee_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"fee_code" text NOT NULL,
	"value_p" bigint,
	"percent_bp" integer,
	"threshold_p" bigint,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_price_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"tier" text,
	"price_p" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_list_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"price_p" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"merchant_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"name_ar" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"value_type" text DEFAULT 'string' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"awb" text NOT NULL,
	"shipment_id" uuid,
	"scan_type" text NOT NULL,
	"branch_id" uuid,
	"user_id" uuid,
	"device_id" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resulting_status" text,
	"was_rejected" boolean DEFAULT false NOT NULL,
	"reject_reason" text
);
--> statement-breakpoint
CREATE TABLE "shipment_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"r2_key" text NOT NULL,
	"sha256" text,
	"size_bytes" integer,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"fee_code" text NOT NULL,
	"description_ar" text NOT NULL,
	"qty" numeric(10, 2) DEFAULT '1' NOT NULL,
	"unit_value_p" bigint NOT NULL,
	"amount_p" bigint NOT NULL,
	"is_estimate" boolean DEFAULT true NOT NULL,
	"is_auto" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"settlement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_reason_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"applies_to_status" text DEFAULT 'delivery_failed' NOT NULL,
	"requires_note" boolean DEFAULT false NOT NULL,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"counts_as_attempt" boolean DEFAULT true NOT NULL,
	"is_customer_fault" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason_code" text,
	"note" text,
	"actor_user_id" uuid,
	"actor_role" text,
	"actor_name" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"device_event_id" uuid,
	"lat" double precision,
	"lng" double precision,
	"was_offline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"awb" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"merchant_reference" text,
	"pickup_address_id" uuid,
	"service_type" text DEFAULT 'deliver' NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"recipient_phone_alt" text,
	"governorate_id" uuid NOT NULL,
	"area_id" uuid,
	"address_line" text NOT NULL,
	"landmark" text,
	"geo_lat" double precision,
	"geo_lng" double precision,
	"zone_id" uuid NOT NULL,
	"branch_id" uuid,
	"cod_amount_p" bigint DEFAULT 0 NOT NULL,
	"payment_method" text DEFAULT 'cash' NOT NULL,
	"shipping_payer" text DEFAULT 'merchant' NOT NULL,
	"declared_value_p" bigint DEFAULT 0 NOT NULL,
	"pieces_count" integer DEFAULT 1 NOT NULL,
	"allowed_open_pieces" integer DEFAULT 2 NOT NULL,
	"weight_registered_kg" numeric(6, 2),
	"weight_actual_kg" numeric(6, 2),
	"is_fragile" boolean DEFAULT false NOT NULL,
	"fragile_insured" boolean DEFAULT false NOT NULL,
	"allow_open" boolean DEFAULT false NOT NULL,
	"notes_to_courier" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reason_code" text,
	"attempts_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status_before_hold" text,
	"promised_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"first_assigned_at" timestamp with time zone,
	"current_courier_id" uuid,
	"current_run_sheet_id" uuid,
	"current_pickup_id" uuid,
	"price_p" bigint DEFAULT 0 NOT NULL,
	"price_list_id" uuid,
	"tier_snapshot" text,
	"total_fees_p" bigint DEFAULT 0 NOT NULL,
	"merchant_net_p" bigint DEFAULT 0 NOT NULL,
	"cod_collected_p" bigint,
	"cod_method" text,
	"settlement_id" uuid,
	"is_settled" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'staff' NOT NULL,
	"integration_id" uuid,
	"external_order_id" text,
	"import_batch_id" uuid,
	"linked_shipment_id" uuid,
	"created_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"type" text NOT NULL,
	"owner_type" text DEFAULT 'company' NOT NULL,
	"owner_id" uuid,
	"is_template" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"from_type" text NOT NULL,
	"from_id" uuid NOT NULL,
	"to_type" text NOT NULL,
	"to_id" uuid,
	"expected_p" bigint NOT NULL,
	"amount_p" bigint NOT NULL,
	"variance_p" bigint DEFAULT 0 NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"run_sheet_id" uuid,
	"receipt_no" text,
	"evidence_r2_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"variance_note" text,
	"variance_approved_by" uuid,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid NOT NULL,
	"source_run_sheet_id" uuid,
	"source_handover_id" uuid,
	"amount_p" bigint NOT NULL,
	"reason_ar" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"recovered_at" timestamp with time zone,
	"waived_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_no" bigserial NOT NULL,
	"entry_date" timestamp with time zone DEFAULT now() NOT NULL,
	"description_ar" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"kind" text NOT NULL,
	"created_by" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_by_entry_id" uuid,
	"reverses_entry_id" uuid,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reversal_reason" text
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_p" bigint DEFAULT 0 NOT NULL,
	"credit_p" bigint DEFAULT 0 NOT NULL,
	"shipment_id" uuid,
	"merchant_id" uuid,
	"courier_id" uuid,
	"memo" text,
	CONSTRAINT "jl_debit_xor_credit" CHECK ("journal_lines"."debit_p" >= 0 AND "journal_lines"."credit_p" >= 0 AND ("journal_lines"."debit_p" = 0) <> ("journal_lines"."credit_p" = 0))
);
--> statement-breakpoint
CREATE TABLE "merchant_balances" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"payable_confirmed_p" bigint DEFAULT 0 NOT NULL,
	"payable_in_collection_p" bigint DEFAULT 0 NOT NULL,
	"last_recomputed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" bigint NOT NULL,
	"cutoff_hour" bigint DEFAULT 12 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description_ar" text NOT NULL,
	"amount_p" bigint NOT NULL,
	"evidence_r2_key" text,
	"created_by" uuid,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"cod_collected_p" bigint DEFAULT 0 NOT NULL,
	"fees_p" bigint DEFAULT 0 NOT NULL,
	"net_p" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"gross_cod_p" bigint DEFAULT 0 NOT NULL,
	"total_fees_p" bigint DEFAULT 0 NOT NULL,
	"adjustments_p" bigint DEFAULT 0 NOT NULL,
	"net_payable_p" bigint DEFAULT 0 NOT NULL,
	"payout_method_id" uuid,
	"payout_reference" text,
	"proof_r2_key" text,
	"pdf_r2_key" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"second_approved_by" uuid,
	"second_approved_at" timestamp with time zone,
	"requires_two_approvals" boolean DEFAULT false NOT NULL,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"journal_entry_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "governorates" ADD CONSTRAINT "governorates_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_commission_rules" ADD CONSTRAINT "courier_commission_rules_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_commission_rules" ADD CONSTRAINT "courier_commission_rules_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_zone_overrides" ADD CONSTRAINT "fee_zone_overrides_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_zone_overrides" ADD CONSTRAINT "fee_zone_overrides_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_price_overrides" ADD CONSTRAINT "merchant_price_overrides_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_attachments" ADD CONSTRAINT "shipment_attachments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_attachments" ADD CONSTRAINT "shipment_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fees" ADD CONSTRAINT "shipment_fees_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fees" ADD CONSTRAINT "shipment_fees_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_fees" ADD CONSTRAINT "shipment_fees_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_notes" ADD CONSTRAINT "shipment_notes_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_notes" ADD CONSTRAINT "shipment_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_status_history" ADD CONSTRAINT "shipment_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_current_courier_id_users_id_fk" FOREIGN KEY ("current_courier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_variance_approved_by_users_id_fk" FOREIGN KEY ("variance_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_deductions" ADD CONSTRAINT "courier_deductions_source_handover_id_cash_handovers_id_fk" FOREIGN KEY ("source_handover_id") REFERENCES "public"."cash_handovers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_deductions" ADD CONSTRAINT "courier_deductions_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_adjustments" ADD CONSTRAINT "settlement_adjustments_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_second_approved_by_users_id_fk" FOREIGN KEY ("second_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_gov_idx" ON "areas" USING btree ("governorate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "areas_gov_name_uq" ON "areas" USING btree ("governorate_id","name_ar");--> statement-breakpoint
CREATE UNIQUE INDEX "governorates_code_uq" ON "governorates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "governorates_zone_idx" ON "governorates" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_date_uq" ON "holidays" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "working_hours_dow_uq" ON "working_hours" USING btree ("day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "zones_code_uq" ON "zones" USING btree ("code");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_time_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_code_uq" ON "branches" USING btree ("code");--> statement-breakpoint
CREATE INDEX "login_attempts_username_idx" ON "login_attempts" USING btree ("username","attempted_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","attempted_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role","is_active");--> statement-breakpoint
CREATE INDEX "users_branch_idx" ON "users" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "commission_courier_idx" ON "courier_commission_rules" USING btree ("courier_id");--> statement-breakpoint
CREATE INDEX "commission_zone_idx" ON "courier_commission_rules" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "commission_active_idx" ON "courier_commission_rules" USING btree ("is_active","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_definitions_code_uq" ON "fee_definitions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "fee_zone_ovr_code_idx" ON "fee_zone_overrides" USING btree ("fee_code");--> statement-breakpoint
CREATE INDEX "fee_zone_ovr_zone_idx" ON "fee_zone_overrides" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "fee_zone_ovr_gov_idx" ON "fee_zone_overrides" USING btree ("governorate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_fee_ovr_uq" ON "merchant_fee_overrides" USING btree ("merchant_id","fee_code","effective_from");--> statement-breakpoint
CREATE INDEX "merchant_price_ovr_idx" ON "merchant_price_overrides" USING btree ("merchant_id","zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_list_items_uq" ON "price_list_items" USING btree ("price_list_id","zone_id","tier");--> statement-breakpoint
CREATE INDEX "price_lists_scope_idx" ON "price_lists" USING btree ("scope","is_active");--> statement-breakpoint
CREATE INDEX "price_lists_merchant_idx" ON "price_lists" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "settings_category_idx" ON "settings" USING btree ("category");--> statement-breakpoint
CREATE INDEX "scan_events_awb_idx" ON "scan_events" USING btree ("awb","scanned_at");--> statement-breakpoint
CREATE INDEX "scan_events_user_idx" ON "scan_events" USING btree ("user_id","scanned_at");--> statement-breakpoint
CREATE INDEX "scan_events_rejected_idx" ON "scan_events" USING btree ("was_rejected","scanned_at");--> statement-breakpoint
CREATE INDEX "shipment_attachments_idx" ON "shipment_attachments" USING btree ("shipment_id","kind");--> statement-breakpoint
CREATE INDEX "shipment_fees_shipment_idx" ON "shipment_fees" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "shipment_fees_settlement_idx" ON "shipment_fees" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "shipment_fees_active_idx" ON "shipment_fees" USING btree ("shipment_id","fee_code") WHERE "shipment_fees"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "shipment_notes_idx" ON "shipment_notes" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "reason_codes_status_idx" ON "shipment_reason_codes" USING btree ("applies_to_status","is_active");--> statement-breakpoint
CREATE INDEX "ssh_shipment_idx" ON "shipment_status_history" USING btree ("shipment_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_device_event_uq" ON "shipment_status_history" USING btree ("shipment_id","device_event_id") WHERE "shipment_status_history"."device_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ssh_recorded_idx" ON "shipment_status_history" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "ssh_actor_idx" ON "shipment_status_history" USING btree ("actor_user_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_awb_uq" ON "shipments" USING btree ("awb");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_integration_order_uq" ON "shipments" USING btree ("integration_id","external_order_id") WHERE "shipments"."integration_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_merchant_ref_uq" ON "shipments" USING btree ("merchant_id","merchant_reference") WHERE "shipments"."merchant_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "shipments_merchant_created_idx" ON "shipments" USING btree ("merchant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "shipments_status_branch_idx" ON "shipments" USING btree ("status","branch_id");--> statement-breakpoint
CREATE INDEX "shipments_courier_status_idx" ON "shipments" USING btree ("current_courier_id","status");--> statement-breakpoint
CREATE INDEX "shipments_settlement_idx" ON "shipments" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "shipments_recipient_phone_idx" ON "shipments" USING btree ("recipient_phone");--> statement-breakpoint
CREATE INDEX "shipments_governorate_idx" ON "shipments" USING btree ("governorate_id","status");--> statement-breakpoint
CREATE INDEX "shipments_unsettled_idx" ON "shipments" USING btree ("delivered_at") WHERE "shipments"."is_settled" = false;--> statement-breakpoint
CREATE INDEX "shipments_promised_idx" ON "shipments" USING btree ("promised_at") WHERE "shipments"."delivered_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_owner_uq" ON "accounts" USING btree ("code","owner_id");--> statement-breakpoint
CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "accounts_type_idx" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_handovers_code_uq" ON "cash_handovers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "cash_handovers_from_idx" ON "cash_handovers" USING btree ("from_type","from_id","status");--> statement-breakpoint
CREATE INDEX "cash_handovers_status_idx" ON "cash_handovers" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "courier_deductions_idx" ON "courier_deductions" USING btree ("courier_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "je_source_kind_uq" ON "journal_entries" USING btree ("source_type","source_id","kind") WHERE "journal_entries"."is_reversal" = false;--> statement-breakpoint
CREATE INDEX "je_source_idx" ON "journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "je_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "je_kind_idx" ON "journal_entries" USING btree ("kind","entry_date");--> statement-breakpoint
CREATE INDEX "jl_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "jl_account_idx" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "jl_shipment_idx" ON "journal_lines" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "jl_merchant_idx" ON "journal_lines" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "jl_courier_idx" ON "journal_lines" USING btree ("courier_id");--> statement-breakpoint
CREATE INDEX "settlement_adj_idx" ON "settlement_adjustments" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_items_shipment_uq" ON "settlement_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "settlement_items_settlement_idx" ON "settlement_items" USING btree ("settlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_code_uq" ON "settlements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "settlements_merchant_idx" ON "settlements" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "settlements_status_idx" ON "settlements" USING btree ("status","cutoff_at");