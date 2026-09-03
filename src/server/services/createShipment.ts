/**
 * ============================================================
 *  إنشاء الشحنة — Create Shipment
 * ------------------------------------------------------------
 *  ⚠️ ده المكان الوحيد اللي بيعمل شحنة جديدة. بيعمل:
 *   ١) يتأكد من التاجر والمحافظة (مخدومة؟ التحصيل متاح؟)
 *   ٢) يحسب السعر والرسوم بـ pricing.ts **مرة واحدة**
 *   ٣) ياخد AWB من التسلسل + check digit
 *   ٤) يثبّت السعر والشريحة على الشحنة — عمرهم ما يتحسبوا تاني
 *   ٥) يخزّن بنود الرسوم (الرسوم الثابتة مؤكدة، والتحصيل تقدير)
 *   ٦) يكتب أول سطر تاريخ (مسودة)
 *   ٧) اختياريًا يأكّد الشحنة (draft → awaiting_pickup) بالبوابة
 *
 *  الفهارس الفريدة بتمنع الأوردر المكرر — بنترجم تعارضها
 *  لرسالة عربية واضحة.
 * ============================================================
 */
import { sql } from "drizzle-orm";
import { poundsToPiastres, type Piastres } from "@/lib/money";
import { buildAwb } from "@/lib/awb";
import { normalizeEgyptMobile } from "@/lib/phone";
import {
  calculateShipment,
  type PriceListEntry,
  type MerchantPriceOverride,
  type FeeDefinition,
  type FeeOverride,
  type ShipmentPricingInput,
} from "../domain/pricing";
import type { MerchantTier } from "../db/schema/pricing";
import { applyTransition, type Actor } from "./transition";
import { buildTransitionFinancialEntry } from "./shipmentFinancials";
import { isBlacklisted } from "./crm";
import { pullFromStock } from "./fulfillment";
import { walletBalance } from "./wallet";
import { formatEGP } from "@/lib/money";
import type { SqlExecutor } from "./ledger";
import { HttpError } from "../http/respond";

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export interface CreateShipmentInput {
  merchantId: string;
  recipientName: string;
  recipientPhone: string;
  recipientPhoneAlt?: string | null;
  governorateId: string;
  areaId?: string | null;
  addressLine: string;
  landmark?: string | null;
  /** بالجنيه — بيتحوّل لقروش */
  codAmount?: string;
  paymentMethod?: string;
  shippingPayer?: string;
  declaredValue?: string;
  piecesCount?: number;
  weightKg?: number | null;
  isFragile?: boolean;
  fragileInsured?: boolean;
  serviceType?: string;
  merchantReference?: string | null;
  notesToCourier?: string | null;
  /** سحب من مخزون التاجر (فُلفيلمنت) — بيخصم الكمية */
  productId?: string | null;
  productQty?: number;
  /** قطع الأوردر — للتسليم الجزئي بالقطعة. لو اتبعتت، التحصيل =
   *  مجموع أسعارها (بيتجاهل codAmount). كل price بالجنيه. */
  items?: { nameAr: string; sku?: string | null; qty?: number; price: string }[];
  /** لو true بيتأكد فورًا (draft → awaiting_pickup) */
  confirm?: boolean;
}

export interface CreateShipmentResult {
  id: string;
  awb: string;
  status: string;
  priceP: Piastres;
  totalFeesP: Piastres;
  merchantNetP: Piastres;
  tier: MerchantTier;
}

