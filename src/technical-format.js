// =========================================================================
// معماری عمومی «Technical Formatting» — نسخه ۳
// =========================================================================
// این ماژول تنها و کامل منبع فرمت‌دهی نمایشی علائم/واحدهای فنی در کل پروژه
// است. هیچ‌جای دیگری در src/index.js نباید مستقیماً روی متن محصول regex
// فنی بزند — همه از توابع همین فایل استفاده می‌کنند.
//
// اصل طراحی: «قانون بر اساس ساختار notation، نه فهرست موردی». افزودن یک
// notation جدید (واحد جدید، پیشوند subscript/superscript جدید، یا یک
// استثنای صریح) فقط با افزودن یک ردیف در جدول D1 «technical_format_rules»
// انجام می‌شود؛ هرگز نیازی به تغییر این فایل نیست.
// =========================================================================

// -------------------------------------------------------------------------
// نگاشت یونیکد زیرنویس/بالانویس — این فهرست، کل مجموعه نویسه‌هایی است که
// یونیکد برایشان معادل رسمی subscript/superscript دارد (نه یک زیرمجموعه
// دلخواه). هر نویسه دیگری عمداً از این نگاشت خارج است چون معادل رسمی ندارد؛
// در آن حالت convertToScript آن نویسه را دست‌نخورده برمی‌گرداند (هرگز شکل
// جعلی/غیررسمی تولید نمی‌شود).
// -------------------------------------------------------------------------
export const SUBSCRIPT_CHAR_MAP = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
  "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ",
  n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
  "+": "₊", "-": "₋",
};

// بالانویس عمداً فقط ارقام + علامت دارد (پرکاربردترین و بی‌خطرترین حالت
// مهندسی، مثل m² یا m³)؛ حروف بالانویس اضافه نشده چون رندر آن‌ها در
// فونت‌های معمول ناپایدار است — تصمیمی محافظه‌کارانه، نه محدودیت یونیکد.
export const SUPERSCRIPT_CHAR_MAP = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻",
};

export function convertToScript(suffix, scriptType) {
  const map = scriptType === "superscript" ? SUPERSCRIPT_CHAR_MAP : SUBSCRIPT_CHAR_MAP;
  return suffix
    .split("")
    .map((ch) => map[ch] || ch)
    .join("");
}

export function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// -------------------------------------------------------------------------
// حساسیت به بزرگی/کوچکی حروف — به‌صورت پیش‌فرض هر Rule دقیقاً مثل قبل
// case-sensitive است (rule.case_sensitive == null یا 1). فقط وقتی مدیر
// صریحاً case_sensitive=0 را برای همان یک Rule تنظیم کند (مثلاً واحد kW،
// برای پوشش دادن داده‌های واقعی "KW")، تطابق آن Rule به‌تنهایی
// case-insensitive می‌شود؛ این هرگز کل Technical Formatter را global و
// کورکورانه case-insensitive نمی‌کند — هر Rule دیگر (حتی واحدهای تک‌حرفی
// پرریسک مثل C/F) دست‌نخورده و حساس به بزرگی/کوچکی حروف باقی می‌ماند.
// -------------------------------------------------------------------------
export function ruleRegexFlags(rule) {
  const insensitive = rule && (rule.case_sensitive === 0 || rule.case_sensitive === false || rule.case_sensitive === "0");
  return insensitive ? "gi" : "g";
}

// -------------------------------------------------------------------------
// اولویت (Tier) بین rule_typeها برای حل تداخل. هر چه عدد بزرگ‌تر، اولویت
// بالاتر. این عدد تعیین می‌کند وقتی دو Rule روی یک بازه از متن هم‌پوشانی
// دارند (مثال کلاسیک: واحد «Pa» در برابر قانون عمومی subscript پیشوند «P»)
// کدام برنده می‌شود. قانون‌های خاص/دقیق (exception، token، unit) همیشه بر
// قانون عمومی/الگویی (auto_script) اولویت دارند — یعنی دانش دقیقی که مدیر
// وارد کرده، همیشه بر حدس ساختاری غالب است.
// -------------------------------------------------------------------------
const RULE_TIER = {
  exception: 4,
  token: 3,
  unit: 2,
  auto_script: 1,
};

