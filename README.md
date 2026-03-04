# 🖥️ University Kiosk - Desktop App

<div align="center">

![Electron](https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

**Universitet uchun kiosk navigatsiya tizimi**

[Xususiyatlar](#-xususiyatlar) • [O'rnatish](#-ornatish) • [Ishga tushirish](#-ishga-tushirish) • [Build](#-build)

</div>

---

## ✨ Xususiyatlar

| Xususiyat | Tavsif |
|-----------|--------|
| 🖥️ **Kiosk Mode** | To'liq ekranli navigatsiya interfeysi |
| 📍 **Tezkor Qidiruv** | Xonalarni real-time qidiring |
| 🧭 **Smart Pathfinding** | A* algoritmi (online & offline) |
| 💾 **Persistent Storage** | SQLite - restart qilganda ham saqlanadi |
| 🔄 **Auto-Sync** | Internet borida avtomatik yangilanadi |
| 🎨 **Zamonaviy UI** | Touch-friendly, animatsiyali interfeys |

## 📱 Ekranlar

```
┌───────────────────────────────────────┐
│    🏛️ UNIVERSITET NAVIGATSIYA         │
│    ═══════════════════════════════    │
│                                       │
│    [Qayerga bormoqchisiz?]  🔍        │
│                                       │
│    ┌─────────────────────────────┐    │
│    │                             │    │
│    │      🗺️ INTERAKTIV          │    │
│    │         XARITA              │    │
│    │                             │    │
│    │    ●━━━🚶━━●━━━━●           │    │
│    │                             │    │
│    └─────────────────────────────┘    │
│                                       │
│    📍 101-xona → 🎯 201-xona          │
│    📏 750 metr • ⏱️ 15 daqiqa         │
│                                       │
└───────────────────────────────────────┘
```

## 🚀 O'rnatish

### Talablar

- Node.js 18+
- npm 9+

### 1. Clone va Install

```bash
git clone https://github.com/your-username/university-kiosk-desktop.git
cd university-kiosk-desktop
npm install
```

### 2. Environment sozlash

`.env` faylini yarating:

```bash
cp .env.example .env
```

`.env` ni tahrirlang:

```env
API_URL=https://map.ranch.university/api
ALLOW_INSECURE_TLS=false
ADMIN_SHORTCUTS_ENABLED=false
```

## 🔧 Ishga Tushirish

### Development Mode

```bash
# TypeScript kompilatsiya + Electron ishga tushirish
npm run dev
```

### Production Mode

```bash
# Build va run
npm start
```

## 📦 Build

### macOS

```bash
npm run dist:mac
# Natija: release/University Kiosk-*.dmg
```

### Windows

```bash
npm run dist:win
# Natija: release/University Kiosk Setup *.exe
```

### Linux

```bash
npm run dist:linux
# Natija: release/university-kiosk-*.AppImage
```

## 🏗️ Arxitektura

```
src/
│
├── 📁 main/                    # Electron Main Process
│   ├── main.ts                # App entry, IPC handlers
│   ├── database.ts            # SQLite + A* pathfinding
│   ├── api-sync.ts            # Server synchronization
│   ├── config.ts              # Configuration
│   └── preload.ts             # Context bridge (security)
│
└── 📁 renderer/                # UI (Browser Process)
    ├── launcher.html/ts       # Kiosk selection page
    ├── kiosk.html/ts          # Main navigation interface
    └── styles.css             # Styling
```

## 📶 Offline Mode

```
┌──────────────────────────────────────────┐
│              ONLINE MODE                  │
│  ┌─────────┐   ┌─────────┐   ┌────────┐  │
│  │ Backend │──▶│ API     │──▶│ SQLite │  │
│  │ Server  │   │ Sync    │   │   DB   │  │
│  └─────────┘   └─────────┘   └────────┘  │
└──────────────────────────────────────────┘
                    │
                    ▼ Server offline?
┌──────────────────────────────────────────┐
│              OFFLINE MODE                 │
│  ┌────────┐   ┌─────────────────────┐    │
│  │ SQLite │──▶│ Local A*            │    │
│  │   DB   │   │ Pathfinding         │    │
│  └────────┘   └─────────────────────┘    │
└──────────────────────────────────────────┘
```

## 💾 Data Storage

Ma'lumotlar SQLite bazasida saqlanadi:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/university-kiosk/kiosk-data.db` |
| Windows | `%APPDATA%/university-kiosk/kiosk-data.db` |
| Linux | `~/.config/university-kiosk/kiosk-data.db` |

## 🔌 IPC Channels

| Channel | Direction | Tavsif |
|---------|-----------|--------|
| `get-floors` | Renderer → Main | Qavatlar ro'yxati |
| `get-rooms` | Renderer → Main | Xonalar ro'yxati |
| `find-path` | Renderer → Main | Yo'l topish |
| `sync-data` | Renderer → Main | Ma'lumotlarni sync qilish |
| `sync-status` | Main → Renderer | Sync holati |

## 🛠️ Texnologiyalar

| Texnologiya | Versiya | Maqsad |
|-------------|---------|--------|
| Electron | 28.0 | Desktop framework |
| TypeScript | 5.0 | Type-safe code |
| SQLite (sql.js) | 1.8 | Local database |
| electron-builder | 24.0 | App packaging |

## 📝 Litsenziya

```
MIT License
Copyright (c) 2026 Bekmurod
```

---

<div align="center">

Made with ❤️ in Uzbekistan 🇺🇿

</div>
