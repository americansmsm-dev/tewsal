CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"body_ar" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid,
	"shipment_id" uuid,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"to_phone" text NOT NULL,
	"event" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"cost_p" bigint DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"stars" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_ratings" ADD CONSTRAINT "delivery_ratings_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_key_uq" ON "notification_templates" USING btree ("key","channel");--> statement-breakpoint
CREATE INDEX "notification_log_merchant_idx" ON "notification_log" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_log_shipment_idx" ON "notification_log" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_ratings_shipment_uq" ON "delivery_ratings" USING btree ("shipment_id");
