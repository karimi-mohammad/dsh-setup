# 🧩 dpPlug — مجموعه پلاگین‌ها و پریست‌های DeepSeek Harness

مجموعه‌ای کامل از ابزارها، پلاگین‌ها و پریست‌های سفارشی برای **DeepSeek Harness** که تجربه کدنویسی و ایمنی رو ارتقا میده.

---

## 📦 چه چیزی داخل این پوشه هست؟

| پوشه / فایل | چیه؟ | وضعیت |
|---|---|---|
| `claude-preset/` | پریست «Claude Mode» — رفتار دقیق مثل Claude Code روی DSH | ✅ آماده نصب |
| `gate-safety/` | پلاگین ایمنی Reviewer Gate — بررسی خودکار ابزارهای خطرناک | ✅ آماده نصب |
| `install.ps1` | اسکریپت نصب خودکار همه‌چیز | ✅ آماده اجرا |

---

## 🚀 روش ۱: نصب کامل خودکار (توصیه‌شده)

فقط کافیه اسکریپت نصب رو اجرا کنی — همه‌چیز خودکار ستاپ میشه:

```powershell
# در PowerShell (Admin لازم نیست)
cd "مسیر این پوشه"
.\install.ps1
```

اسکریپت به صورت خودکار:
- ✅ پریست Claude Mode رو به `~/.dsh/.agent-presets/claude/` کپی میکنه
- ✅ حافظه سراسری Claude (`~/.dsh/AGENTS.md`) رو وصل میکنه

> 💡 برای نصب پلاگین Gate Safety، باید جداگانه مراحل زیر رو دنبال کنی (مرحله ۲).

---

## 🛠️ روش ۲: نصب دستی / نصب تکی هر بخش

اگه فقط یکی از بخش‌ها رو میخوای، از مراحل زیر استفاده کن:

---

### بخش A: نصب پریست Claude Mode

پریست Claude Mode باعث میشه DSH دقیقاً مثل Claude Code رفتار کنه:

#### ویژگی‌ها
| ویژگی | توضیح |
|---|---|
| **CLAUDE.md خودکار** | فایل‌های `CLAUDE.md` و `AGENTS.md` هر پروژه + `~/.dsh/AGENTS.md` سراسری خودکار تزریق میشن |
| **Skills پروژه** | فایل‌های `.claude/skills/<name>/SKILL.md` هر پروژه + `~/.claude/skills` سراسری اسکن میشن |
| **Custom Commands** | فایل‌های `.claude/commands/*.md` هر پروژه به‌عنوان اسلش‌کامند بومی |
| **ابزارهای کامل** | shell, filesystem, jobs, goals, plan mode, subagents, compaction |
| **بدون وابستگی اضافه** | فقط DSH نصب باشه؛ نیازی به نصب پکیج جدید نیست |

#### پیش‌نیازها
1. **DeepSeek Harness** نصب و فعال باشه (v0.1.1-rc.2 یا جدیدتر)
2. یک **پروفایل** با پکیج‌های استاندارد (shell, fs, skill و...)
3. **نود.js** v18+ روی سیستم

#### نصب
```powershell
# کپی دستی به مسیر پریست‌ها
mkdir "$env:USERPROFILE\.dsh\.agent-presets\claude" -Force
Copy-Item ".\claude-preset\*" "$env:USERPROFILE\.dsh\.agent-presets\claude\" -Recurse -Force
```

#### استفاده
1. DeepSeek Harness رو باز کن
2. یه جلسه جدید بساز
3. توی انتخابگر پریست، **«Claude Mode»** رو انتخاب کن
4. پروژه‌تون رو باز کن — CLAUDE.md و Skills خودکار لود میشن!

#### ساختار فایل‌ها
```
~/.dsh/.agent-presets/claude/
├── agent.cordis.yml              ← کامپوزیشن اصلی پریست
├── package.json                  ← پیکربندی Node
├── preset.yml                    ← نام و توضیحات نمایشی
└── plugins/
    ├── claude-skill-provider.mjs  ← اسکنر .claude/skills
    └── claude-commands.mjs        ← ثبت .claude/commands
```