export async function createShipment(
  ex: SqlExecutor,
  input: CreateShipmentInput,
  actor: Actor
): Promise<CreateShipmentResult> {
  // ═══ ١) التاجر ═══
  const merchant = rowsOf<{
    id: string;
    tier: string;
    cod_enabled: boolean;
    is_active: boolean;
    default_shipping_payer: string;
  }>(
    await ex.execute(sql`
      SELECT id, tier, cod_enabled, is_active, default_shipping_payer
      FROM merchants WHERE id = ${input.merchantId}::uuid
    `)
  )[0];
  if (!merchant) throw new HttpError(404, "MERCHANT_NOT_FOUND", "التاجر مش موجود");
  if (!merchant.is_active) throw new HttpError(422, "MERCHANT_INACTIVE", "حساب التاجر موقوف");
  const tier = merchant.tier as MerchantTier;

  // ═══ ٢) المحافظة ═══
  const gov = rowsOf<{
    id: string;
    zone_id: string;
    cod_enabled: boolean;
    is_served: boolean;
  }>(
    await ex.execute(sql`
      SELECT id, zone_id, cod_enabled, is_served
      FROM governorates WHERE id = ${input.governorateId}::uuid
    `)
  )[0];
  if (!gov) throw new HttpError(404, "GOV_NOT_FOUND", "المحافظة مش موجودة");
  if (!gov.is_served) {
    throw new HttpError(422, "GOV_NOT_SERVED", "المحافظة دي خارج نطاق الخدمة حاليًا");
  }

  // ═══ ٣) المنطقة الفرعية (نائية؟) ═══
  let isRemote = false;
  let remoteSurchargeP: Piastres = 0n;
  if (input.areaId) {
    const area = rowsOf<{ is_remote: boolean; remote_surcharge_p: string; is_served: boolean }>(
      await ex.execute(sql`
        SELECT is_remote, remote_surcharge_p::text, is_served
        FROM areas WHERE id = ${input.areaId}::uuid AND governorate_id = ${gov.id}::uuid
      `)
    )[0];
    if (!area) throw new HttpError(422, "AREA_INVALID", "المنطقة مش تابعة للمحافظة دي");
    if (!area.is_served) throw new HttpError(422, "AREA_NOT_SERVED", "المنطقة دي خارج الخدمة");
    isRemote = area.is_remote;
    remoteSurchargeP = BigInt(area.remote_surcharge_p);
  }

  // ═══ ٤) التحصيل ═══
  // لو الأوردر متقسّم قطع، التحصيل = مجموع أسعارها (بيتجاهل codAmount).
  const items = input.items ?? [];
  let codAmountP = input.codAmount ? poundsToPiastres(input.codAmount) : 0n;
  if (items.length > 0) {
    codAmountP = items.reduce((s, it) => s + poundsToPiastres(it.price) * BigInt(it.qty ?? 1), 0n);
  }
  const paymentMethod = input.paymentMethod ?? "cash";
  const codEnabled = gov.cod_enabled && merchant.cod_enabled;
  if (codAmountP > 0n && paymentMethod !== "prepaid" && !codEnabled) {
    throw new HttpError(422, "COD_UNAVAILABLE", "خدمة التحصيل مش متاحة للتاجر ده في المحافظة دي");
  }

  const recipientPhone = normalizeEgyptMobile(input.recipientPhone);
  if (!recipientPhone) throw new HttpError(400, "BAD_PHONE", "رقم المستلم غير صالح");
  // ⚠️ العميل في القائمة السوداء (رفض متكرر) → منع الشحنة
  if (await isBlacklisted(ex, recipientPhone)) {
    throw new HttpError(422, "RECIPIENT_BLACKLISTED", "رقم المستلم في القائمة السوداء — راجع خدمة العملاء");
  }

  // ═══ ٥) حساب السعر والرسوم ═══
  const [priceList, priceOverrides, feeDefs, feeOverrides] = await Promise.all([
    loadPriceList(ex),
    loadMerchantOverrides(ex, merchant.id),
    loadFeeDefs(ex),
    loadFeeOverrides(ex),
  ]);

  const allowedOpenPieces = await numberSetting(ex, "shipment.allowed_open_pieces", 2);
  // رسوم التحصيل: settlement = مرة واحدة على إجمالي الفاتورة (الافتراضي) · shipment = على كل أوردر
  const codFeeAtSettlement = (await stringSetting(ex, "cod_fee.charge_at", "settlement")) === "settlement";

  const pricingInput: ShipmentPricingInput = {
    merchantId: merchant.id,
    tier,
    zoneId: gov.zone_id,
    governorateId: gov.id,
    codAmountP,
    paymentMethod,
    piecesCount: input.piecesCount ?? 1,
    allowedOpenPieces,
    weightRegisteredKg: input.weightKg ?? null,
    weightActualKg: input.weightKg ?? null,
    isFragile: input.isFragile ?? false,
    fragileInsured: input.fragileInsured ?? false,
    serviceType: input.serviceType ?? "deliver",
    codEnabled,
    codFeeAtSettlement,
    isRemoteArea: isRemote,
    remoteSurchargeP,
  };
  const priced = calculateShipment(
    pricingInput,
    priceList,
    priceOverrides,
    feeDefs,
    feeOverrides
  );

  // ═══ ٦) AWB من التسلسل ═══
  const seq = rowsOf<{ nextval: string }>(
    await ex.execute(sql`SELECT nextval('awb_sequence')::text AS nextval`)
  )[0];
  const year = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date())
  );
  const awb = buildAwb(Number(seq!.nextval), year);

  const declaredValueP = input.declaredValue ? poundsToPiastres(input.declaredValue) : 0n;
  const shippingPayer = input.shippingPayer ?? merchant.default_shipping_payer;

  // الشحن على العميل: بيتضاف على المبلغ المحصّل (العميل بيدفع البضاعة + الشحن).
  // كده صافي التاجر = قيمة البضاعة، والشحن بيتحصّل من العميل ويبقى إيراد —
  // بدون أي لمس للدفتر (نفس منطق التسليم بيتكفّل بالباقي).
  const storedCodP =
    shippingPayer === "customer" && codAmountP > 0n ? codAmountP + priced.priceP : codAmountP;

  // ═══ ٦.١) بوابة المحفظة — أوردر من غير تحصيل والشحن على التاجر ═══
  // الشحن هيتخصم من محفظة التاجر، فالشحنة ماتتعملش لو الرصيد مايكفّيش.
  const isWalletOrder = codAmountP === 0n && shippingPayer === "merchant";
  if (isWalletOrder && priced.priceP > 0n) {
    const bal = await walletBalance(ex, merchant.id);
    if (bal.availableP < priced.priceP) {
      throw new HttpError(
        422,
        "INSUFFICIENT_WALLET",
        `رصيد المحفظة مايكفّيش شحن الأوردر ده. المطلوب ${formatEGP(priced.priceP)} · المتاح ${formatEGP(bal.availableP)}. اشحن المحفظة الأول.`
      );
    }
  }

  // ═══ ٧) إدخال الشحنة ═══
  let shipmentId: string;
  try {
    const inserted = rowsOf<{ id: string }>(
      await ex.execute(sql`
        INSERT INTO shipments (
          awb, merchant_id, merchant_reference, recipient_name, recipient_phone, recipient_phone_alt,
          governorate_id, area_id, address_line, landmark, zone_id,
          cod_amount_p, payment_method, shipping_payer, is_wallet_order, declared_value_p,
          pieces_count, allowed_open_pieces, weight_registered_kg,
          is_fragile, fragile_insured, notes_to_courier, service_type, status,
          price_p, price_list_id, tier_snapshot, total_fees_p, merchant_net_p,
          source, created_by_user_id
        ) VALUES (
          ${awb}, ${merchant.id}::uuid, ${input.merchantReference ?? null},
          ${input.recipientName}, ${recipientPhone}, ${input.recipientPhoneAlt ?? null},
          ${gov.id}::uuid, ${input.areaId ?? null}::uuid, ${input.addressLine}, ${input.landmark ?? null},
          ${gov.zone_id}::uuid,
          ${storedCodP.toString()}::bigint, ${paymentMethod}, ${shippingPayer}, ${isWalletOrder}, ${declaredValueP.toString()}::bigint,
          ${input.piecesCount ?? 1}, ${allowedOpenPieces}, ${input.weightKg ?? null},
          ${input.isFragile ?? false}, ${input.fragileInsured ?? false},
          ${input.notesToCourier ?? null}, ${input.serviceType ?? "deliver"}, 'draft',
          ${priced.priceP.toString()}::bigint, ${priced.priceListId ?? null}::uuid, ${tier},
          ${priced.totalFeesP.toString()}::bigint, ${priced.merchantNetP.toString()}::bigint,
          ${actor.role === "merchant" ? "merchant" : "staff"}, ${actor.userId ?? null}::uuid
        )
        RETURNING id
      `)
    );
    shipmentId = inserted[0]!.id;
  } catch (err) {
    throw translateDedup(err);
  }

  // ═══ ٨) بنود الرسوم ═══
  // الشحن بيتخزّن في price_p (مش سطر رسوم) عشان ميتعدّش مرتين.
  // التحصيل تقدير (بيتأكّد وقت التسليم على المحصّل فعلًا).
  // باقي الرسوم الأوتوماتيك ثابتة (is_estimate=false) — بتتحاسب زي ما هي.
  for (const line of priced.feeLines) {
    if (line.code === "SHIPPING") continue;
    const isEstimate = line.code === "COD";
    await ex.execute(sql`
      INSERT INTO shipment_fees
        (shipment_id, fee_code, description_ar, qty, unit_value_p, amount_p, is_estimate, is_auto)
      VALUES (
        ${shipmentId}::uuid, ${line.code}, ${line.descriptionAr}, ${line.qty},
        ${line.unitValueP.toString()}::bigint, ${line.amountP.toString()}::bigint,
        ${isEstimate}, ${line.isAuto}
      )
    `);
  }

  // ═══ ٨.٠) قطع الأوردر (للتسليم الجزئي بالقطعة) ═══
  for (const it of items) {
    await ex.execute(sql`
      INSERT INTO shipment_items (shipment_id, name_ar, sku, qty, unit_price_p)
      VALUES (${shipmentId}::uuid, ${it.nameAr}, ${it.sku ?? null}, ${it.qty ?? 1},
              ${poundsToPiastres(it.price).toString()}::bigint)
    `);
  }

  // ═══ ٨.١) سحب من المخزون (فُلفيلمنت) — نفس الترانزاكشن ═══
  if (input.productId) {
    await pullFromStock(ex, { productId: input.productId, qty: input.productQty ?? 1, shipmentId, actorUserId: actor.userId });
  }

  // ═══ ٩) أول سطر تاريخ (الإنشاء) ═══
  await ex.execute(sql`
    INSERT INTO shipment_status_history
      (shipment_id, from_status, to_status, actor_user_id, actor_role, actor_name, occurred_at, recorded_at, source)
    VALUES (
      ${shipmentId}::uuid, NULL, 'draft',
      ${actor.userId ?? null}::uuid, ${actor.role}, ${actor.name}, now(), now(), 'web'
    )
  `);

  let status = "draft";
  // ═══ ١٠) تأكيد فوري اختياري ═══
  if (input.confirm) {
    const r = await applyTransition(ex, {
      shipmentId,
      to: "awaiting_pickup",
      actor,
      expectedStatus: "draft",
      buildFinancialEntry: (exec) =>
        buildTransitionFinancialEntry(exec, { shipmentId, to: "awaiting_pickup" }),
    });
    status = r.toStatus;
  }

  return {
    id: shipmentId,
    awb,
    status,
    priceP: priced.priceP,
    totalFeesP: priced.totalFeesP,
    merchantNetP: priced.merchantNetP,
    tier,
  };
}

