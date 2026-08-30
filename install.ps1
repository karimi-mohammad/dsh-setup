<#
.SYNOPSIS
    نصب پریست Claude Mode روی DeepSeek Harness

.DESCRIPTION
    این اسکریپت پوشه‌ی پریست رو به مسیر صحیح کپی و حافظه‌ی سراسری Claude رو وصل می‌کنه.

.EXAMPLE
    .\install.ps1
#>

$ErrorActionPreference = 'Stop'

# ── مسیرها ──────────────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PresetSource = Join-Path $ScriptDir 'claude-preset'
$PresetTarget = Join-Path $env:USERPROFILE '.dsh\.agent-presets\claude'

# ── بررسی پیش‌نیازها ─────────────────────────────────────────────────────────
Write-Host "`n🧩 Claude Mode — DeepSeek Harness Preset Installer" -ForegroundColor Cyan
Write-Host "=" * 55

if (!(Test-Path $PresetSource)) {
    Write-Host "❌ پوشه‌ی claude-preset پیدا نشد: $PresetSource" -ForegroundColor Red
    exit 1
}

$DshHome = Join-Path $env:USERPROFILE '.dsh'
if (!(Test-Path $DshHome)) {
    Write-Host "⚠️  پوشه‌ی ~/.dsh وجود نداره. آیا DSH نصب هست؟" -ForegroundColor Yellow
    Write-Host "   اگه تازه نصب کردید، اول یه بار هارنس رو اجرا کنید." -ForegroundColor Yellow
    $proceed = Read-Host "   ادامه بدم؟ (y/N)"
    if ($proceed -ne 'y' -and $proceed -ne 'Y') { exit 0 }
    New-Item -ItemType Directory -Path $DshHome -Force | Out-Null
}

$AgentPresetsDir = Join-Path $DshHome '.agent-presets'
if (!(Test-Path $AgentPresetsDir)) {
    New-Item -ItemType Directory -Path $AgentPresetsDir -Force | Out-Null
}

# ── کپی پریست ───────────────────────────────────────────────────────────────
Write-Host "`n📦 در حال کپی پریست..." -ForegroundColor Green

if (Test-Path $PresetTarget) {
    Write-Host "   ⚠️  پریست قبلی وجود داره. در حال بروزرسانی..." -ForegroundColor Yellow
    Remove-Item -Path $PresetTarget -Recurse -Force
}

Copy-Item -Path $PresetSource -Destination $PresetTarget -Recurse -Force

$files = Get-ChildItem -Path $PresetTarget -Recurse -File
Write-Host "   ✅ $($files.Count) فایل کپی شد" -ForegroundColor Green

# ── وصل حافظه‌ی سراسری ───────────────────────────────────────────────────────
Write-Host "`n🔗 در حال وصل کردن حافظه‌ی سراسری..." -ForegroundColor Green

$ClaudeMemory = Join-Path $env:USERPROFILE '.claude\CLAUDE.md'
$DshMemory = Join-Path $DshHome 'AGENTS.md'

if (Test-Path $ClaudeMemory) {
    if (Test-Path $DshMemory) {
        Write-Host "   ℹ️  فایل ~/.dsh/AGENTS.md از قبل وجود داره — رد شد" -ForegroundColor DarkGray
    } else {
        try {
            New-Item -ItemType HardLink -Path $DshMemory -Target $ClaudeMemory | Out-Null
            Write-Host "   ✅ Hardlink ایجاد شد: ~/.dsh/AGENTS.md → ~/.claude/CLAUDE.md" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠️  Hardlink ایجاد نشد (ممکنه Dev Mode فعال نباشه)" -ForegroundColor Yellow
            Write-Host "      فایل رو دستی کپی کنید: Copy-Item `"$ClaudeMemory`" `"$DshMemory`"" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "   ℹ️  فایل ~/.claude/CLAUDE.md وجود نداره — رد شد" -ForegroundColor DarkGray
    Write-Host "      (حافظه‌ی سراسری Claude هنوز ساخته نشده)" -ForegroundColor DarkGray
}

# ── نتیجه ────────────────────────────────────────────────────────────────────
Write-Host "`n" + ("=" * 55)
Write-Host "🎉 نصب با موفقیت انجام شد!" -ForegroundColor Cyan
Write-Host ""
Write-Host "下一步:" -ForegroundColor White
Write-Host "  1. DeepSeek Harness رو باز کنید" -ForegroundColor White
Write-Host "  2. یه جلسه‌ی جدید بسازید" -ForegroundColor White
Write-Host "  3. پریست «Claude Mode» رو انتخاب کنید" -ForegroundColor White
Write-Host "  4. پروژه‌تون رو باز کنید!" -ForegroundColor White
Write-Host ""
Write-Host "📁 مسیر نصب: $PresetTarget" -ForegroundColor DarkGray
Write-Host ""
