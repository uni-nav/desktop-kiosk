# Windows Usersga Tarqatish (Macdan)

## 1) Tayyor fayllar
Bu 3 ta faylni bitta papkaga qo'ying:

- `Universitet Kiosk Setup <version>.exe` (masalan: `Universitet Kiosk Setup 1.2.1.exe`)
- `update-client.ps1`
- `update-local.cmd`

Joylashuvi:
- setup: `release/`
- scriptlar: `tools/`

## 2) Foydalanuvchiga yuborish
Papkani:
- Telegram/Email orqali yuboring, yoki
- umumiy network papkaga joylang.

Foydalanuvchi faqat bitta faylni ishga tushiradi:
- `update-local.cmd`

`update-local.cmd` yakunda oynani yopmaydi:
- ekranda natija ko'rinadi,
- log fayl yozadi: `update-local.log`.

Script o'zi:
- admin bo'lib qayta ishga tushadi,
- kiosk processlarni to'xtatadi,
- Assigned Access policy ni (`MDM_AssignedAccess`) tozalashga urinadi (SYSTEM bilan ham),
- setup ni silent update qiladi,
- setup faylning Authenticode imzosini tekshiradi (valid bo'lmasa to'xtaydi).

Ixtiyoriy qo'shimcha xavfsizlik:
- SHA256 tekshirish:
  `update-local.cmd -ExpectedSha256 <hash>`
- URL orqali update bo'lsa HTTPS talab qilinadi (faqat majburan kerak bo'lsa `-AllowInsecureDownload`).

## 2.1) Agar baribir qayta ochilsa
Bu holatda policy odatda Intune/MDM tomonidan qayta push qilinadi.

Qilish kerak:
- Intune da kiosk/Assigned Access profilini vaqtincha `Unassign` qiling.
- 1-2 daqiqa kuting.
- `update-local.cmd` ni qayta ishga tushiring.
- Update tugagach policy ni qayta assign qiling.

## 3) Ko'p kompyuterga bir vaqtda (IT usuli)
Agar domen/IT boshqaruv bor bo'lsa, quyidagi commandni Intune/GPO/PDQ bilan push qiling:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "\\server\kiosk\update-client.ps1" -SetupUrl "https://server/path/Universitet%20Kiosk%20Setup%201.2.1.exe" -ExpectedSha256 "<sha256>"
```
