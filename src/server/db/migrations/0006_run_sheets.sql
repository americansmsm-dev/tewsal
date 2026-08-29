CREATE TABLE "run_sheet_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_sheet_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_sheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"courier_id" uuid NOT NULL,
	"branch_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"shipments_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"commission_p" bigint DEFAULT 0 NOT NULL,
	"commission_entry_id" uuid,
	"notes" text,
	"dispatched_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_sheet_items" ADD CONSTRAINT "run_sheet_items_run_sheet_id_run_sheets_id_fk" FOREIGN KEY ("run_sheet_id") REFERENCES "public"."run_sheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sheet_items" ADD CONSTRAINT "run_sheet_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sheets" ADD CONSTRAINT "run_sheets_courier_id_users_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sheets" ADD CONSTRAINT "run_sheets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sheets" ADD CONSTRAINT "run_sheets_commission_entry_id_journal_entries_id_fk" FOREIGN KEY ("commission_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_sheets" ADD CONSTRAINT "run_sheets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_sheet_items_uq" ON "run_sheet_items" USING btree ("run_sheet_id","shipment_id");--> statement-breakpoint
CREATE INDEX "run_sheet_items_shipment_idx" ON "run_sheet_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_sheets_code_uq" ON "run_sheets" USING btree ("code");--> statement-breakpoint
CREATE INDEX "run_sheets_courier_idx" ON "run_sheets" USING btree ("courier_id","status");--> statement-breakpoint
CREATE INDEX "run_sheets_status_idx" ON "run_sheets" USING btree ("status","created_at");
