CREATE TABLE "return_shelves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"branch_id" uuid,
	"capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"merchant_id" uuid NOT NULL,
	"awb" text NOT NULL,
	"shelf_id" uuid,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"returned_at" timestamp with time zone,
	"disposed_at" timestamp with time zone,
	"disposal_reason" text,
	"disposal_approved_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "return_shelves" ADD CONSTRAINT "return_shelves_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_shelf_id_return_shelves_id_fk" FOREIGN KEY ("shelf_id") REFERENCES "public"."return_shelves"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_disposal_approved_by_users_id_fk" FOREIGN KEY ("disposal_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "return_shelves_code_uq" ON "return_shelves" USING btree ("code");--> statement-breakpoint
CREATE INDEX "return_shelves_active_idx" ON "return_shelves" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_shipment_uq" ON "returns" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "returns_merchant_idx" ON "returns" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "returns_shelf_idx" ON "returns" USING btree ("shelf_id");--> statement-breakpoint
CREATE INDEX "returns_entered_idx" ON "returns" USING btree ("entered_at");
