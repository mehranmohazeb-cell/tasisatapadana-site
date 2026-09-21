-- ==========================================================================
-- تأسیسات آپادانا — Migration: دفتر تراکنش پرداخت (مدیریت دقیق تومان/ریال)
-- ==========================================================================
-- هر تلاش برای ارسال مبلغ به درگاه پرداخت، دقیقاً یک ردیف در این جدول ثبت
-- می‌کند — با هر دو واحد (تومان و ریال) به‌صورت جداگانه و صریح، تا امکان
-- اشتباه‌شدن واحدها در هیچ مرحله‌ای وجود نداشته باشد و کل مسیر قابل بازرسی
-- (Audit) باشد.
--
-- توجه: در نسخه فعلی پروژه هیچ درگاه پرداخت واقعی متصل نیست (سفارش‌ها با
-- payment_status='unpaid' ثبت می‌شوند و پرداخت/تسویه به‌صورت دستی/حضوری
-- انجام می‌شود). این جدول و توابع مرتبط، زیرساخت آماده برای زمانی است که
-- یک درگاه واقعی (مثل زرین‌پال/پی) متصل شود؛ همان مسیر امن (initiatePaymentRequest
-- / verifyPaymentTransaction در src/index.js) باید استفاده شود.
--
-- اجرا:
--   npx wrangler d1 execute tasisatapadana-db --remote --file=./database/payment-ledger.sql
-- ==========================================================================

CREATE TABLE IF NOT EXISTS payment_transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id),
  amount_toman      INTEGER NOT NULL,
  amount_rial       INTEGER NOT NULL,
  gateway           TEXT,
  gateway_authority TEXT,
  status            TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'paid', 'failed', 'cancelled')),
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(status);
