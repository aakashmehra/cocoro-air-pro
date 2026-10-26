# Sharp aircon wireless LAN: first-time Wi-Fi setup (reverse-engineered)

Source: COCORO AIR Android 2.2.18 decompiled with jadx. Paths are relative to
`decompiled/jadx/sources/` unless they start with `resources/`. Lines are jadx output lines.
Marks: **[code]** means read directly from code. **[inferred]** means a strong inference.
**[unknown]** means it needs a live test.

---

## 0. TL;DR

| | |
|---|---|
| Setup methods for the aircon | (a) **WPS** (router push button), (b) **AP mode** (the unit hosts an open SSID `AP-SHARP-…` and the phone sends the home SSID and password), (c) "already connected to the router", which only does cloud registration. |
| AP-mode handover | Plain **HTTP** to host **`aiot.sharp`** on the adapter's own AP. The app sends `GET /get/hostinfo` (JSON), then `GET /get/rsapub` (an RSA public key, X.509 DER), then `POST /set/wlaninfo` with `RSA-PKCS1v1.5(pubkey, {"ssid","passphrase"[,"keykind"]})` as the raw body. Every request carries the header `X-AiotKey: ZghFpx0h6xlzeP4M`. HTTP 200 means success. There is no HMAC, challenge or session in this step. |
| The HMAC TCP protocol (`p104u3/a.java`) | **Not** part of Wi-Fi setup. It runs on TCP **8765** to an adapter that is **already on the home LAN**. It is used for cloud registration ("pairing"), LED blink, firmware update and clearing the cloud link. You can skip it for local control. |
| Cloud required to join Wi-Fi? | **No** [code]. The Wi-Fi handover finishes, and the app disconnects from the AP, before any cloud call is made. Cloud registration is a separate, later step that the user starts. Whether ECHONET Lite on UDP 3610 answers before cloud registration is **[unknown]**. Nothing in the app uses 3610. |
| iOS | Join the open `AP-SHARP-xxxx` network (in Settings, or with `NEHotspotConfiguration(ssidPrefix:)`), then run 3 HTTP requests over Wi-Fi only. The handover needs no multicast or broadcast. |

---

## 1. Setup methods and user steps

### 1.1 Entry flow in the official app

`ApplianceListActivity` → menu "register device" → `jp/co/sharp/android/cocoro/wlanap/appliance/ApplianceMainActivity`
(`ApplianceListActivity.java:30163-30165`). The AP-mode library ("aplib", packages `e3`…`m3` plus `jp.co.sharp.android.cocoro.wlanap.*`) runs these screens:

1. **`g3/c`** (`fragment_select_presence_connection`, `p034g3/c.java:65`) offers two cards:
   - "これから機器とルーターを接続する": *Connect the device to the router now* → step 2.
   - "すでに機器をルーターに接続している（アプリに登録）": *The device is already connected to the router (register in app)* → result code 0 → main app `ApplianceAddActivity`, which does LAN discovery and cloud pairing (`p034g3/c.java:164`, `AppModel.java:528-533`).
2. **`g3/d`** (`fragment_select_router_kind`, `p034g3/d.java:80-89`): "ルーターをご確認ください" (*Check your router*):
   - "【無線接続ボタンあり】ルーターの無線接続ボタンで接続する": *[Router has a wireless-connect button] Connect with the router's button* → `routerKind="wps"`.
   - "【無線接続ボタンなし/わからない】ルーターのSSIDとパスワードで接続する": *[No button / not sure] Connect with the router's SSID and password* → `routerKind="noWps"`.
   - Footnote: WPS, AOSS and らくらく無線スタート (Raku-Raku Wireless Start) are all treated as "the button".
