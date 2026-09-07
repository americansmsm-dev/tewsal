/**
 * ============================================================
 *  توليد مفاتيح الإشعارات (VAPID)
 * ------------------------------------------------------------
 *  الإشعارات على الفون واللاب محتاجة زوج مفاتيح:
 *    · العام  — المتصفح بياخده عشان يعمل الاشتراك (مش سر)
 *    · الخاص  — السيرفر بيوقّع بيه (**سر**)
 *
 *  ⚠️ المفتاح الخاص **مابيتطبعش على الشاشة** بقصد — بيتكتب في
 *     ملف `.env.vapid.local` (متجاهَل في git). تفتح الملف،
 *     تنسخ السطور في Coolify، وتمسح الملف.
 *     كده السر مايعدّيش في شات ولا في سجل الترمينال.
 *
 *    npm run vapid
 *
 *  ⚠️ ولّدهم **مرة واحدة** وسيبهم. لو غيّرتهم بعد ما ناس اشتركت،
 *     كل الاشتراكات القديمة بتبطل ولازم الناس تفعّل الإشعارات تاني.
 * ============================================================
 */
import webpush from "web-push";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), ".env.vapid.local");

if (existsSync(OUT) && !process.argv.includes("--force")) {
  console.log(`
⚠️  الملف موجود أصلًا: ${OUT}
    لو المفاتيح فيه اتحطت في Coolify خلاص، امسح الملف وخلاص.
    لو عايز تولّد **جديد** (وده بيبطّل كل الاشتراكات الحالية):
      npm run vapid -- --force
`);
  process.exit(0);
}

const keys = webpush.generateVAPIDKeys();
const subject = "mailto:support@tewsal.online";

writeFileSync(
  OUT,
  `# مفاتيح إشعارات توصّل — ولّدت ${new Date().toISOString()}\n` +
    `# انسخ السطور التلاتة دي في Coolify → Environment Variables، وبعدين امسح الملف ده.\n` +
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}\n` +
    `VAPID_PRIVATE_KEY=${keys.privateKey}\n` +
    `VAPID_SUBJECT=${subject}\n`,
  { encoding: "utf8", mode: 0o600 }
);

console.log(`
${"═".repeat(64)}
  ✅ اتولّدت مفاتيح الإشعارات
${"═".repeat(64)}

📄 الملف:  ${OUT}

الخطوات:
  ١) افتح الملف ده
  ٢) انسخ السطور التلاتة (بيبدأوا بـ NEXT_PUBLIC_VAPID / VAPID_)
  ٣) حطهم في Coolify ← tewsal-app ← Environment Variables
  ٤) اعمل Redeploy
  ٥) **امسح الملف** بعد ما تخلص

🔒 المفتاح الخاص مااتطبعش هنا بقصد — عشان مايفضلش في سجل الترمينال.
   المفتاح العام مش سر (المتصفح بياخده عادي).
${"═".repeat(64)}
`);
