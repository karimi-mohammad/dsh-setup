# 🛡️ Reviewer Gate — افزونه ایمنی DSH

یک لایه ایمنی که قبل از اجرای ابزارهای خطرناک (مثل `pwsh`, `edit`, `write`, `bash`) از یک مدل LLM مستقل نظر میخوآد.

---

## 📁 فایل‌های پلاگین

| فایل | توضیح |
|------|-------|
| `reviewer-gate.host.js` | کد اصلی پلاگین |
| `cordis.patch.yml.snippet` | خطوطی که باید به فایل patch profile اضافه بشه |

---

## 🚀 راه‌اندازی (مرحله به مرحله)

### مرحله ۱: پیش‌نیازها

مطمئن شو DSH نصب و پروفایل `web` فعاله:
```bash
dsh --version
```

### مرحله ۲: کپی فایل پلاگین

فایل `reviewer-gate.host.js` رو به پوشه plugins پروفایل web کپی کن:

**ویندوز:**
```
%USERPROFILE%\.dsh\profiles\web\plugins\reviewer-gate.host.js
```

**لینوکس/مک:**
```
~/.dsh/profiles/web/plugins/reviewer-gate.host.js
```

اگه پوشه `plugins` وجود نداره، بسازش:
```bash
mkdir -p ~/.dsh/profiles/web/plugins
```

### مرحله ۳: فعال‌سازی در Cordis

فایل `cordis.patch.yml` پروفایل رو ویرایش کن:

**مسیر فایل:**
```
%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml
```

**محتوای فایل** (اگه خالیه یا محتوای دیگه داره، این خطوط رو اضافه کن):
```yaml
- insert:
    - id: reviewer-gate
      name: './plugins/reviewer-gate.host.js'
```

### مرحله ۴: تنظیم مدل reviewer

داخل `settings.yaml` پروفایل، مدلی که میخوای به عنوان reviewer استفاده بشه رو تنظیم کن:

**مسیر:**
```
%USERPROFILE%\.dsh\settings.yaml
```

**مثال (OpenRouter):**
```yaml
llm-pi-ai:
  providers:
    openrouter:
      baseURL: http://localhost:20128/v1
      models:
        - id: deepseek-v4-flash
        - id: google/gemma-4-26b-a4b-it:free
      apiKeyEnv: OPENROUTER_API_KEY
agent-default-model:
  provider: openrouter
  model: deepseek-v4-flash
```

> ⚠️ **نکته مهم:** مدل reviewer حتماً باید در `settings.yaml` تنظیم شده باشه. مدل‌هایی که پیشوند `provider/` دارن (مثلاً `google/gemma-4...`) ممکنه مشکل routing داشته باشن.

### مرحله ۵: ری‌استارت DSH

```bash
# اگه DSH داره اجراست، اول ببندش
dsh
```

### مرحله ۶: تست کن

داخل DSH این دستور رو بزن:
```
gate_config
```

باید خروجی مشابه این ببینی:
```json
{
  "enabled": true,
  "reviewerOverride": "openrouter/deepseek-v4-flash",
  "onError": "allow",
  "counts": { "allow": 0, "ask": 0, "deny": 0, "error": 0 }
}
```

---

## ⚙️ تنظیمات پیش‌فرض

| تنظیم | مقدار پیش‌فرض | توضیح |
|-------|---------------|-------|
| `provider` | `openrouter` | مسیر provider مدل reviewer |
| `model` | `deepseek-v4-flash` | مدلی که تصمیم ایمنی میگیره |
| `onError` | `allow` | اگه reviewer خطا داد → ابزار اجرا بشه |
| `timeoutMs` | `45000` | مهلت پاسخ reviewer (45 ثانیه) |
| `watching` | `pwsh, bash, edit, write, job_kill, interrupt_agent` | ابزارهایی که بررسی میشن |

---

## 🎛️ دستورات gate_config

```bash
# نمایش وضعیت فعلی
gate_config action=get

# فعال/غیرفعال کردن
gate_config action=enable
gate_config action=disable

# تغییر مدل reviewer
gate_config action=set-reviewer provider=openrouter model=deepseek-v4-flash

# ریست کردن مدل (برگشت به session default)
gate_config action=clear-reviewer

# اضافه/حذف ابزار از لیست بررسی
gate_config action=watch tool=rm
gate_config action=unwatch tool=rm

# تنظیم رفتار خطا
gate_config action=set-on-error value=allow    # اگه خطا داد → اجرا کن
gate_config action=set-on-error value=ask      # اگه خطا داد → از کاربر بپرس

# تنظیم متن ماموریت (به reviewer کمک میکنه تصمیم بگیره)
gate_config action=set-mission mission="در حال ریفکتورینگ پروژه هستم"
gate_config action=clear-mission
```

---

## 🔄 Rollback (بازگشت سریع)

اگه خواستی پلاگین رو غیرفعال کنی:

1. فایل `cordis.patch.yml` رو باز کن
2. خطوط زیر رو کامنت کن:
```yaml
# - insert:
#     - id: reviewer-gate
#       name: './plugins/reviewer-gate.host.js'
```
3. DSH رو ری‌استارت کن

یا فایل `reviewer-gate.host.js` رو از پوشه plugins حذف کن.

---

## 🧠 پشتیبانی از مدل‌های Thinking

این نسخه از پلاگین از مدل‌هایی که "thinking tokens" تولید میکنن (مثل DeepSeek v4) پشتیبانی میکنه:

- `<think>` و `<thinking>` tags رو از پاسخ حذف میکنه
- `thinking-delta` chunks رو جداگانه جمع میکنه
- `text-delta` و `thinking` رو ترکیب میکنه و JSON رو parse میکنه
- `maxTokens: 4000` برای اینکه thinking + JSON جا بشه

---

## 🐛 عیب‌یابی

| مشکل | دلیل | راه‌حل |
|------|------|--------|
| `has no configured model` | مدل در settings.yaml نیست | مدل رو به settings.yaml اضافه کن |
| `reviewer returned an unparsable answer` | maxTokens کمه یا مدل مشکل داره | مدل رو عوض کن یا maxTokens رو زیاد کن |
| `No active credentials for provider: google` | پیشوند مدل با provider تنظیم شده mismatch | از مدلی استفاده کن که پیشوند provider نداشته باشه |
| `reviewer did not answer within 45000ms` | مدل کنده یا load بالا | timeoutMs رو زیاد کن یا مدل عوض کن |