// ---------------------------------------------------------------
// محمّلات بيانات التسعير
// ---------------------------------------------------------------

async function loadPriceList(ex: SqlExecutor): Promise<PriceListEntry[]> {
  const rows = rowsOf<{ price_list_id: string; zone_id: string; tier: string; price_p: string }>(
    await ex.execute(sql`
      SELECT pli.price_list_id, pli.zone_id, pli.tier, pli.price_p::text
      FROM price_list_items pli
      JOIN price_lists pl ON pl.id = pli.price_list_id
      WHERE pl.scope = 'global' AND pl.is_active = true
        AND pl.effective_from <= now()
        AND (pl.effective_to IS NULL OR pl.effective_to > now())
    `)
  );
  return rows.map((r) => ({
    priceListId: r.price_list_id,
    zoneId: r.zone_id,
    tier: r.tier as MerchantTier,
    priceP: BigInt(r.price_p),
  }));
}

async function loadMerchantOverrides(ex: SqlExecutor, merchantId: string): Promise<MerchantPriceOverride[]> {
  const rows = rowsOf<{
    zone_id: string;
    tier: string | null;
    price_p: string;
    effective_from: string;
    effective_to: string | null;
  }>(
    await ex.execute(sql`
      SELECT zone_id, tier, price_p::text, effective_from::text, effective_to::text
      FROM merchant_price_overrides WHERE merchant_id = ${merchantId}::uuid
    `)
  );
  return rows.map((r) => ({
    zoneId: r.zone_id,
    tier: (r.tier as MerchantTier | null) ?? null,
    priceP: BigInt(r.price_p),
    effectiveFrom: new Date(r.effective_from),
    effectiveTo: r.effective_to ? new Date(r.effective_to) : null,
  }));
}