3. **`g3/a`** (`fragment_appliance_select`, `p034g3/a.java:92-101`): pick エアコン (aircon, kind `airCond`) or 空気清浄機 (air purifier, kind `airClean`).
   A "非対応機種" (*unsupported models*) dialog lists the aircon models that **cannot use the button-less (AP) path** (`p034g3/a.java:220`, strings `aplib_air_list_not_support_appliance_aircon_*`):
   **AY-H\*\*, AC-\*\*8HT, and any model with an external adapter (外付けアダプターの機種)**. For ASEAN builds: AH-XP10VX\*\*, AH-XP13VX\*\*, AH-XP10VF, AH-XP15VF, AH-PHX10, AH-PHX13.
   → **If your unit uses the external "家電ワイヤレスアダプター" (adapter "A01" in the help pages), AP mode is not available. Only WPS works.**
4. **`g3/b`** (`fragment_connect_appliance`) loads the instruction page in a WebView from
   `https://hms.cloudlabs.sharp.co.jp/terms/apmode/<lang>/<withWPS|noWPS>/air/AirConditionerProcedure.html`
   (`p039h3/o.java:47, 58-66, 93-98`; base URL `p024e3/c.java:9`). "Next" then branches:
   - WPS: result code 1 → `ApplianceAddActivity` (LAN discovery, then cloud pairing) (`p034g3/b.java:64-65`).
   - noWps: opens `WlanAPListActivity`, the AP-mode flow in section 2 (`p034g3/b.java:67`).

### 1.2 WPS (aircon with a built-in adapter, "B01")

The bundled copy of the WPS page, `resources/assets/lib_AirConditioner_html/AirConditionerProcedure.html`, reads:

> 手順に従い操作してください
> 1. メニューボタンを3秒間押すと、コネクトランプが点滅します。
> 2. 点滅から2分以内にルーターの無線接続ボタンを押してください。
> 3. メロディーが流れコネクトランプが点灯したら接続成功です。次にスマートフォンに機器登録してください。点灯しないときはサポートサイトをご確認ください。

English:
1. **Hold the remote's "メニュー" (MENU) button for 3 seconds.** The unit's **CONNECT lamp (コネクトランプ) starts blinking.**
2. **Within 2 minutes of the blinking starting, press the WPS button on the router.**
3. **A melody plays and the CONNECT lamp stays lit: the connection succeeded.** Next, register the device on the smartphone. If the lamp does not light, check the support site.

The phone does no network exchange during WPS. [code] The page is static HTML and "Next" only moves to discovery.
**[unknown]** The live server copy may differ from the bundled one. You can open the URL above in a desktop browser yourself; I did not fetch it.

### 1.3 AP mode (aircon with a built-in adapter only)

