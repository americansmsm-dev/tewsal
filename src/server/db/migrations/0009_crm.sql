ALTER TABLE "merchants" ADD COLUMN "sales_rep_id" uuid;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "cs_rep_id" uuid;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "product_type" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "allowed_weight_kg" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "points" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "flyer_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_sales_rep_id_users_id_fk" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_cs_rep_id_users_id_fk" FOREIGN KEY ("cs_rep_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "customer_blacklist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"reason_ar" text NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_point_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"delta" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reason_ar" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_pickup_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"governorate_id" uuid,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"r2_key" text,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_blacklist" ADD CONSTRAINT "customer_blacklist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_point_events" ADD CONSTRAINT "merchant_point_events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_point_events" ADD CONSTRAINT "merchant_point_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_pickup_addresses" ADD CONSTRAINT "merchant_pickup_addresses_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_pickup_addresses" ADD CONSTRAINT "merchant_pickup_addresses_governorate_id_governorates_id_fk" FOREIGN KEY ("governorate_id") REFERENCES "public"."governorates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_blacklist_phone_uq" ON "customer_blacklist" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "merchant_point_events_idx" ON "merchant_point_events" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "merchant_pickup_addresses_idx" ON "merchant_pickup_addresses" USING btree ("merchant_id","is_active");--> statement-breakpoint
CREATE INDEX "merchant_documents_idx" ON "merchant_documents" USING btree ("merchant_id","expires_at");