async function loadFeeDefs(ex: SqlExecutor): Promise<FeeDefinition[]> {
  const rows = rowsOf<{
    code: string;
    name_ar: string;
    calc_type: string;
    value_p: string;
    percent_bp: number;
    threshold_p: string;
    basis: string;
    is_auto: boolean;
  }>(
    await ex.execute(sql`
      SELECT code, name_ar, calc_type, value_p::text, percent_bp, threshold_p::text, basis, is_auto
      FROM fee_definitions WHERE is_active = true
    `)
  );
  return rows.map((r) => ({
    code: r.code,
    nameAr: r.name_ar,
    calcType: r.calc_type as FeeDefinition["calcType"],
    valueP: BigInt(r.value_p),
    percentBp: r.percent_bp,
    thresholdP: BigInt(r.threshold_p),
    basis: r.basis as FeeDefinition["basis"],
    isAuto: r.is_auto,
  }));
}

async function loadFeeOverrides(ex: SqlExecutor): Promise<FeeOverride[]> {
  const rows = rowsOf<{
    fee_code: string;
    zone_id: string | null;
    governorate_id: string | null;
    value_p: string;
    percent_bp: number | null;
  }>(
    await ex.execute(sql`
      SELECT fee_code, zone_id, governorate_id, value_p::text, percent_bp
      FROM fee_zone_overrides WHERE is_active = true
    `)
  );
  return rows.map((r) => ({
    feeCode: r.fee_code,
    zoneId: r.zone_id,
    governorateId: r.governorate_id,
    valueP: BigInt(r.value_p),
    percentBp: r.percent_bp,
  }));
}