- The adapter broadcasts **SSID `AP-SHARP-<suffix>`**. The app filters on the prefix `AP-SHARP-` (`wlanaplist/d.java:403, 408`; `wlanaplist/e.java:273`).
  UI text: "ネットワーク名の下二桁は機器のMACアドレスの下二桁と同じです" (*the last two characters of the network name match the last two digits of the device's MAC address*) (`aplib_common_inform_confirm_network_id_mac_address`).
- **Security: open (no password).** [code, strong] The scan list keeps only `AP-SHARP-` entries whose capabilities contain none of WEP, WPA or WPA2 (`wlanaplist/e.java:192` with `p049j3/b.java:24-26`). On Android 10 and later the app joins with `WifiNetworkSpecifier.setSsid()` and no passphrase (`wlanaplist/e.java:222-227`). A specifier without a passphrase only matches open networks.
  A legacy fallback passphrase **`KPC18SMK`** is used if the chosen AP is secured (`wlanaplist/d.java:118-121`, pre-Android-10 path). Try open first and fall back to WPA2-PSK `KPC18SMK`.
- **How to put the unit into AP mode: [unknown].** The instructions live only on the server page `…/terms/apmode/ja/noWPS/air/AirConditionerProcedure.html`, which is not bundled. What the app shows at the SSID-selection step is:
  "コネクトランプの点滅を確認し、接続する機器のネットワーク名を選択してください" (*Confirm the CONNECT lamp is blinking, then select the device's network name*) (`aplib_common_inform_confirm_connect_network_id`).
  So the unit shows a blinking CONNECT lamp while in AP mode. The button sequence probably differs from WPS (a different MENU press or hold), but check the server page or the aircon's manual before you hard-code it.
- After the handover, the completion screen (`fragment_send_wlaninfo_complete`) says:
  "コネクトランプが点灯に変われば接続成功です" (*if the CONNECT lamp turns solid, the connection succeeded*), "コネクトランプ点灯まで数秒がかかります" (*the lamp can take a few seconds to light*), and "点灯しない場合、ホーム画面からやり直してください" (*if it does not light, start again from the home screen*). Buttons: "ホームへ" (*Home*) and "アプリに登録" (*Register in app*), which starts cloud pairing (`p064m3/a.java:101-113`).
- Constraints from the UI: **only 2.4 GHz** routers are listed, unless `/get/hostinfo` returns `"WiFi_5G": true` (`wlanaplist/e.java:196-201, 351-353`; `aplib_common_inform_enter_router_ssid_for_24GHz`). The **password must be 8 or more characters** unless security is OPEN (`resources/res/values/integers.xml:15`, `p059l3/e.java:213`). No WPA3 option exists.

### 1.4 Other adapter-related procedures (cloud side, for reference)

| Procedure | User action (JA → EN) | Source |
|---|---|---|
| Cloud pairing, built-in adapter (B01) | "3分以内にリモコンの「メニュー」ボタンを押してください": *Press the remote's MENU button within 3 minutes.* | `resources/assets/pairing_aircon.html` |
| Cloud pairing, external adapter (A01, 家電ワイヤレスアダプター) | "アダプターのリンクボタンを2秒間押し続けてください。アダプターのリンクランプが点滅を始めます": *Hold the adapter's LINK button for 2 s; the LINK lamp starts blinking.* | same |
| Firmware update, B01 | Tap OK, then press the remote's MENU. The unit beeps to acknowledge. A melody plus a solid CONNECT lamp means done. | `firmupdate_aircon_b01.html` |
| Firmware update, A01 | Tap OK, then hold the adapter's 無線LAN (WLAN) button for 2 s or more. Three lamps blink together. Done when the WLAN lamp (or up to the LINK lamp) lights. | `firmupdate_aircon_a01.html` |
| Wireless LAN reset (無線LAN初期化) | Steps exist only on the server page `…/terms/air/ja/wlanInitialize/AirConditionerProcedure.html` **[unknown]** | `wlaninitialize/activity/WlanInitializeDescriptActivity.java:177-181` |

---

## 2. AP-mode handover protocol (the part to implement)

### 2.1 Transport

- **HTTP/1.1, no TLS**, host name **`aiot.sharp`**, default port 80 (`p029f3/d.java:24, 52, 102`).
  Android binds the whole process to the AP network first (`ConnectivityManager.setProcessDefaultNetwork(network)`, `wlanaplist/e.java:96`). That means both **DNS and HTTP go through the adapter's network**. `aiot.sharp` is resolved by the DNS server the adapter hands out over DHCP. **[inferred]** The adapter answers that name with its own IP. The app has no IP fallback.
  **[unknown]** The adapter's IP (probably the DHCP gateway). On iOS, read the gateway or DNS server address from the Wi-Fi interface as a fallback (section 4).
- `.sharp` is a real brand TLD on the public internet. **Never let this lookup or request go over cellular.** Force the Wi-Fi interface (section 4).
- Timeouts: connect 10 s, read 10 s (`p029f3/d.java:28-29, 57-58, 108-109`). Redirects are not followed.
- After joining the AP the app **waits 3 s** before the first request (`wlanaplist/e.java:403-410`, pre-Android-10 path).

### 2.2 Common header

```
X-AiotKey: ZghFpx0h6xlzeP4M
```
This is a static constant on every call (`p029f3/d.java:27, 55, 105`). No other auth is used.

### 2.3 Step 1: `GET http://aiot.sharp/get/hostinfo`

Request headers: `X-AiotKey` only. The response on HTTP 200 is a JSON object (`p029f3/e.java:58-60`, parsed in `p029f3/g.java:34-43`).
A sample is bundled as `resources/assets/getHostInfoResult.json`:
```json
{ "EOJ": "0130", "ProductName": "ABCD-EFG", "mac": "01-23-45-67-89-AB", "ssid": "dummySSID", "WiFi_5G": false }
```
| Field | Meaning |
|---|---|
| `EOJ` | ECHONET object class/instance as hex. Values starting with `0130` are a home air conditioner; `0135` is an air purifier (`p039h3/c.java:63-64, 84-97`). |
| `ProductName` | Model name, shown to the user. |
| `mac` | Adapter MAC, shown to the user. |
| `ssid` | Shown under "ネットワーク名" (network name). **[inferred]** This is the adapter's own AP SSID. |
| `WiFi_5G` | Optional bool. If true the router list also shows 5 GHz networks (`wlanaplist/e.java:197-201`). |

The app shows these fields on a "機器の確認" (*device confirmation*) screen, "この機器とルーターを接続してよろしいですか？" (*Connect this device to the router?*), and then lists home networks (`p059l3/a.java:104-164`).

### 2.4 Step 2: `GET http://aiot.sharp/get/rsapub`

Request headers: `X-AiotKey: ZghFpx0h6xlzeP4M` and `Content-Type: application/octet-stream` (`p029f3/d.java:52-58`).
On HTTP 200 the body is raw bytes of length `Content-Length` (`p029f3/f.java:59-61`, `p029f3/h.java:49-65`). Those bytes are an **X.509 SubjectPublicKeyInfo DER RSA public key**, loaded with `KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(bytes))` (`p029f3/i.java:38-40`).
**[unknown]** The modulus size (2048-bit is likely). PKCS#1 v1.5 limits the plaintext to `k - 11` bytes, which is 245 bytes for 2048-bit. The largest possible JSON (32-byte SSID, 63-byte passphrase) is about 140 bytes, so it fits.

The app fetches the key **after** the user has entered the password: it calls `GET /get/rsapub` and then immediately `POST /set/wlaninfo` (`p059l3/f.java:123-131`).

### 2.5 Step 3: `POST http://aiot.sharp/set/wlaninfo`

**Plaintext** is compact JSON in UTF-8, with keys in this order (`p029f3/d.java:76-90`):
```json
{"ssid":"<home SSID>","passphrase":"<home password>","keykind":"<optional>"}
```
- `keykind` is included **only** when it is one of `OPEN`, `WPA-AES`, `WPA-TKIP`, `WPA2-AES` or `WPA2-TKIP` (`p029f3/d.java:81-83`).
  - On the normal "pick a scanned network" screen it is `"OPEN"` when the user picks security "なし" (*none*). Otherwise it is **omitted**, and the adapter auto-detects (`p059l3/e.java:209`).
  - On "その他のネットワーク" (*other network*, a hidden SSID typed by hand) the spinner offers 自動識別 (*auto*, omitted), なし (`OPEN`), `WPA-AES`, `WPA-TKIP`, `WPA2-AES` and `WPA2-TKIP` (`p059l3/b.java:233-236`, `resources/res/values/arrays.xml:9-15`).
  - With `OPEN` the passphrase is `""`.
- Android's `org.json` escapes `/` as `\/`. Matching that is harmless. Any compliant JSON parser accepts either form.
- The app's built-in debug test vector (`p029f3/d.java:85`) is `{"ssid":"TOOLTEST","passphrase":"gamt123456789","keykind":"WPA2-TKIP"}`.

**Encryption:** `Cipher.getInstance("RSA/ECB/PKCS1PADDING")` in ENCRYPT_MODE with the step 2 key, applied to `json.getBytes("UTF-8")` (`p029f3/i.java:24-28`). This is a single block with no base64 or other wrapping.

Request (`p029f3/d.java:102-110`, body written in `p029f3/j.java:52-55`):
```
POST /set/wlaninfo HTTP/1.1
Host: aiot.sharp
X-AiotKey: ZghFpx0h6xlzeP4M
Content-Type: application/octet-stream
Content-Length: <len(ciphertext)>      (256 for a 2048-bit key)

<ciphertext bytes>
```
**Result:** HTTP **200** means success (`p029f3/j.java:131-137`). The body is ignored. Any other status, an IO error or a timeout means failure. The app's internal error strings are `"004"` (generic or encryption failed), `"010"` (IO) and `"011"` (timeout) (`p049j3/a.java`).

### 2.6 What the app does afterwards

1. On 200 it immediately **drops the AP connection** (`p049j3/b.g`, called at `p059l3/f.java:96`) and shows the completion screen (`p059l3/e.java:106-113` → `p064m3/a`).
2. It **does not verify** that the adapter joined the home network. The user is told to watch the CONNECT lamp turn solid (section 1.3).
3. If the user taps "アプリに登録" (*Register in app*), result code 2 opens `ApplianceAddActivity`. That screen runs the LAN discovery in section 3.2, then the TCP 8765 pairing and the `setting/tempBoxInfo` and `setting/pairing` cloud calls (section 3).

On failure the dialog reads "接続に失敗しました。ルーターの状態を確認してやり直してください。" (*Connection failed. Check the router and try again.*) (`p059l3/e.java:238-256`).

---

## 3. Cloud registration: what it is and why it can be skipped

### 3.1 Sequence (all **after** the unit is on the home LAN)

1. **LAN discovery** over UDP port 8766, broadcast (section 3.2).
2. **TCP 8765 `flash_led`** (cmd 0x0005) makes the adapter blink so the user can identify it (`PairingConfirmActivity.java:213`).
3. **TCP 8765 `get_info`** (cmd 0x0002) returns version, flags, `cloudKey` and MAC (`PairingConfirmActivity.java:275`).
4. **Cloud** `POST setting/tempBoxInfo` with that cloudKey (`D3/j.java:262-274`, `D3/q.java:2639-2682`).
5. The user presses MENU on the remote (B01) or holds LINK for 2 s (A01) to put the adapter into cloud-registration mode.
6. **TCP 8765 `register_on_server`** (cmd 0x0003) repeats every 3 s while the result is 2 or "other" (`PairingConfirmActivity.java:577-583, 919-960`).
   Result codes: `0` success, `1` adapter aborted, `2` adapter not in cloud-registration mode yet (retry), `3` adapter↔cloud communication error, `4` cloud rejected the registration, other values are internal errors (retry).
7. **Cloud** `setting/pairing` and device-info calls.

Only steps 4 and 7 talk to Sharp. Steps 2, 3 and 6 talk to the adapter, but they exist only to bind it to the cloud account. **None of these steps is required to put the unit on Wi-Fi.** The handover in section 2 is complete on its own.
**[unknown]** Whether the adapter enables ECHONET Lite on UDP 3610 before it is cloud-registered. The app's own discovery (step 1) shows the adapter answers ECHONET-formatted frames on 8766 before registration. 3610 is never used by the app, so test it.

### 3.2 LAN discovery (UDP 8766, Sharp proprietary, ECHONET Lite framing)

- Socket bound to local port **8766**. It sends to the **subnet broadcast address** of `wlan0` on port **8766**, 10 times at 500 ms intervals, and listens for 10 s (`p104u3/j.java:63-79, 95-122`).
  The constant `224.0.23.0` (`p104u3/b.java:84-85`) is passed in but never used for sending.
- Request frame (`p104u3/b.java:161-166`, serialized by `p104u3/f.java:115-154`, EPCs from `p104u3/e.java:62-63`):
  ```
  10 81 00 01  05 FE 01  0E F0 01  62  02  D6 00  8C 00
  EHD   TID    SEOJ      DEOJ      Get OPC (instance list S) (product code)
  ```
- A Get_Res (`0x72`) from `0EF001` to `05FE01` with D6 and 8C means "adapter found". For each instance in D6 whose class is aircon or purifier, the app sends a unicast Get to `<ip>:8766` (sent 3 times) for EPCs `8A 8C F0 FC FD`. The maker code (8A) must be `00 00 05` (Sharp) (`p104u3/g.java:115-124, 209-275`).
- Then the app talks TCP to `<ip>:8765` (`p104u3/b.java:129`).

### 3.3 TCP 8765 adapter command protocol (`p104u3/a.java`)

Not used by this app (cloud registration and firmware updates only). Summarized for completeness.

**Key:** an HMAC-SHA256 key embedded in the official app. Omitted here: this app does not use the TCP 8765 channel.

**Per command** (a new TCP connection each time; connect timeout 5 s):
1. Client → 8 bytes `00×8` ("requestRandom").
2. Adapter → 32 bytes `R[16] || MD5(R)[16]`. The client checks the MD5 and aborts on mismatch (`p104u3/a.java:94-124`).
3. Client → 36-byte request (`p104u3/a.java:858-899`):
   `len=0x0024 (BE u16) || HMAC-SHA256(key, R || cmd_be16) [32] || cmd_be16`
   | cmd | name | read timeout |
   |---|---|---|
   | `0x0001` | (unused by the UI) | |
   | `0x0002` | get_info | 10 s |
   | `0x0003` | register_on_server | 30 s |
   | `0x0004` | update_firmware | 130 s |
   | `0x0005` | flash_led | 3 s |
   | `0x0008` | clear_link_info | 40 s |
4. Adapter → response, read into 40 bytes (309 bytes for get_info):
   `len (BE u16, ≥36) || HMAC-SHA256(key, R || resp[34:len]) [32] || body…`. Verified in `p104u3/a.java:130-157`.
   - If `resp[34:36] == 8F FF`: error, code `= (int16)resp[38:40] + 65536`.
   - Otherwise result `= (int16)resp[36:38]`. **[inferred]** `resp[34:36]` echoes the command.
   - get_info layout (`p104u3/a.java:485-491`): `[36].[37].[38:40 BE]` is the firmware version string, `[40:42]` flags, `[42:298]` cloudKey (ASCII, NUL-terminated), `[298:304]` MAC.

`flash_led` is a useful cloud-free "which unit is this?" call once the adapter is on the LAN.

---

## 4. iOS implications

1. **Joining the AP.** iOS apps cannot scan Wi-Fi, so there is no SSID list. Either:
   - The user joins `AP-SHARP-xx` in Settings → Wi-Fi (open network; iOS shows "No Internet Connection", which is fine), or
   - The app calls `NEHotspotConfiguration(ssidPrefix: "AP-SHARP-")` (iOS 13+, open network). This needs the **Hotspot Configuration** entitlement. If that fails, retry with `passphrase: "KPC18SMK", isWEP: false`. With `joinOnce = true` iOS drops the network when the app goes to the background, which suits a foreground wizard.
2. **Routing.** Because the AP has no internet, iOS may keep cellular as the primary interface. Force Wi-Fi for **both DNS and HTTP**:
   `URLSessionConfiguration.allowsCellularAccess = false` (also blocks fallback to the public `aiot.sharp`), or use `NWConnection` with `NWParameters.requiredInterfaceType = .wifi`.
   Fallback if `aiot.sharp` does not resolve: send the same requests to the Wi-Fi gateway IP (from `getifaddrs` plus the route table) with `Host: aiot.sharp`. **[unknown]** whether the adapter serves on the gateway IP. It very likely does.
3. **ATS.** This is plain HTTP to a fully qualified name. Add `NSAppTransportSecurity → NSExceptionDomains → aiot.sharp → NSExceptionAllowsInsecureHTTPLoads = YES`. Requests to IP literals are already exempt from ATS.
4. **Local Network privacy.** You need `NSLocalNetworkUsageDescription`. You probably already have it for ECHONET.
5. **No multicast or broadcast is needed for the handover.** It is 3 unicast HTTP requests.
   Verifying afterwards on the home LAN is a different matter. ECHONET multicast to `224.0.23.0:3610`, or Sharp's broadcast on 8766, needs the **`com.apple.developer.networking.multicast`** entitlement on iOS 14+. A unicast sweep of the /24 to port 3610 (ESV 0x62, EPC 0x83 or 0x8C) does not.
6. **Phone ↔ AP during the exchange.** Keep the app in the foreground from the moment the phone joins the AP until the 200 response. Send `/get/rsapub` and `/set/wlaninfo` back to back, as Android does.
7. **Wi-Fi password input.** iOS cannot read the current SSID without the location permission plus the "Access WiFi Information" entitlement, so ask the user to type the SSID. Optionally prefill it with `NEHotspotNetwork.fetchCurrent` before they switch to the AP.

---

## 5. Minimal implementation for our app

### Screens

1. **Choose method:** "Router has a WPS button" / "No button (AP mode)" / "Already on Wi-Fi".
   Warn that external-adapter units (A01) and AY-H\*\* / AC-\*\*8HT models do not support AP mode.
2. **Home network:** text fields for SSID and password, plus a security picker (Auto / None / WPA-AES / WPA-TKIP / WPA2-AES / WPA2-TKIP). Notes: 2.4 GHz only; password must be 8+ characters unless None.
3. **WPS path:** show the instructions in section 1.2, then go to step 7.
4. **AP path, put the unit in AP mode:** press and hold the remote's **Stop (停止)** button until the unit starts its own Wi-Fi (confirmed on a real unit; its network was named `AP-SHARP-15`). Wait until the CONNECT lamp blinks.
5. **Join the AP:** `NEHotspotConfiguration(ssidPrefix:"AP-SHARP-")`, or tell the user to join it in Settings and return. Then wait about 3 s.
6. **Handover**, all over Wi-Fi, 10 s timeouts:
   ```
   GET  http://aiot.sharp/get/hostinfo     X-AiotKey: ZghFpx0h6xlzeP4M
        → 200 JSON; require EOJ starting with "0130"; show ProductName/mac; ask the user to confirm
   GET  http://aiot.sharp/get/rsapub       X-AiotKey: ZghFpx0h6xlzeP4M
                                          Content-Type: application/octet-stream
        → 200, body = SPKI DER RSA public key
           (iOS: strip the SPKI header to the PKCS#1 RSAPublicKey, or use SecKeyCreateWithData
            on the inner key; encrypt with .rsaEncryptionPKCS1)
   POST http://aiot.sharp/set/wlaninfo     X-AiotKey: ZghFpx0h6xlzeP4M
                                          Content-Type: application/octet-stream
        body = RSA_PKCS1v15_encrypt(utf8('{"ssid":"…","passphrase":"…"[,"keykind":"…"]}'))
        → 200 = accepted
   ```
   If a hostinfo field is missing, skip the confirm screen. The Android app falls back to empty strings.
7. **Wait for rejoin:** the phone reconnects to home Wi-Fi (`NEHotspotConfigurationManager.removeConfiguration`, or let iOS fall back). Tell the user "the CONNECT lamp turns solid when done". Then probe the LAN every few seconds for up to about 60 s with ECHONET Lite on 3610 (a unicast sweep, or multicast if you have the entitlement). If 3610 is silent but the unit answers the Sharp discovery frame in section 3.2 on 8766, ECHONET 3610 may need cloud registration, which would be a new finding.
8. Done. Save the IP or EOJ for the existing ECHONET Lite controller.

Skipped: cloud pairing (`tempBoxInfo`, `register_on_server`, `setting/pairing`), which matters only for Sharp-cloud control.

---

## 6. Open questions (need a live test)

1. The exact remote or button sequence that starts AP mode on the user's model. It is on the server page `https://hms.cloudlabs.sharp.co.jp/terms/apmode/ja/noWPS/air/AirConditionerProcedure.html`; check it manually in a browser, or in the manual.
2. Whether the user's unit has a built-in adapter (B01, supports AP mode) or the external 家電ワイヤレスアダプター (A01, WPS only).
3. The adapter's IP on its AP, and whether `aiot.sharp` resolves through the adapter's DNS when queried from iOS over Wi-Fi.
4. The RSA key size from `/get/rsapub`.
5. Whether the adapter's AP is always open, or needs `KPC18SMK`.
6. **Whether ECHONET Lite on UDP 3610 answers before cloud registration.** Test right after step 6 with no Sharp account involved.
7. Whether `/set/wlaninfo` accepts a JSON body without the `\/` escaping. It should.
