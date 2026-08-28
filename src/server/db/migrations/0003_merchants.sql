CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"phone" text,
	"email" text,
	"tier" text DEFAULT 't1' NOT NULL,
	"cod_enabled" boolean DEFAULT true NOT NULL,
	"default_shipping_payer" text DEFAULT 'merchant' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_code_uq" ON "merchants" USING btree ("code");--> statement-breakpoint
CREATE INDEX "merchants_phone_idx" ON "merchants" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "merchants_active_idx" ON "merchants" USING btree ("is_active");