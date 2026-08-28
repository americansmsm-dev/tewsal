CREATE TABLE "pickup_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pickup_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pickups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"pickup_address" text NOT NULL,
	"governorate_id" uuid,
	"contact_phone" text,
	"scheduled_date" text,
	"time_window" text,
	"courier_id" uuid,
	"status" text DEFAULT 'requested' NOT NULL,
	"orders_count" integer DEFAULT 0 NOT NULL,
	"service_fee_p" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"confirmed_at" timestamp with time zone,
	"journal_entry_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickup_shipments" ADD CONSTRAINT "pickup_shipments_pickup_id_pickups_id_fk" FOREIGN KEY ("pickup_id") REFERENCES "public"."pickups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_shipments" ADD CONSTRAINT "pickup_shipments_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_courier_id_users_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_shipments_shipment_uq" ON "pickup_shipments" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "pickup_shipments_pickup_idx" ON "pickup_shipments" USING btree ("pickup_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pickups_code_uq" ON "pickups" USING btree ("code");--> statement-breakpoint
CREATE INDEX "pickups_merchant_idx" ON "pickups" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "pickups_status_idx" ON "pickups" USING btree ("status","scheduled_date");--> statement-breakpoint
CREATE INDEX "pickups_courier_idx" ON "pickups" USING btree ("courier_id","status");