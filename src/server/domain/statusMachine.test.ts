import { describe, it, expect } from "vitest";
import {
  SHIPMENT_STATUSES,
  STATUS_LABELS_AR,
  PUBLIC_STATUS_LABELS_AR,
  TERMINAL_STATUSES,
  TRANSITIONS,
  isTerminal,
  canTransition,
  allowedTransitions,
  transitionsFrom,
  isFinancialTransition,
  type ShipmentStatus,
} from "./statusMachine";

describe("سلامة التعريف", () => {
  it("كل حالة ليها اسم عربي", () => {
    for (const s of SHIPMENT_STATUSES) {
      expect(STATUS_LABELS_AR[s]).toBeTruthy();
    }
  });

  it("كل حالة ليها مدخل في خريطة التحولات", () => {
    for (const s of SHIPMENT_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined();
    }
  });

  it("كل التحولات بتشاور على حالات موجودة", () => {
    for (const s of SHIPMENT_STATUSES) {
      for (const t of TRANSITIONS[s]) {
        expect(SHIPMENT_STATUSES).toContain(t.to);
      }
    }
  });

  it("الحالات النهائية مالهاش تحولات خارجة", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(TRANSITIONS[s]).toHaveLength(0);
      expect(isTerminal(s)).toBe(true);
    }
  });

  it("مفيش حالة بتنقل لنفسها", () => {
    for (const s of SHIPMENT_STATUSES) {
      for (const t of TRANSITIONS[s]) {
        expect(t.to).not.toBe(s);
      }
    }
  });

  it("كل تحول ليه دور واحد على الأقل ووصف عربي", () => {
    for (const s of SHIPMENT_STATUSES) {
      for (const t of TRANSITIONS[s]) {
        expect(t.roles.length).toBeGreaterThan(0);
        expect(t.label).toBeTruthy();
      }
    }
  });

  it("مفيش تحولات مكررة لنفس الوجهة", () => {
    for (const s of SHIPMENT_STATUSES) {
      const targets = TRANSITIONS[s].map((t) => t.to);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});

describe("المسار الطبيعي — من الإنشاء للتسليم", () => {
  it("التاجر بينشئ الشحنة", () => {
    expect(canTransition("draft", "awaiting_pickup", "merchant").ok).toBe(true);
  });

  it("العمليات بتسند الاستلام (لازم طلب استلام)", () => {
    expect(canTransition("awaiting_pickup", "pickup_assigned", "ops").ok).toBe(false);
    expect(
      canTransition("awaiting_pickup", "pickup_assigned", "ops", ["pickup"]).ok
    ).toBe(true);
  });

  it("المندوب بيستلم من التاجر", () => {
    expect(canTransition("pickup_assigned", "picked_up", "courier").ok).toBe(true);
  });

  it("العمليات بتمسح الوارد", () => {
    expect(canTransition("picked_up", "at_hub", "ops").ok).toBe(true);
  });

  it("الخروج للتسليم محتاج كشف مندوب", () => {
    expect(canTransition("at_hub", "out_for_delivery", "ops").ok).toBe(false);
    expect(
      canTransition("at_hub", "out_for_delivery", "ops", ["run_sheet"]).ok
    ).toBe(true);
  });

  it("التسليم محتاج المبلغ المحصّل", () => {
    const without = canTransition("out_for_delivery", "delivered", "courier");
    expect(without.ok).toBe(false);
    expect(without.error).toContain("المبلغ المحصّل");

    expect(
      canTransition("out_for_delivery", "delivered", "courier", ["cod_amount"]).ok
    ).toBe(true);
  });
});

describe("الصلاحيات — مين يقدر يعمل إيه", () => {
  it("المندوب مش بيقدر يعمل شحنة", () => {
    expect(canTransition("draft", "awaiting_pickup", "courier").ok).toBe(false);
  });

  it("التاجر مش بيقدر يعلن التسليم", () => {
    const r = canTransition("out_for_delivery", "delivered", "merchant", [
      "cod_amount",
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("مش مسموح");
  });

  it("المندوب مش بيقدر يلغي شحنة", () => {
    expect(canTransition("at_hub", "cancelled", "courier", ["note"]).ok).toBe(false);
  });

  it("الفقد والتلف لمدير النظام بس", () => {
    expect(canTransition("at_hub", "lost", "ops", ["note"]).ok).toBe(false);
    expect(canTransition("at_hub", "lost", "branch_manager", ["note"]).ok).toBe(false);
    expect(canTransition("at_hub", "lost", "super_admin", ["note"]).ok).toBe(true);
  });

  it("التسليم الجزئي محتاج موافقة مسبقة", () => {
    const r = canTransition("out_for_delivery", "partially_delivered", "courier", [
      "cod_amount",
      "note",
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("موافقة مسبقة");

    expect(
      canTransition("out_for_delivery", "partially_delivered", "courier", [
        "cod_amount",
        "ops_preauth",
        "note",
      ]).ok
    ).toBe(true);
  });
});

describe("الحالات النهائية مقفولة", () => {
  it.each(TERMINAL_STATUSES)("%s مقفولة تمامًا", (status) => {
    for (const target of SHIPMENT_STATUSES) {
      if (target === status) continue;
      const r = canTransition(status as ShipmentStatus, target, "super_admin", [
        "note",
        "photo",
        "cod_amount",
        "reason_code",
        "run_sheet",
        "pickup",
        "signature",
        "receiver_name",
        "ops_preauth",
      ]);
      expect(r.ok).toBe(false);
    }
  });

  it("رسالة الخطأ بتشرح إن العكس هو الحل", () => {
    const r = canTransition("delivered", "at_hub", "super_admin");
    expect(r.error).toContain("عكس");
  });

  it("مفيش حالة بترجع من نهائية", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(transitionsFrom(s as ShipmentStatus)).toHaveLength(0);
    }
  });
});

describe("المرتجعات", () => {
  it("مسار المرتجع الكامل", () => {
    expect(canTransition("delivery_failed", "at_hub", "ops").ok).toBe(true);
    expect(canTransition("at_hub", "awaiting_return", "ops", ["reason_code"]).ok).toBe(true);
    expect(canTransition("awaiting_return", "out_for_return", "ops").ok).toBe(true);
  });

  it("تسليم المرتجع محتاج اسم المستلم وتوقيع", () => {
    const partial = canTransition("out_for_return", "returned_to_merchant", "courier", [
      "receiver_name",
    ]);
    expect(partial.ok).toBe(false);
    expect(partial.error).toContain("توقيع");

    expect(
      canTransition("out_for_return", "returned_to_merchant", "courier", [
        "receiver_name",
        "signature",
      ]).ok
    ).toBe(true);
  });
});

describe("الإلغاء والفوترة", () => {
  it("الإلغاء قبل الاستلام مش مالي", () => {
    expect(isFinancialTransition("draft", "cancelled")).toBe(false);
    expect(isFinancialTransition("awaiting_pickup", "cancelled")).toBe(false);
    expect(isFinancialTransition("pickup_assigned", "cancelled")).toBe(false);
  });

  it("الإلغاء بعد دخول المخزن مالي (بيتحاسب عليه شحن)", () => {
    expect(isFinancialTransition("picked_up", "cancelled")).toBe(true);
    expect(isFinancialTransition("at_hub", "cancelled")).toBe(true);
  });

  it("التسليم والإرجاع والفقد كلهم ماليين", () => {
    expect(isFinancialTransition("out_for_delivery", "delivered")).toBe(true);
    expect(isFinancialTransition("out_for_delivery", "partially_delivered")).toBe(true);
    expect(isFinancialTransition("out_for_return", "returned_to_merchant")).toBe(true);
    expect(isFinancialTransition("at_hub", "lost")).toBe(true);
    expect(isFinancialTransition("at_hub", "damaged")).toBe(true);
  });

  it("التحولات التشغيلية مش مالية", () => {
    expect(isFinancialTransition("picked_up", "at_hub")).toBe(false);
    expect(isFinancialTransition("at_hub", "out_for_delivery")).toBe(false);
    expect(isFinancialTransition("out_for_delivery", "delivery_failed")).toBe(false);
  });
});

describe("allowedTransitions — لبناء أزرار الواجهة", () => {
  it("المندوب في out_for_delivery شايف ٣ خيارات", () => {
    const opts = allowedTransitions("out_for_delivery", "courier");
    const targets = opts.map((t) => t.to).sort();
    expect(targets).toEqual(["delivered", "delivery_failed", "partially_delivered"]);
  });

  it("التاجر مالوش خيارات على شحنة في المخزن", () => {
    expect(allowedTransitions("at_hub", "merchant")).toHaveLength(0);
  });

  it("مدير النظام شايف الفقد والتلف من أي حالة غير نهائية", () => {
    const opts = allowedTransitions("at_hub", "super_admin").map((t) => t.to);
    expect(opts).toContain("lost");
    expect(opts).toContain("damaged");
  });

  it("مفيش حد شايف خيارات على حالة نهائية", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(allowedTransitions(s as ShipmentStatus, "super_admin")).toHaveLength(0);
    }
  });
});

describe("رسائل العميل النهائي", () => {
  it("الحالات اللي بتظهر للعميل ليها نص بلغته", () => {
    for (const s of ["picked_up", "at_hub", "out_for_delivery", "delivered"] as const) {
      expect(PUBLIC_STATUS_LABELS_AR[s]).toBeTruthy();
    }
  });

  it("الحالات الداخلية مبتظهرش للعميل", () => {
    expect(PUBLIC_STATUS_LABELS_AR.draft).toBeUndefined();
    expect(PUBLIC_STATUS_LABELS_AR.on_hold).toBeUndefined();
    expect(PUBLIC_STATUS_LABELS_AR.lost).toBeUndefined();
    expect(PUBLIC_STATUS_LABELS_AR.damaged).toBeUndefined();
  });
});

describe("الوصولية — كل حالة يمكن الوصول لها", () => {
  it("مفيش حالة معزولة (غير المسودة)", () => {
    const reachable = new Set<string>(["draft"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of SHIPMENT_STATUSES) {
        if (!reachable.has(s)) continue;
        for (const t of transitionsFrom(s)) {
          if (!reachable.has(t.to)) {
            reachable.add(t.to);
            changed = true;
          }
        }
      }
    }
    for (const s of SHIPMENT_STATUSES) {
      expect(reachable.has(s), `الحالة "${s}" مش ممكن الوصول لها`).toBe(true);
    }
  });
});
