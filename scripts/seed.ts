/**
 * ============================================================
 *  بذور قاعدة البيانات — Seed
 * ------------------------------------------------------------
 *  بيحط القيم الابتدائية: المناطق، المحافظات، الأسعار،
 *  الرسوم، دليل الحسابات، الإعدادات، وحساب المدير الأول.
 *
 *  ⚠️ آمن للتكرار (idempotent) — تقدر تشغّله أكتر من مرة
 *     من غير ما يكرّر أو يمسح حاجة. أي قيمة عدّلتها من
 *     الشاشة **مش هتترجّع** إلا لو استخدمت --force-values.
 *
 *  الاستخدام:
 *     npm run db:seed
 *     npm run db:seed -- --force-values     (يرجّع الأسعار والرسوم للأصل)
 *     npm run db:seed -- --admin-password="..."
 * ============================================================
 */
import postgres from "postgres";
import { hash } from "@node-rs/argon2";
import {
  SEED_ZONES,
  SEED_GOVERNORATES,
  SEED_PRICES,
  SEED_FEES,
  SEED_FEE_ZONE_OVERRIDES,
  SEED_FEE_GOV_OVERRIDES,
  SEED_COMMISSION_RULES,
  SEED_SETTINGS,
  SEED_REASON_CODES,
  SEED_ACCOUNTS,
  SEED_WORKING_HOURS,
  SEED_RETURN_SHELVES,
} from "../src/server/db/seed-data";

// ---------------------------------------------------------------
// إعدادات التشغيل
// ---------------------------------------------------------------

const args = process.argv.slice(2);
const FORCE_VALUES = args.includes("--force-values");
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME ?? "admin";
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? "01040039800";
const ADMIN_PASSWORD =
  args.find((a) => a.startsWith("--admin-password="))?.split("=")[1] ??
  process.env.SEED_ADMIN_PASSWORD ??
  null;

/** تاريخ سريان قائمة الأسعار الأولى */
const PRICE_LIST_NAME = "قائمة الأسعار الأساسية";

let inserted = 0;
let skipped = 0;
const log = (icon: string, msg: string) => console.log(`${icon} ${msg}`);