---

### بخش B: نصب پلاگین ایمنی Gate Safety

لایه ایمنی که قبل از اجرای ابزارهای خطرناک (مثل `pwsh`, `bash`, `edit`, `write`) از یک مدل LLM مستقل نظر میخواد.

#### ویژگی‌ها
| ویژگی | توضیح |
|---|---|
| **بررسی خودکار** | قبل از هر ابزار خطرناک، یک مدل مستقل بررسی میکنه |
| **سه تصمیم** | `allow` (اجرا بده), `ask` (از کاربر بپرس), `deny` (مسدود کن) |
| **پشتیبانی مدل‌های Thinking** | تگ‌های `<think>` و `<thinking>` رو خودکار حذف میکنه |
| **تنظیم‌پذیر** | ابزارهای تحت نظر، مدل reviewer، و رفتار خطا قابل تنظیمه |
| **گزارش‌دهی** | تاریخچه تصمیمات و آمار در دسترسه |

#### نصب گام‌به‌گام

##### مرحله ۱: کپی فایل پلاگین

فایل `gate-safety/reviewer-gate.host.js` رو به پوشه plugins پروفایل web کپی کن:

**ویندوز:**
```
%USERPROFILE%\.dsh\profiles\web\plugins\reviewer-gate.host.js
```

**لینوکس/مک:**
```
~/.dsh/profiles/web/plugins/reviewer-gate.host.js
```

اگه پوشه `plugins` وجود نداره، بسازش:
```powershell
# ویندوز
mkdir "$env:USERPROFILE\.dsh\profiles\web\plugins" -Force

# لینوکس/مک
mkdir -p ~/.dsh/profiles/web/plugins
```

##### مرحله ۲: فعال‌سازی در Cordis

فایل `cordis.patch.yml` پروفایل web رو ویرایش کن:

**مسیر فایل:**
```
%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml
```

**محتوای اضافه‌شده:**
```yaml
- insert:
    - id: reviewer-gate
      name: './plugins/reviewer-gate.host.js'
```

> اگه فایل خالیه، کل محتوا رو کپی کن. اگه محتوای دیگه داره، فقط بخش insert رو اضافه کن.

##### مرحله ۳: تنظیم مدل reviewer

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

> ⚠️ مدل reviewer حتماً باید در `settings.yaml` تنظیم شده باشه.

##### مرحله ۴: ری‌استارت DSH

```bash
# اگه DSH داره اجراست، اول ببندش و دوباره اجرا کن
dsh
```

##### مرحله ۵: تست کن

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

#### تنظیمات پیش‌فرض

| تنظیم | مقدار پیش‌فرض | توضیح |
|-------|---------------|-------|
| `provider` | `openrouter` | مسیر provider مدل reviewer |
| `model` | `deepseek-v4-flash` | مدلی که تصمیم ایمنی میگیره |
| `onError` | `allow` | اگه reviewer خطا داد → ابزار اجرا بشه |
| `timeoutMs` | `45000` | مهلت پاسخ reviewer (45 ثانیه) |
| `watching` | `pwsh, bash, edit, write, job_kill, interrupt_agent` | ابزارهایی که بررسی میشن |

#### دستورات gate_config

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

## 🎯 روش ۳: نصب از طریق DeepSeek Harness (هوشمند)

اگه میخوای خود هارنس همه‌چیز رو برات نصب کنه، کافیه این پوشه رو بهش بدی و بگی:

### مثال ۱: نصب همه‌چیز
> «این پوشه رو نگاه کن: `C:\Users\Mohammad\Desktop\TEMP\dpPlug`
> - پریست Claude Mode رو نصب کن
> - پلاگین Gate Safety رو هم نصب کن
> - همه‌چیز رو آماده کن»

### مثال ۲: فقط نصب پریست
> «فقط پریست Claude Mode رو از این پوشه نصب کن: `dpPlug\claude-preset`»

### مثال ۳: فقط نصب پلاگین ایمنی
> «فقط پلاگین Gate Safety رو از `dpPlug\gate-safety` نصب کن — فایل js رو کپی کن و cordis.patch.yml رو آپدیت کن»

