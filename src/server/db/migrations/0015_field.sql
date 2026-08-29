CREATE TABLE "courier_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courier_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"courier_id" uuid NOT NULL,
	"day" text NOT NULL,
	"check_in_at" timestamp with time zone,
	"check_out_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "courier_locations" ADD CONSTRAINT "courier_locations_courier_id_users_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courier_attendance" ADD CONSTRAINT "courier_attendance_courier_id_users_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "courier_locations_idx" ON "courier_locations" USING btree ("courier_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "courier_attendance_uq" ON "courier_attendance" USING btree ("courier_id","day");