// برای هر rule یک تابع «یابنده Candidateها» — هرکدام مستقل، بدون وابستگی
// به rule_typeهای دیگر. افزودن rule_type جدید فقط یعنی افزودن یک case به
// همین Switch؛ هیچ بخش دیگری از موتور نیاز به تغییر ندارد.
export function findCandidatesForRule(text, rule) {
  const candidates = [];
  if (!rule || !rule.match_value) return candidates;

  const escapedValue = escapeRegexLiteral(rule.match_value);
  const tier = RULE_TIER[rule.rule_type];
  if (tier == null) return candidates; // rule_type ناشناخته → نادیده گرفته می‌شود، هرگز کل متن را خراب نمی‌کند

  const sortOrder = Number(rule.sort_order) || 0;

  try {
    const flags = ruleRegexFlags(rule);

    if (rule.rule_type === "exception") {
      // استثنای صریح: این نویسه دقیقاً همین‌طور که هست باقی می‌ماند و مانع
      // اعمال هر Rule دیگری (با اولویت پایین‌تر) روی همین بازه می‌شود.
      const re = new RegExp("\\b" + escapedValue + "\\b", flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        candidates.push({
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          tier,
          sortOrder,
          ruleId: rule.id,
          replacement: m[0],
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    } else if (rule.rule_type === "token") {
      // جایگزینی دقیق یک نماد مستقل با مرز کلمه (alias/جایگزینی ثابت).
      const re = new RegExp("\\b" + escapedValue + "\\b", flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        candidates.push({
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          tier,
          sortOrder,
          ruleId: rule.id,
          replacement: rule.display_value,
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    } else if (rule.rule_type === "unit") {
      // حالت ۱ — عدد+واحد: وقتی عدد بلافاصله قبل از واحد بیاید، جایگزین
      // نمایشی واقعی اعمال می‌شود («60 C» یا «60C» → «60 °C»).
      const reWithNumber = new RegExp("(\\d+(?:[.,]\\d+)?)\\s?" + escapedValue + "\\b", flags);
      let m;
      while ((m = reWithNumber.exec(text)) !== null) {
        candidates.push({
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          tier,
          sortOrder,
          ruleId: rule.id,
          replacement: `${m[1]} ${rule.display_value}`,
        });
      }

      // حالت ۲ — رزرو عمومی بازه (صرف‌نظر از وجود عدد): این دقیقاً همان
      // اصل معماری است که هر Unit تعریف‌شده در Database را، چه قبلش عدد
      // باشد چه نباشد، از دست هر Rule عمومی با Tier پایین‌تر (auto_script)
      // محافظت می‌کند. جایگزینی این حالت عمداً «بدون تغییر» (match_value
      // خودش) است، نه display_value — چون بدون عدد، معنای واحد فنی
      // (مثلاً °C) اثبات‌شده نیست؛ فقط بازه رزرو می‌شود تا هیچ Rule دیگری
      // آن را حدس نزند. وقتی عدد واقعاً وجود دارد، تطابق حالت ۱ طولانی‌تر
      // است و طبق حل تداخل (طول تطابق بلندتر در Tier مساوی) خودکار برنده
      // می‌شود؛ این حالت فقط برای وقتی عدد نیست وارد عمل می‌شود.
      const reBare = new RegExp("\\b" + escapedValue + "\\b", flags);
      while ((m = reBare.exec(text)) !== null) {
        candidates.push({
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          tier,
          sortOrder,
          ruleId: rule.id,
          replacement: rule.match_value,
        });
        if (m[0].length === 0) reBare.lastIndex++;
      }
    } else if (rule.rule_type === "auto_script") {
      // معماری عمومی زیرنویس/بالانویس: پیشوند (match_value) + یک دنباله
      // کوتاه بعدی (طول و نوع نویسه‌ها از خودِ Rule خوانده می‌شود، نه از
      // کد) → به یونیکد subscript/superscript تبدیل می‌شود.
      // suffix_mode='digits'  → فقط ارقام (برای نمادهایی مثل m², m³ که
      //                          هیچ حرفی نباید بعدشان تبدیل شود).
      // suffix_mode='alnum'   → حرف/رقم (پیش‌فرض؛ برای Qn/Qm/Pmax/...).
      const maxLen = Math.max(1, Math.min(6, Number(rule.max_suffix_len) || 3));
      const suffixClass = rule.suffix_mode === "digits" ? "0-9" : "A-Za-z0-9";
      const re = new RegExp("\\b" + escapedValue + "([" + suffixClass + "]{1," + maxLen + "})\\b", flags);
      let m;
      while ((m = re.exec(text)) !== null) {
        candidates.push({
          start: m.index,
          end: m.index + m[0].length,
          text: m[0],
          tier,
          sortOrder,
          ruleId: rule.id,
          replacement: rule.match_value + convertToScript(m[1], rule.script_type),
        });
      }
    }
  } catch (error) {
    // یک Rule خراب فقط همان Rule را نادیده می‌گیرد، هرگز کل متن/صفحه را خراب نمی‌کند.
    console.error("[technical-format] قانون نادیده گرفته شد:", rule && rule.id, error.message);
  }

  return candidates;
}

// از میان همه Candidateهای هم‌پوشان، طبق اولویت (tier) → طول تطابق (طولانی‌تر
// برنده) → sort_order مدیر → موقعیت در متن، فهرست نهایی و بدون هم‌پوشانی را
// انتخاب می‌کند. این دقیقاً همان مکانیزمی است که تداخل «Pa (واحد) در برابر
// P (پیشوند subscript عمومی)» را بدون نیاز به کد اختصاصی حل می‌کند: کافی
// است یک Rule از نوع unit برای «Pa» تعریف شود؛ موتور خودش تشخیص می‌دهد.
export function resolveOverlaps(candidates) {
  const sorted = [...candidates].sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenB !== lenA) return lenB - lenA;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.start - b.start;
  });

  const accepted = [];
  for (const cand of sorted) {
    const overlaps = accepted.some((acc) => cand.start < acc.end && acc.start < cand.end);
    if (!overlaps) accepted.push(cand);
  }

  accepted.sort((a, b) => a.start - b.start);
  return accepted;
}

// -------------------------------------------------------------------------
// فرمت‌دهی متن ساده (بدون HTML) — برای brand، model، spec.label، spec.value.
// idempotent است: اگر متن قبلاً فرمت‌شده باشد (مثلاً "Qₘ")، نویسه‌های
// یونیکد subscript/superscript در دسته [A-Za-z0-9] نیستند، پس هیچ Ruleای
// دوباره آن‌ها را نمی‌بیند و خروجی دوباره تغییر نمی‌کند.
// -------------------------------------------------------------------------
export function formatTechnicalText(text, rules) {
  if (text == null || typeof text !== "string" || !Array.isArray(rules) || rules.length === 0) {
    return text;
  }

  let candidates = [];
  for (const rule of rules) {
    candidates = candidates.concat(findCandidatesForRule(text, rule));
  }
  if (candidates.length === 0) return text;

  const accepted = resolveOverlaps(candidates);
  if (accepted.length === 0) return text;

  let output = "";
  let cursor = 0;
  for (const match of accepted) {
    output += text.slice(cursor, match.start);
    output += match.replacement;
    cursor = match.end;
  }
  output += text.slice(cursor);
  return output;
}

// -------------------------------------------------------------------------
// HTML Safety — تقسیم HTML به «بخش‌های tag» و «بخش‌های text» با یک
// tokenizer سبک، quote-aware (نقل‌قول‌های attribute را می‌شناسد تا با یک
// «>» داخل href اشتباه گرفته نشود). فقط بخش‌های text فرمت می‌شوند؛ tag،
// attribute، href، src هرگز لمس نمی‌شوند.
//
// چرا tokenizer دستی به‌جای HTMLRewriter (API بومی Cloudflare Workers):
// HTMLRewriter فقط در Runtime واقعی Workers قابل اجراست و در این Sandbox
// قابل تست واقعی نیست (نیاز به streaming/buffering بین چند text chunk هم
// دارد که بدون اجرای واقعی قابل تأیید نیست). این tokenizer با Node.js همین
// امروز با تست واقعی قابل تأیید است و به همان اصل «فقط text node فرمت شود»
// می‌رسد. اگر در آینده تصمیم به استفاده از HTMLRewriter گرفته شد، این
// تابع بدون تغییر در فراخوانی‌کننده‌ها قابل جایگزینی است (امضای ورودی/خروجی یکسان).
// -------------------------------------------------------------------------
export function splitHtmlIntoSegments(html) {
  const segments = [];
  let i = 0;
  const len = html.length;

  while (i < len) {
    if (html[i] === "<") {
      // کامنت HTML: <!-- ... --> به‌صورت جداگانه (تا «>» داخلش گمراه‌کننده نباشد)
      if (html.startsWith("<!--", i)) {
        let j = html.indexOf("-->", i + 4);
        j = j === -1 ? len : j + 3;
        segments.push({ type: "tag", text: html.slice(i, j) });
        i = j;
        continue;
      }

      let j = i + 1;
      let inQuote = null;
      while (j < len) {
        const c = html[j];
        if (inQuote) {
          if (c === inQuote) inQuote = null;
        } else if (c === '"' || c === "'") {
          inQuote = c;
        } else if (c === ">") {
          break;
        }
        j++;
      }
      const tagEnd = Math.min(j + 1, len);
      segments.push({ type: "tag", text: html.slice(i, tagEnd) });
      i = tagEnd;
    } else {
      let j = html.indexOf("<", i);
      if (j === -1) j = len;
      segments.push({ type: "text", text: html.slice(i, j) });
      i = j;
    }
  }

  return segments;
}

export function formatTechnicalHtml(html, rules) {
  if (html == null || typeof html !== "string") return html;
  if (!Array.isArray(rules) || rules.length === 0) return html;

  const segments = splitHtmlIntoSegments(html);
  let changed = false;
  const output = segments.map((seg) => {
    if (seg.type !== "text" || !seg.text) return seg.text;
    const formatted = formatTechnicalText(seg.text, rules);
    if (formatted !== seg.text) changed = true;
    return formatted;
  });

  return changed ? output.join("") : html;
}

// یک محصول (و مشخصات فنی آن) را طبق قوانین فعلی فرمت می‌کند. description
// به‌صورت HTML-safe (فقط text node) و brand/model/specs به‌صورت متن ساده
// فرمت می‌شوند. ایمن است حتی اگر specs وجود نداشته باشد یا rules خالی باشد.
export function applyTechnicalFormattingToProduct(product, rules) {
  if (!product || !Array.isArray(rules) || rules.length === 0) return product;

  if (product.description != null) product.description = formatTechnicalHtml(product.description, rules);
  if (product.brand != null) product.brand = formatTechnicalText(product.brand, rules);
  if (product.model != null) product.model = formatTechnicalText(product.model, rules);

  if (Array.isArray(product.specs)) {
    product.specs = product.specs.map((spec) => ({
      ...spec,
      label: formatTechnicalText(spec.label, rules),
      value: formatTechnicalText(spec.value, rules),
    }));
  }

  return product;
}