// ---------------------------------------------------------------

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL مش متعرّف");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    // الجداول لازم تكون موجودة — يعني الـ migrations اتطبقت
    const [tablesCheck] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'zones'
      ) AS exists
    `;
    if (!tablesCheck?.exists) {
      console.error("❌ الجداول مش موجودة — شغّل `npm run db:migrate` الأول");
      process.exit(1);
    }

    await sql.begin(async (tx) => {
      // ---------------------------------------------------------
      // ١) مناطق التسعير
      // ---------------------------------------------------------
      const zoneIds = new Map<string, string>();
      for (const z of SEED_ZONES) {
        const [row] = await tx<{ id: string; is_new: boolean }[]>`
          INSERT INTO zones (code, name_ar, sla_working_hours, sla_working_days_min, sla_working_days_max, sort_order)
          VALUES (${z.code}, ${z.nameAr}, ${z.slaWorkingHours}, ${z.slaWorkingDaysMin}, ${z.slaWorkingDaysMax}, ${z.sortOrder})
          ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
          RETURNING id, (xmax = 0) AS is_new
        `;
        zoneIds.set(z.code, row!.id);
        row!.is_new ? inserted++ : skipped++;
      }
      log("🗺️ ", `مناطق التسعير: ${SEED_ZONES.length}`);

      // ---------------------------------------------------------
      // ٢) المحافظات الـ ٢٧
      // ---------------------------------------------------------
      const govIds = new Map<string, string>();
      for (const [i, g] of SEED_GOVERNORATES.entries()) {
        const zoneId = zoneIds.get(g.zone);
        if (!zoneId) throw new Error(`منطقة غير معروفة للمحافظة ${g.code}: ${g.zone}`);
        const slaOverride = "slaOverrideHours" in g ? g.slaOverrideHours : null;
        const [row] = await tx<{ id: string; is_new: boolean }[]>`
          INSERT INTO governorates (code, name_ar, name_en, zone_id, cod_enabled, sla_override_hours, sort_order)
          VALUES (${g.code}, ${g.nameAr}, ${g.nameEn}, ${zoneId}, ${g.codEnabled}, ${slaOverride ?? null}, ${i + 1})
          ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
          RETURNING id, (xmax = 0) AS is_new
        `;
        govIds.set(g.code, row!.id);
        row!.is_new ? inserted++ : skipped++;
      }
      log("📍", `المحافظات: ${SEED_GOVERNORATES.length}`);

      // المحافظات النائية → منطقة فرعية افتراضية معلّمة نائية
      // (الرسم بصفر — تحدده من الشاشة لما تقرّر تخدمها)
      let remoteAreas = 0;
      for (const g of SEED_GOVERNORATES) {
        if (!("isRemote" in g) || !g.isRemote) continue;
        const res = await tx`
          INSERT INTO areas (governorate_id, name_ar, is_remote, is_served, remote_surcharge_p)
          VALUES (${govIds.get(g.code)!}, ${`${g.nameAr} — عام`}, true, false, 0)
          ON CONFLICT (governorate_id, name_ar) DO NOTHING
        `;
        if (res.count > 0) remoteAreas++;
      }
      if (remoteAreas) log("🏜️ ", `مناطق نائية: ${remoteAreas}`);

      // ---------------------------------------------------------
      // ٣) ساعات العمل — الجمعة إجازة
      // ---------------------------------------------------------
      for (const w of SEED_WORKING_HOURS) {
        await tx`
          INSERT INTO working_hours (day_of_week, open_time, close_time, is_working_day)
          VALUES (${w.dayOfWeek}, ${w.openTime}, ${w.closeTime}, ${w.isWorkingDay})
          ON CONFLICT (day_of_week) DO NOTHING
        `;
      }
      log("🕒", "ساعات العمل: ٦ أيام + الجمعة إجازة");

      // ---------------------------------------------------------
      // ٤) قائمة الأسعار — بإصدار وتاريخ سريان
      // ---------------------------------------------------------
      let [priceList] = await tx<{ id: string }[]>`
        SELECT id FROM price_lists
        WHERE scope = 'global' AND name = ${PRICE_LIST_NAME}
        LIMIT 1
      `;
      if (!priceList) {
        [priceList] = await tx<{ id: string }[]>`
          INSERT INTO price_lists (name, scope, effective_from, is_active, notes)
          VALUES (${PRICE_LIST_NAME}, 'global', now(), true,
                  'الأسعار المنشورة على الموقع — أي تغيير بيبقى قائمة جديدة مش تعديل')
          RETURNING id
        `;
        log("💵", "اتعملت قائمة أسعار جديدة");
      }

      for (const p of SEED_PRICES) {
        await tx`
          INSERT INTO price_list_items (price_list_id, zone_id, tier, price_p)
          VALUES (${priceList!.id}, ${zoneIds.get(p.zone)!}, ${p.tier}, ${p.priceP.toString()})
          ON CONFLICT (price_list_id, zone_id, tier) DO ${
            FORCE_VALUES ? tx`UPDATE SET price_p = EXCLUDED.price_p` : tx`NOTHING`
          }
        `;
      }
      log("💵", `بنود الأسعار: ${SEED_PRICES.length} (٣ مناطق × ٣ شرائح)`);

      // ---------------------------------------------------------
      // ٥) تعريفات الرسوم
      // ---------------------------------------------------------
      for (const f of SEED_FEES) {
        const percentBp = "percentBp" in f ? f.percentBp : 0;
        const thresholdP = "thresholdP" in f ? f.thresholdP : 0n;
        const basis = "basis" in f ? f.basis : "full_amount";
        const notes = "notes" in f ? f.notes : null;
        await tx`
          INSERT INTO fee_definitions
            (code, name_ar, calc_type, value_p, percent_bp, threshold_p, basis, applies_to, is_auto, notes)
          VALUES
            (${f.code}, ${f.nameAr}, ${f.calcType}, ${f.valueP.toString()}, ${percentBp},
             ${thresholdP.toString()}, ${basis}, ${f.appliesTo}, ${f.isAuto}, ${notes ?? null})
          ON CONFLICT (code) DO ${
            FORCE_VALUES
              ? tx`UPDATE SET
                    name_ar = EXCLUDED.name_ar,
                    calc_type = EXCLUDED.calc_type,
                    value_p = EXCLUDED.value_p,
                    percent_bp = EXCLUDED.percent_bp,
                    threshold_p = EXCLUDED.threshold_p,
                    basis = EXCLUDED.basis,
                    updated_at = now()`
              : tx`NOTHING`
          }
        `;
      }
      log("🧾", `تعريفات الرسوم: ${SEED_FEES.length}`);

      // تجاوزات الرسوم — المرتجع ٦٥ ج برّه التغطية، والإسكندرية ١٠٠ ج
      for (const o of SEED_FEE_ZONE_OVERRIDES) {
        const zoneId = zoneIds.get(o.zone)!;
        const [existing] = await tx<{ id: string }[]>`
          SELECT id FROM fee_zone_overrides
          WHERE fee_code = ${o.feeCode} AND zone_id = ${zoneId} AND governorate_id IS NULL
          LIMIT 1
        `;
        if (existing && !FORCE_VALUES) continue;
        if (existing) {
          await tx`UPDATE fee_zone_overrides SET value_p = ${o.valueP.toString()}, updated_at = now() WHERE id = ${existing.id}`;
        } else {
          await tx`
            INSERT INTO fee_zone_overrides (fee_code, zone_id, value_p, notes)
            VALUES (${o.feeCode}, ${zoneId}, ${o.valueP.toString()}, ${o.notes})
          `;
        }
      }
      for (const o of SEED_FEE_GOV_OVERRIDES) {
        const govId = govIds.get(o.governorate)!;
        const [existing] = await tx<{ id: string }[]>`
          SELECT id FROM fee_zone_overrides
          WHERE fee_code = ${o.feeCode} AND governorate_id = ${govId}
          LIMIT 1
        `;
        if (existing && !FORCE_VALUES) continue;
        if (existing) {
          await tx`UPDATE fee_zone_overrides SET value_p = ${o.valueP.toString()}, updated_at = now() WHERE id = ${existing.id}`;
        } else {
          await tx`
            INSERT INTO fee_zone_overrides (fee_code, governorate_id, value_p, notes)
            VALUES (${o.feeCode}, ${govId}, ${o.valueP.toString()}, ${o.notes})
          `;
        }
      }
      log(
        "🧾",
        `تجاوزات الرسوم: ${SEED_FEE_ZONE_OVERRIDES.length} منطقة + ${SEED_FEE_GOV_OVERRIDES.length} محافظة`
      );

      // ---------------------------------------------------------
      // ٦) قواعد العمولة — ٥٠ ج لكل شحنة (قرار ٩)
      // ---------------------------------------------------------
      for (const c of SEED_COMMISSION_RULES) {
        const [existing] = await tx<{ id: string }[]>`
          SELECT id FROM courier_commission_rules
          WHERE courier_id IS NULL AND zone_id IS NULL AND governorate_id IS NULL
            AND basis = ${c.basis} AND is_active = true
          LIMIT 1
        `;
        if (existing) continue;
        await tx`
          INSERT INTO courier_commission_rules (basis, amount_p, priority)
          VALUES (${c.basis}, ${c.amountP.toString()}, ${c.priority})
        `;
      }
      log("🛵", "قاعدة العمولة الافتراضية: ٥٠ ج لكل شحنة مُسلَّمة");

      // ---------------------------------------------------------
      // ٧) الإعدادات — كل قاعدة عمل قابلة للتعديل من الشاشة
      // ---------------------------------------------------------
      for (const s of SEED_SETTINGS) {
        const description = "description" in s ? s.description : null;
        await tx`
          INSERT INTO settings (key, value, name_ar, description, category, value_type)
          VALUES (${s.key}, ${sql.json(s.value)}, ${s.nameAr},
                  ${description ?? null}, ${s.category}, ${s.valueType})
          ON CONFLICT (key) DO ${
            FORCE_VALUES
              ? tx`UPDATE SET value = EXCLUDED.value, name_ar = EXCLUDED.name_ar, updated_at = now()`
              : tx`NOTHING`
          }
        `;
      }
      log("⚙️ ", `الإعدادات: ${SEED_SETTINGS.length}`);

      // ---------------------------------------------------------
      // ٨) أسباب التعذّر
      // ---------------------------------------------------------
      for (const [i, r] of SEED_REASON_CODES.entries()) {
        await tx`
          INSERT INTO shipment_reason_codes
            (code, name_ar, requires_note, requires_photo, counts_as_attempt, is_customer_fault, sort_order)
          VALUES (${r.code}, ${r.nameAr}, ${r.requiresNote}, ${r.requiresPhoto},
                  ${r.countsAsAttempt}, ${r.isCustomerFault}, ${i + 1})
          ON CONFLICT (code) DO NOTHING
        `;
      }
      log("📋", `أسباب التعذّر: ${SEED_REASON_CODES.length}`);

      // ---------------------------------------------------------
      // ٩) دليل الحسابات
      // ---------------------------------------------------------
      // ⚠️ حسابات الشركة بس هي اللي بتتعمل هنا. حسابات المندوب
      //    والتاجر بتتعمل لحظة إنشاء المندوب/التاجر من القالب.
      for (const a of SEED_ACCOUNTS) {
        const isTemplate = "isTemplate" in a ? a.isTemplate : false;
        await tx`
          INSERT INTO accounts (code, name_ar, type, owner_type, owner_id, is_template)
          VALUES (${a.code}, ${a.nameAr}, ${a.type}, ${a.ownerType}, NULL, ${isTemplate})
          ON CONFLICT (code) WHERE owner_id IS NULL DO NOTHING
        `;
      }
      log("📒", `دليل الحسابات: ${SEED_ACCOUNTS.length}`);

      // ---------------------------------------------------------
      // ١٠) الفرع الرئيسي
      // ---------------------------------------------------------
      const [branch] = await tx<{ id: string }[]>`
        INSERT INTO branches (code, name_ar, governorate_id, phone)
        VALUES ('MAIN', 'الفرع الرئيسي', ${govIds.get("CAI")!}, ${ADMIN_PHONE})
        ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
        RETURNING id
      `;
      // خزنة الفرع — حساب مستقل لكل فرع
      await tx`
        INSERT INTO accounts (code, name_ar, type, owner_type, owner_id, is_template)
        VALUES ('BRANCH_CASH', ${"خزنة الفرع الرئيسي"}, 'asset', 'branch', ${branch!.id}, false)
        ON CONFLICT (code, owner_id) DO NOTHING
      `;
      // الحساب البنكي الرئيسي — ownerId = 'main' في الكود بيقابل صف الشركة
      log("🏢", "الفرع الرئيسي + خزنته");

      // ---------------------------------------------------------
      // ١٠.١) رفوف المرتجعات الافتراضية
      // ---------------------------------------------------------
      for (const sh of SEED_RETURN_SHELVES) {
        await tx`
          INSERT INTO return_shelves (code, name_ar, branch_id, capacity)
          VALUES (${sh.code}, ${sh.nameAr}, ${branch!.id}, ${sh.capacity})
          ON CONFLICT (code) DO NOTHING
        `;
      }
      log("📦", `رفوف المرتجعات: ${SEED_RETURN_SHELVES.length}`);

      // ---------------------------------------------------------
      // ١١) حساب المدير الأول
      // ---------------------------------------------------------
      const [existingAdmin] = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE username = ${ADMIN_USERNAME} LIMIT 1
      `;
      if (existingAdmin) {
        log("👤", `المدير "${ADMIN_USERNAME}" موجود — متغيّرش`);
      } else {
        const password = ADMIN_PASSWORD ?? generatePassword();
        const passwordHash = await hash(password, {
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        });
        await tx`
          INSERT INTO users (full_name, username, phone, password_hash, role, branch_id, must_change_password)
          VALUES ('مدير النظام', ${ADMIN_USERNAME}, ${ADMIN_PHONE}, ${passwordHash},
                  'super_admin', ${branch!.id}, true)
        `;
        console.log("");
        console.log("┌─────────────────────────────────────────────┐");
        console.log("│  👤 حساب المدير الأول                        │");
        console.log("├─────────────────────────────────────────────┤");
        console.log(`│  المستخدم:  ${ADMIN_USERNAME.padEnd(30)}│`);
        console.log(`│  الباسورد:  ${password.padEnd(30)}│`);
        console.log("├─────────────────────────────────────────────┤");
        console.log("│  ⚠️  غيّره من أول تسجيل دخول                  │");
        console.log("└─────────────────────────────────────────────┘");
        console.log("");
      }
    });

    // -----------------------------------------------------------
    // تحقق نهائي
    // -----------------------------------------------------------
    const [counts] = await sql<
      { zones: number; govs: number; prices: number; fees: number; accts: number; setts: number }[]
    >`
      SELECT
        (SELECT count(*) FROM zones)::int              AS zones,
        (SELECT count(*) FROM governorates)::int       AS govs,
        (SELECT count(*) FROM price_list_items)::int   AS prices,
        (SELECT count(*) FROM fee_definitions)::int    AS fees,
        (SELECT count(*) FROM accounts)::int           AS accts,
        (SELECT count(*) FROM settings)::int           AS setts
    `;

    console.log("─".repeat(46));
    console.log(`  المناطق ${counts!.zones} · المحافظات ${counts!.govs} · الأسعار ${counts!.prices}`);
    console.log(`  الرسوم ${counts!.fees} · الحسابات ${counts!.accts} · الإعدادات ${counts!.setts}`);
    console.log("─".repeat(46));
    console.log(`\n✅ البذور تمام — ${inserted} جديد · ${skipped} موجود قبل كده`);
    if (!FORCE_VALUES) {
      console.log("   (أي قيمة عدّلتها من الشاشة زي ما هي — استخدم --force-values لو عايز ترجّعها)");
    }
  } catch (err) {
    console.error("\n❌ فشلت البذور — مفيش أي حاجة اتكتبت (الترانزاكشن اترجعت):");
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

/** باسورد عشوائي قوي للمدير الأول */
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

main();
