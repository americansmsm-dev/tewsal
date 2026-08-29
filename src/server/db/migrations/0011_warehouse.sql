CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"branch_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL,
	"counted_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"unexpected_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_count_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_id" uuid NOT NULL,
	"awb" text NOT NULL,
	"shipment_id" uuid,
	"result" text NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"from_branch_id" uuid,
	"to_branch_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"shipments_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"dispatched_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_sheet_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_sheet_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_scans" ADD CONSTRAINT "inventory_count_scans_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_scans" ADD CONSTRAINT "inventory_count_scans_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_sheets" ADD CONSTRAINT "transfer_sheets_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_sheets" ADD CONSTRAINT "transfer_sheets_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_sheets" ADD CONSTRAINT "transfer_sheets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_sheet_items" ADD CONSTRAINT "transfer_sheet_items_transfer_sheet_id_transfer_sheets_id_fk" FOREIGN KEY ("transfer_sheet_id") REFERENCES "public"."transfer_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_sheet_items" ADD CONSTRAINT "transfer_sheet_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_code_uq" ON "inventory_counts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "inventory_counts_status_idx" ON "inventory_counts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_count_scans_uq" ON "inventory_count_scans" USING btree ("count_id","awb");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_sheets_code_uq" ON "transfer_sheets" USING btree ("code");--> statement-breakpoint
CREATE INDEX "transfer_sheets_status_idx" ON "transfer_sheets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "transfer_sheet_items_uq" ON "transfer_sheet_items" USING btree ("transfer_sheet_id","shipment_id");
