CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"shipment_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"awb" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"declared_value_p" bigint DEFAULT 0 NOT NULL,
	"suggested_amount_p" bigint DEFAULT 0 NOT NULL,
	"approved_amount_p" bigint,
	"is_fragile" boolean DEFAULT false NOT NULL,
	"fragile_insured" boolean DEFAULT false NOT NULL,
	"fragile_blocked" boolean DEFAULT false NOT NULL,
	"compensation_entry_id" uuid,
	"reject_reason" text,
	"notes" text,
	"opened_by_user_id" uuid,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_compensation_entry_id_journal_entries_id_fk" FOREIGN KEY ("compensation_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_code_uq" ON "claims" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_shipment_uq" ON "claims" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "claims_merchant_idx" ON "claims" USING btree ("merchant_id");