> 💡 هارنس میتونه فایل‌ها رو بخونه و خودش مراحل نصب رو انجام بده.

---

## 🔄 بروزرسانی

### بروزرسانی پریست Claude Mode
فایل‌های جدید رو روی فایل‌های قبلی کپی کن:
```powershell
Copy-Item ".\claude-preset\*" "$env:USERPROFILE\.dsh\.agent-presets\claude\" -Recurse -Force
```
جلسه‌های جدید خودکار نسخه تازه رو میبینن.

### بروزرسانی پلاگین Gate Safety
فایل `reviewer-gate.host.js` جدید رو جایگزین فایل قبلی کن و DSH رو ری‌استارت کن.

---

## ⚠️ محدودیت‌ها و نکات

### Claude Mode
- اسکن فایل‌ها فقط **یک سطح عمقه** (مثل خود Claude)
- نام فایل‌ها باید kebab-case یا lowercase باشن
- سینتکس‌های پیشرفته مثل `` !`command` `` و `@file` تفسیر نمیشن
- اگه دو پروژه همزمان کامند مشترک داشته باشن، اولویت با پروژه فعال ایجنت هست

### Gate Safety
- مدل reviewer حتماً باید در `settings.yaml` تنظیم شده باشه
- مدل‌هایی با پیشوند `provider/` (مثلاً `google/gemma-4...`) ممکنه مشکل routing داشته باشن
- اگه reviewer در 45 ثانیه پاسخ نده، رفتار `onError` اجرا میشه

---

## 🐛 عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| پریست در لیست نیست | مطمئن شو `~/.dsh/.agent-presets/claude/` وجود داره و `preset.yml` معتبره |
| Skills نمیاد | چک کن فایل‌ها `.md` پسوند دارن و frontmatter معتبرن |
| Commands کار نمیکنه | مطمئن شو فایل در `.claude/commands/` (نه `.claude/` مستقیم) هست |
| Gate Safety فعال نیست | `cordis.patch.yml` رو چک کن و DSH رو ری‌استارت کن |
| `has no configured model` | مدل در `settings.yaml` نیست |
| `reviewer returned an unparsable answer` | maxTokens کمه یا مدل مشکل داره |
| `No active credentials for provider` | پیشوند مدل با provider تنظیم شده mismatch هست |
| خطا در اجرا | لاگ DSH رو چک کن: `~/.dsh/sessions/` |

---

## 🔄 Rollback (بازگشت سریع)

### حذف پریست Claude Mode
```powershell
Remove-Item -Path "$env:USERPROFILE\.dsh\.agent-presets\claude" -Recurse -Force
```

### غیرفعال کردن Gate Safety
فایل `cordis.patch.yml` رو باز کن و خطوط زیر رو کامنت کن:
```yaml
# - insert:
#     - id: reviewer-gate
#       name: './plugins/reviewer-gate.host.js'
```
یا فایل `reviewer-gate.host.js` رو از پوشه plugins حذف کن.

---

## 📁 ساختار کلی پوشه

```
dpPlug/
├── README.md                          ← این فایل
├── install.ps1                        ← اسکریپت نصب خودکار
│
├── claude-preset/                     ← پریست Claude Mode
│   ├── agent.cordis.yml               ← کامپوزیشن اصلی پریست
│   ├── package.json                   ← پیکربندی Node
│   ├── preset.yml                     ← نام و توضیحات نمایشی
│   └── plugins/
│       ├── claude-skill-provider.mjs  ← اسکنر .claude/skills
│       └── claude-commands.mjs        ← ثبت .claude/commands
│
└── gate-safety/                       ← پلاگین ایمنی Reviewer Gate
    ├── README.md                      ← راهنمای جداگانه Gate Safety
    ├── reviewer-gate.host.js          ← کد اصلی پلاگین
    └── cordis.patch.yml.snippet       ← خطوط مورد نیاز برای cordis.patch.yml
```

---

## 📄 لایسنس

MIT — آزادانه استفاده، تغییر و توزیع کنید.

---

ساخته‌شده با ❤️ برای جامعه DeepSeek Harness
