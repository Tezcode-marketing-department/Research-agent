# LinkedIn + Google uchun oldindan login (ixtiyoriy, Windows).
#
# Research Agent endi Chrome'ni o'ZI boshqaradi (launchPersistentContext) —
# standing oyna yoki CDP porti SHART EMAS. Bu skript faqat birinchi login'ni
# oldindan, qulay vaqtda qilish uchun qulaylik skripti: shu oyna yopilgach ham
# sessiya profil papkasida saqlanadi, server keyingi safar o'zi (ko'rinmas
# rejimda) ishlatadi.
#
# MUHIM: profil papkasi src/mcp/linkedin.ts bilan BIR XIL bo'lishi shart —
# aks holda bu yerda kirgan sessiyangizni kod boshqa joydan qidiradi.
# Standart: linkedin.ts'dagi kabi $HOME\.chrome-linkedin (LINKEDIN_PROFILE_DIR
# env bilan ikkalasида ham bir xil qilib bekor qilsa bo'ladi).

param(
  [string]$ChromeBin = $(if ($env:CHROME_BIN) { $env:CHROME_BIN } else { "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" }),
  [string]$ProfileDir = $(if ($env:LINKEDIN_PROFILE_DIR) { $env:LINKEDIN_PROFILE_DIR } else { Join-Path $env:USERPROFILE ".chrome-linkedin" })
)

if (-not (Test-Path $ChromeBin)) {
  Write-Error "Chrome topilmadi: $ChromeBin (CHROME_BIN yoki -ChromeBin bilan ko'rsating)"
  exit 1
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

Start-Process -FilePath $ChromeBin -ArgumentList @(
  "--user-data-dir=$ProfileDir",
  "--no-first-run",
  "--no-default-browser-check",
  "https://www.linkedin.com/feed/"
)

Write-Output "Chrome ochildi (profil: $ProfileDir)."
Write-Output "LinkedIn'ga va Google'ga kiring — sessiya shu papkada saqlanadi."
Write-Output "Tugagach oynani yopishingiz mumkin — Research Agent keyingi safar shu profildan ko'rinmas rejimda o'zi ishlaydi."
