/**
 * ============================================================
 *  GET /api/v1/barcode — توليد باركود / QR كـ SVG
 * ------------------------------------------------------------
 *  ?text=...&type=code128|qrcode
 *  بيرجّع image/svg+xml — بيتستخدم في البوليصة بـ <img>.
 *  Code 128 لرقم البوليصة · QR للينك التتبع.
 * ============================================================
 */
import { type NextRequest, NextResponse } from "next/server";
import bwipjs from "bwip-js/node";
import { requireUser } from "@/server/http/context";
import { fail, handleError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const url = new URL(req.url);
    const text = url.searchParams.get("text");
    const type = url.searchParams.get("type") === "qrcode" ? "qrcode" : "code128";
    if (!text || text.length > 512) return fail("BAD_REQUEST", "نص غير صالح", 400);

    const svg =
      type === "qrcode"
        ? bwipjs.toSVG({ bcid: "qrcode", text, scale: 3 })
        : bwipjs.toSVG({
            bcid: "code128",
            text,
            scale: 3,
            height: 14,
            includetext: false,
            paddingwidth: 0,
            paddingheight: 0,
          });

    return new NextResponse(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
