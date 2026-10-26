# Cocoro Air Pro

**A simple, fast, custom app for Sharp air conditioners.** Unofficial.

Control your Sharp air conditioner straight over your home Wi‑Fi: no account, no login, no cloud. Schedules, favorites and a clean Liquid Glass design.

[日本語はこちら → README.ja.md](README.ja.md)

---

## Why I made this

I wanted to control my Sharp air conditioner without signing in to an account and without every tap going through a cloud server first.

So I built my own. Cocoro Air Pro talks to the air conditioner directly on your home Wi‑Fi. Open the app, it finds the air conditioner, done. It can even put a brand-new air conditioner on your Wi‑Fi, so you never need the official app.

> **Sharp team, if you're reading this repo:** hire me for your design. I'll build you a really good app. 🙂
> **hello@aakashmehra.com**

## Two versions

| | **Wi‑Fi only** (`CocoroAirPro-WiFi.ipa`) | **Account** (`CocoroAirPro-Account.ipa`) |
|---|---|---|
| Sign-in | None | Sharp Cocoro Members account, or home Wi‑Fi, or demo |
| Works away from home | No | Yes, when signed in |
| Schedules | Shortcuts automations | Sharp cloud timers when signed in, Shortcuts on home Wi‑Fi |

Most people want **Wi‑Fi only**.

## Features

- **Connects by itself.** Finds your air conditioner on the home Wi‑Fi and finds it again if the router gives it a new address.
- **No account, no login.** Everything stays on your phone and your home network.
- **Built-in Wi‑Fi setup** for a new air conditioner, with the router's pairing button or the air conditioner's own Wi‑Fi. No official app needed.
- **All the controls:** power, cool, heat, dry, fan and auto, temperature (0.5° steps on models that support it), fan speed, up/down and left/right airflow, Plasmacluster and gentle airflow.
- **Schedules:** turn on with your settings, or turn off, at set times on chosen days, even with the app closed.
- **Favorites:** save your usual settings and apply them in one tap. They also show up in Shortcuts and Siri.
- **Glass tab bar** (Controls, Schedule, Favorites, Settings), dial and airflow animations, Inter font, light and dark mode.
- **ⓘ How it works** on the first screen, with troubleshooting tips.

## Supported air conditioners

| Air conditioner | Status |
|---|---|
| Sharp air conditioners with built-in Wi‑Fi | Built and tested with mine |
| Sharp air conditioners with the wireless adapter (家電ワイヤレスアダプター) | Should work, not tested yet |

The air conditioner joins **2.4 GHz** Wi‑Fi only. If your router shows two network names, use the 2.4 GHz one (often ending in `-G` or `-2G`).

If you try it with another model, please open an issue and tell me how it went.

## ⚠️ Schedules need your iPhone at home

Sharp air conditioners have no built-in timer that can be set over Wi‑Fi, so the **Wi‑Fi only** version runs schedules from your iPhone with Apple's **Shortcuts** app. After you create a schedule, a one-time step in Shortcuts makes it run every day at that time, even with the app closed. Your iPhone needs to be on your home Wi‑Fi at that time.

If you need schedules that run while you're away, use the **Account** version signed in: its timers run on Sharp's server.

## Install

### Sideload the IPA
Download `CocoroAirPro-WiFi.ipa` (or `CocoroAirPro-Account.ipa`) from [Releases](../../releases) and install it with [AltStore](https://altstore.io) or [Sideloadly](https://sideloadly.io) using your own Apple ID. The IPA is unsigned, so those tools sign it for your device. With a free Apple ID you'll need to refresh it every 7 days.

Tip: always update with the same tool. AltStore and Sideloadly install under slightly different app IDs, so switching tools gives you a second copy instead of an update.

### Build from source
Requires a Mac with Xcode and Node.js.

```bash
git clone https://github.com/aakashmehra/cocoro-air-pro.git
cd cocoro-air-pro
npm install
WIFI_ONLY=1 npx expo run:ios --device   # Wi‑Fi only version
npx expo run:ios --device               # Account version
```

> Running in **Expo Go** (`npx expo start`) works too, but only in **Demo mode**, because Expo Go can't talk to devices on your local network.

## How to use

1. **Get the air conditioner on your Wi‑Fi** (skip if it already is). On the first screen, tap **Set up Wi‑Fi**:
   - **Router button:** on the remote, hold **Menu** for 3 seconds until the Connect lamp blinks, then press your router's Wi‑Fi pairing button within 2 minutes.
   - **Air conditioner's own Wi‑Fi:** on the remote, hold **Stop** until a network called `AP-SHARP-` and a number appears. Join it in Settings, come back, and enter your home Wi‑Fi name and password.
2. Open the app on your home Wi‑Fi and allow **Local Network** access when iPhone asks. It finds the air conditioner.
3. **Controls:** drag the dial or tap plus and minus, pick a mode, fan and airflow.
4. **Favorites:** tap **Save current settings**, then tap a favorite any time to apply it.
5. **Schedule:** tap **New schedule**, pick a time, days and what to do, then follow the one-time **Finish in Shortcuts** steps.
6. **Settings:** see the connection, or disconnect.

## Tech

Expo SDK 58 · React Native · TypeScript · Expo Router (native tabs) · Reanimated · react-native-svg · a small Swift module for ECHONET Lite over UDP · App Intents for Shortcuts

How the air conditioner, Sharp's cloud and the Wi‑Fi setup work is written up in [docs/](docs).

```bash
npm run typecheck        # TypeScript
npm run test:protocol    # protocol unit tests
```

## Disclaimer

Cocoro Air Pro is an independent, unofficial project. It is **not affiliated with, endorsed by, or sponsored by Sharp Corporation**. Sharp, Cocoro Air, Plasmacluster and all related names are trademarks of their respective owners and are used here only to describe compatibility.

Use it at your own risk.

## License

[MIT](LICENSE) © 2026 Aakash Mehra · hello@aakashmehra.com