async function stringSetting(ex: SqlExecutor, key: string, fallback: string): Promise<string> {
  const rows = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`)
  );
  const v = rows[0]?.value;
  return typeof v === "string" && v ? v : fallback;
}

async function numberSetting(ex: SqlExecutor, key: string, fallback: number): Promise<number> {
  const rows = rowsOf<{ value: unknown }>(
    await ex.execute(sql`SELECT value FROM settings WHERE key = ${key} LIMIT 1`)
  );
  const v = rows[0]?.value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** ترجمة تعارض الفهارس الفريدة لرسالة عربية */
function translateDedup(err: unknown): Error {
  const e = err as { code?: string; constraint_name?: string; message?: string };
  if (e?.code === "23505") {
    const c = e.constraint_name ?? e.message ?? "";
    if (c.includes("merchant_ref"))
      return new HttpError(409, "DUPLICATE_REFERENCE", "رقم الأوردر ده متسجّل قبل كده لنفس التاجر");
    if (c.includes("integration_order"))
      return new HttpError(409, "DUPLICATE_ORDER", "الأوردر ده متسجّل قبل كده من المتجر");
    if (c.includes("awb"))
      return new HttpError(409, "DUPLICATE_AWB", "رقم البوليصة اتكرر — حاول تاني");
  }
  return err instanceof Error ? err : new Error(String(err));
}
