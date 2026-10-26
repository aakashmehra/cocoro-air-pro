# Sharp COCORO AIR – Air-conditioner property encoding

Source of truth: `jp.co.sharp.hms.smartlink` 2.2.18 decompiled with jadx. All paths below are relative to
`decompiled/jadx/sources/` unless they start with `resources/`. The HTTP envelope, login, and polling flow are in
`protocol-cloud.md`. This file covers only **what goes inside `status[]`** and how to read it back.

Confidence tags: **[confirmed]** means read directly in the code, or also checked against an open-source
implementation. **[inferred]** means the semantics come from names, labels or logs, but the bytes are confirmed.
**[unknown]** is stated as unknown.

---

## 0. TL;DR

* The app writes and reads **ECHONET Lite EPCs** of the home air conditioner class (EOJ `0130xx`). The EPCs it uses
  are `0x80`, `0xB0`, `0xB3`, `0xA0`, `0xA1` and `0xCF`, plus **Sharp vendor EPCs**. The most important is `0xFA`, a
  binary "state-detail" frame that carries the 0.5 °C set temperature, the up/down and left/right louvers, and the
  gentle/pet sub-modes.
* `0xFA` writes use a **sparse frame**: `[checksum][0x00][14-byte "fields present" bitmap][data bytes 17..N]`.
  The checksum is the sum of every byte after it, mod 256. N is 80 for models from 2019 on and 128 for 2018 models.
* Status is **not** read from `0xB0`/`0xB3`. The app reads the vendor EPC `0xF1` (bytes: power source and internal
  mode), `0xFA` (set temperature and louvers), `0xA0` (fan), `0xBB`/`0xBA` (room temperature and humidity), `0x88`
  and `0x86` (errors), and `0xCF` (Plasmacluster).
* **Timers are not ECHONET.** They are cloud schedules created through
  `https://cboard.cloudlabs.sharp.co.jp/cocoroapp/api/v1/appliances/{id}/timers`, using a wall-clock `HH:mm` time in
  Asia/Tokyo. There is no relative "off in 2 h" timer and no use of EPC `0x90`–`0x95`.
* **Capabilities** come from a downloaded CSV keyed by model name:
  `https://cboard.cloudlabs.sharp.co.jp/cocoroapp/static/air/property/spec_0130.csv`. Each row holds a 32-byte spec
  string with the same layout as the device's own vendor EPC `0xF0`. The app never uses `0x9D`/`0x9E`/`0x9F`.
* The app refuses aircon models whose spec year is **≥ 22 or 0**. 2022+ models belong to the COCORO HOME app
  (`p094s3/C.java:29-50`). The protocol below targets 2014–2021 models. For 2022+ units it is untested: check
  against your own unit.

---

## 1. Wire representation of a property

`D3/m.java:1121-1164` (serialize) and `D3/m.java:1093-1119` (parse). Each element of
`controlList[].status[]` (write) or `deviceStatus.status[]` (read) is one of three shapes:

| `valueType` | JSON | Used for (write) | Content of `code` |
|---|---|---|---|
| `valueSingle` | `{"statusCode":"80","valueType":"valueSingle","valueSingle":{"code":"30"}}` | 80, B0, A0, A1, CF | 1 byte, 2 hex chars |
| `valueRange` | `{"statusCode":"b3","valueType":"valueRange","valueRange":{"type":"int","code":"24"}}` | B3 | **decimal** integer string (`type` defaults to `"int"`, `D3/m.java:970-973`) |
| `valueBinary` | `{"statusCode":"fa","valueType":"valueBinary","valueBinary":{"code":"9000…"}}` | FA, F9 | hex string of the whole EDT |

* **EPC case:** the app formats EPCs with `String.format("%2x", epc)`, which gives lowercase (`"fa"`, `"b3"`, `"cf"`).
  Status responses come back uppercase (`"FA"`, `"BB"`), and the app looks them up in uppercase
  (`F3/m.java:131-141`, `a.java:705-806`). The OSS libraries send uppercase and it works. Treat EPCs as
  case-insensitive. **[confirmed]**
* **Hex case inside the FA frame is mixed** in the app. The bitmap and checksum are lowercase; values typed in the UI
  are uppercase, such as `"0A"` and `"FF"`. The server is assumed to be case-insensitive. Lowercase is recommended.
* **Read types**, both in cloud JSON and in the locally parsed `echonetProperty`: 80, 88, A0 and CF are `valueSingle`
  hex. B3, BA and BB are `valueRange` decimal (BB is signed, B3 and BA are unsigned). Everything else is
  `valueBinary`. See `D3/m.java:892-911` and `1046-1060`.

Write wrapper, for reference only (`a.java:967-989`):
```json
{"controlList":[{"deviceId":123,"echonetNode":"<node>","echonetObject":"013001","status":[ ...properties... ]}]}
```
POST it to `control/deviceControl`. Poll `control/controlResult` until the result is `success` or `unmatch`. See
`protocol-cloud.md`.

---

## 2. The Sharp "sparse frame" (EPC 0xFA, 0xF9) – writing

Builder: `D3/d.java:54-134`.

```
byte#  (1-based, as used everywhere in the app)
 1        checksum = (sum of bytes 2..N) & 0xFF          D3/d.java:60-69,117-123
 2        0x00
 3..16    bitmap, 14 bytes = 112 bits, MSB-first          D3/d.java:98-115,125-134
17..N     data; byte k holds the value of field k, or 0x00 if not set   D3/d.java:79-96
```

* A field index is its 1-based byte position in the frame. The same index is used when reading, as 0-based offset
  `k-1`.
* Each field index maps to a bitmap bit through a table:
  * **0xFA** uses table `f741f` (`D3/d.java:15`). Fields 17..52 map to bits 1..36. Fields 53 and 54 also map to
    bit 36 (52..54 form one 3-byte field). Fields 55..80 map to bits 37..62. In short: `bit = k-16` for
    `k ≤ 52`, `bit = 36` for `k` in 52..54, and `bit = k-18` for `k ≥ 55`.
  * **0xF9** uses table `f740e` (`D3/d.java:12`). Fields 17..29 map to bits 1..13. Fields 30..42 map to bit 14.
    Field 43 maps to bit 15. Fields 44 and 45 map to bit 16. Fields 46 and 47 map to bit 17.
  * Bit `b` (1-based) is bit `7-((b-1)%8)` of bitmap byte `(b-1)>>3`, which is frame byte `3 + ((b-1)>>3)`.
* **Frame length N** = `F3.a.f(year)`, which is **80 if year ≥ 19, otherwise 128** (`F3/a.java:80-82`). "year" is the
  decimal model year from the spec (§6). The legacy ≤17 path always uses 128 (`F3/a.java:41`). Power-off always uses
  80 (`F3/a.java:74`). The 0xF9 frame is 17..48, so N = 48.
* Field indices above 80 cannot be set (the table has 80 entries). In 128-byte frames, bytes 81..128 are zero padding.

**Verified test vectors** (`scripts/check-aircon.mjs` checks both open-source captures byte for byte):

| intent | FA code (N = 80, 160 hex chars) |
|---|---|
| set temperature 20.0 (field 27 = 0x28) | `48 00 0020 0000…0000` with byte 27 = `28` → `4800002000000000000000000000000000000000000000000000280000…` (matches dvcrn/cocoro-sdk `state.ts`) |
| louver: vertical 01, horizontal 01 | `c20000000000c000…` with bytes 49,50 = `0101` (matches the dvcrn/sharp-cocoro `aircon.py` template) |

TypeScript reference:
```ts
const bitFor = (k: number) => (k <= 16 ? -1 : k <= 52 ? k - 16 : k <= 54 ? 36 : k - 18); // 0xFA table
export function buildFA(fields: Record<number, number>, n: 80 | 128): string {
  const b = new Uint8Array(n);                         // b[0] = byte 1
  for (const [ks, v] of Object.entries(fields)) {
    const k = +ks; if (k < 17 || k > 80) throw new Error(`field ${k}`);
    b[k - 1] = v & 0xff;
    const bit = bitFor(k) - 1; b[2 + (bit >> 3)] |= 0x80 >> (bit & 7);
  }
  b[0] = b.slice(1).reduce((s, x) => s + x, 0) & 0xff;
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
export const faByte = (code: string, k: number) => parseInt(code.substr((k - 1) * 2, 2), 16); // read
```

---

## 3. Commands the app sends (encode)

Mode codes, which the UI passes as int and `a.j()` maps to EDT (`a.java:456-469`): 65→`41` auto, 66→`42` cool,
67→`43` heat, 68→`44` dry, 69→`45` "Plasmacluster/ion fan" (送風; labelled 空気清浄 on models with an air purifier).
Any other value maps to `41`.

### 3.1 Start / change mode (+ temperature, + sub-mode), model year ≥ 18
`a.java:928-949` → `F3/a.java:7-21` and `84-136`. The properties are sent **in this order**:

1. `80` = `30` (power on)
2. `cf` = `41` (Plasmacluster/air-clean function ON, always forced on) **[confirmed bytes; the 0xCF meaning comes from a log string in `F3/d.java:21-28`]**
3. `b0` = mode EDT
4. Only for cool (`42`) or heat (`43`):
   * Model **without** 0.5 °C support (spec flag `HALF_DEG`, §6): `b3` = `valueRange` int, whole °C (decimal
     string, truncated). Stop here: no sub-mode handling.
   * Model **with** 0.5 °C support: `fa` frame (N per year) with **field 27 = temperature × 2**. If the model has the
     `GENTLE` flag or year ≥ 21, sub-mode fields are added as well:

| sub-mode (UI) | mode | FA field 42 | FA field 49 (vertical) | FA field 50 (horizontal) | extra property, inserted **before** `fa` |
|---|---|---|---|---|---|
| 0 normal | cool/heat | `00` | – | – | – |
| 1 やさしさ "gentle" | cool | `01` | `00` (auto) | – | `a0`=`41` (fan auto) |
| 1 やさしさ | heat | `01` | `01` (upward) | – | `a0`=`31` (quiet) |
| 2 pet (dog) | cool only | `02` | `05` (down) | `01` (front), only if the horizontal capability ≠ `00` | `a0`=`31` |
| 3 pet (cat) | cool only | `03` | `00` | `01`, only if the horizontal capability ≠ `00` | `a0`=`41` |

Auto, dry and fan modes send **no temperature**. The app has no auto-mode ±offset UI. **[confirmed: absent]**
Mode 69 with the "deodorant" option (sub-mode 10000) does not use ECHONET. It calls
`POST …/api/v1/appliances/{id}/appcontroldevice {"event_type":"deodorant"}` (`c.java:64-67`, `b.java:4216-4223`).

### 3.2 Legacy path, model year ≤ 17
`a.java:309-324` → `F3/a.java:24-50`. The order is `80`=`30`, `a0`=`41`, `a1`=`41` (ECHONET auto air-flow
direction), `cf`=`41`, `b0`=mode. For cool/heat, add either `b3` int, or (0.5 °C models) `fa` with N = 128,
field 27 = T×2, and field 42 = `01` (gentle) / `00` (normal) when `GENTLE` is set. Wind and fan cannot be changed on
these models (the wind tab only appears when year ≥ 18, `AirConControlActivity.java:1973-1990`).

### 3.3 Fan speed + louvers (wind tab), year ≥ 18
`a.java:951-965` → `F3/a.java:52-60`. **One command** carries all three settings:

1. `fa` frame (N per year) with **field 49 = vertical code** and **field 50 = horizontal code**. Both are always
   written, `FF` if nothing is selected.
2. `a0` = fan code (valueSingle)

| Fan `A0` (ECHONET standard EDT) | UI (`fragment_airconditioner_bottom_airdirection.xml`) |
|---|---|
| `41` | auto (自動) |
| `31` | quiet (静音) – level 1 |
| `33` | very weak (微風) – level 3 |
| `35` | weak (弱) – level 5 |
| `37` | strong (強) – level 7 |
| `38` | rapid (急速/最強) – level 8 |

The app never writes `32`/`34`/`36`. ECHONET allows `31`–`38` and the OSS libraries send them, but whether the unit
accepts them is **[unknown]**.

| Vertical 上下風向, FA byte 49 | meaning | Horizontal 左右風向, FA byte 50 | meaning |
|---|---|---|---|
| `00` | auto | `0A` | auto |
| `01` | obliquely upward (上向き) – pos 1 | `01` | straight / front (正面) |
| `02` | horizontal (水平) – pos 2 | `02` | left |
| `03` | obliquely downward 1 – pos 3 | `03` | right |
| `04` | obliquely downward 2 – pos 4 | `08` | enclose / inward (囲い込み) |
| `05` | down (下) – pos 5 | `07` | wide (ワイド) |
| `07` | swing (スイング) | `0F` | swing |
| `FF` | none / not supported | `FF` | none / not supported |

Mapping sources: `p129z3/a.java:43-76`, `296-356`, and icon mapping `AirConControlActivity.java:1112-1251`. The order
and labels come from the layout XML and resource names. `06` is unused, which matches `# FAN_6 = 6` in dvcrn/sharp-cocoro.

UI restrictions to replicate (`p129z3/a.java:192-252`):
* `VERT_CAP == "00"`: hide vertical. `"02"` (limited): in heat or auto, hide `05` (down) and treat a current `05` as
  `00`.
* `HORZ_CAP == "00"`: hide horizontal. `"02"` (limited): hide `08`, `07` and `0A`, and coerce those to `01`.
* `FAN_CAP == "00"`: hide fan. `"02"`: hide quiet (`31`) and coerce it to `41`.
* In dry mode (internal mode `44`), the fan cannot be changed.
* With an FA[42] sub-mode of 1, 2 or 3 active, the fan, vertical, and horizontal auto/enclose/wide/swing are all
  disabled.
* The tab is only usable when `F3/m.k()` is true (`F3/m.java:92-111`, `403-409`): year > 17, the unit is not off, the
  internal mode is one of `41`–`45`, and not (cool/heat with `HORZ_CAP=="00"` and sub-mode 1–3).

### 3.4 Power off
`a.java:1005-1014` → `F3/a.java:70-78`: `80` = `31`. On models with a built-in air purifier (`HAS_AIRCLEANER`), the
app also sends `fa` (N = 80) with **field 71 = `01`**. It probably means "stop the purifier too". **[inferred]**

### 3.5 Other writes
| purpose | properties | source |
|---|---|---|
| COCORO AIR (cloud AI "我が家流") on/off | `fa`, N per year, field 17 = `01`/`00`. On purifier models also field 64 = `80`/`00`, and fields 65, 66, 72 = `00` | `CocoroAirSettingActivity.java:323-347`, `586-595` |
| reset the dust-filter counter | `f9`, table `f740e`, N = 48, field 46 = `00` (2-byte field 46–47 → 0) | `F3/a.java:62-68`, `ConsumeAirConActivity.java:136` |

---

## 4. Status read (decode)

The app calls `control/deviceStatus` (or `deviceProperty?status=true`) and builds `map[EPC]`. Main decoder:
`a.java:683-896`, with display logic in `F3/m.java:277-401`.

| EPC | type | decode | source |
|---|---|---|---|
| `80` | single | `30` on, `31` off | `a.java:799-805` |
| **`F1`** | binary | **byte 1**: `30` on (started on the unit), `31` off, `41` on (started over the network; the app shows "*"). **byte 2**: internal mode: `41` auto, `42` cool, `43` heat, `44` dry, `45` Plasmacluster fan, `51`/`52` cleaning (おそうじ; patrol if FA[40] is `5D`/`5E`), `53` air-clean (部屋干し "room drying" if FA[40]=`57`), `54`/`55` monitoring auto (みはり/室温ウォッチ), `40` other. **This is the app's source of truth for mode.** | `a.java:782-794`, `F3/m.java:281-360`, `F3/f.java` |
| `B3` | range | set temperature in whole °C (decimal) for models without `HALF_DEG` | `F3/m.java:385` |
| **`FA`** | binary | 0.5 °C models: **set temperature = byte27 / 2**. Other fields: see the table below | `F3/m.java:378-383` |
| `A0` | single | fan code (table in §3.3) | `a.java:778-781` |
| `CF` | single | `41` = Plasmacluster on, `42` = off | `a.java:795-798`, `F3/d.java` |
| `BB` | range | room temperature, signed °C. Valid 0..40. `125` = above range (高温), `-127` = below range (低温), `126` or empty = unknown | `a.java:705-717`, `AirConControlActivity.java:1531-1546` |
| `BA` | range | humidity %. Only shown if the model has `HUMIDITY_SENSOR`. Valid 25..75. `0` = low (低湿), `100` = high (高湿), `253` = unmeasurable ("--") | `a.java:718-740`, `AirConControlActivity.java:1551-1600` |
| `88` | single | `41` = fault ("エラー停止中", error stop), `42` = normal | `a.java:806-822` |
| `86` | binary | fault detail: **byte 5** (hex offset 8..10). `1C` → "28-0" (filter/dust box), `3C` → "28-1", `15` → "21-0" (left/right guide); otherwise `"${b&31}-${b>>5}"` | `AirConControlActivity.java:2149-2173` |
| `F9` | binary | filter: bytes 44–45 = lifetime and bytes 46–47 = elapsed (BE uint16). Remaining % = (life − elapsed)·100 / (life·k) | `F3/j.java:89-100`, `ConsumeAirConActivity.java:75-124` |
| `F6` | binary | legacy (<2017) gentle flag at byte 1 (`01`). Bytes 14–15 = Plasmacluster ion-unit hours (BE uint16). Ion-unit life 17500 h | `F3/m.java:441-457`, `F3/i.java` |
| `FD` | binary | firmware: byte 1 = number of MCUs. Bytes 2–5, 6–9, 10–13 and 14–17 = versions `a.b.c` (byte, byte, uint16) | `F3/l.java` |
| `F2`/`F3` | binary | 見張り (room-temperature watch) state, used only for an icon (`a.java:1168-1238`). **[inferred]** | |

**FA status bytes** (1-based; the hex offset is `(k-1)*2`). Sources: `F3/k.java:33-173`, `F3/m.java:411-439`,
`a.java:753-769`.

| byte | meaning |
|---|---|
| 17 | COCORO AIR / 我が家流 app setting (`01` on) |
| 18 | 我が家流 temporarily released (`01`). The app treats "17=01 and 18=00" as COCORO AIR active |
| 19 | speed (スピード) mode, `01` on – read-only in the app |
| 24 | patrol: `00` off, `01` internal patrol, `02` room patrol, `FF` error |
| **27** | **set temperature × 2** |
| 40 | detailed AIoT mode: `41` auto, `42` cool, `43` heat, `44` dry, `57` room drying, `5D`/`5E` patrol |
| **42** | **sub-mode: `00` normal, `01` gentle (やさしさ), `02` pet-dog, `03` pet-cat** |
| 43 | おやすみ (sleep) set on the unit |
| 44 | おやすみ via IoT; `02` = "おやすみAI" (sleep AI) running |
| 45 / 46 | お出かけ (away / auto-off) on the unit / via IoT. Either `01` while the unit is off means "オートオフ中" (auto-off) |
| 48 | non-zero enables an icon on models with `FLAG_80` **[unknown meaning]** |
| **49 / 50** | **current vertical / horizontal louver** (codes in §3.3) |
| 55 | `01` = defrosting (霜取り) |
| 64 | bits 0x80 and 0x40 = purifier auto sub-mode active (purifier models) |
| 67/68/69 | air-quality level indicators (purifier models; `D3/b.java:35-72`) |
| 72 | purifier sub-mode: 1 pollen, 2 PM2.5, 4 rainy season |

**Set-temperature sanity check** used before display (`F3/m.java:371-401`): accept T if
`(T ≥ (F1.byte2=="43" ? HEAT_MIN : COOL_MIN) || T == 15.0) && T ≤ MAX`. 15.0 °C in heat is the "keeping heat"
(暖房15℃) mode. Otherwise show "".

**Displayed mode label** (`F3/m.java:281-360`; strings from `resources/res/values/strings.xml`):
* F1.byte1=`31` (off): "auto-off" variants if FA[45] or FA[46] is `01`, otherwise 運転停止 (stopped).
* `41` auto: defrosting variant if FA[55]=`01`.
* `42` cool: gentle → "やさしさ冷房" (≤2020 models) or "冷房T℃(やさしさ)". Pet → "冷房T℃(ペットモード)". Otherwise
  "冷房T℃".
* `43` heat: similar, plus defrost and 15 °C variants.
* `44` dry: 除湿.
* `45`/`53`: Plasmacluster or 空気清浄 variants.
* `51`/`52`: cleaning or patrol.
* `54`/`55`: monitoring.
* `40`: その他 (other).
* "おやすみAI" overrides all of these when FA[44]=`02`.

---

## 5. Timers (on / off / pre-run / sleep) – cloud REST, not ECHONET

* `POST https://cboard.cloudlabs.sharp.co.jp/cocoroapp/api/v1/appliances/{applianceId}/timers` (create),
  `PUT …/timers/{timer_id}` (update), `DELETE …/timers/{timer_id}`, `GET …/timers` (list; includes
  `next_timer_id`). Headers: `X-Client-Id: CocoroAppAPI/c65031fa6101217db12231931fe01e6c`,
  `X-Term-App-Id: <terminalAppId>` (`b.java:4486-4524`, `4775-4810`, `4883-4909`, `5509-5536`). The base URL is
  `F.e()` + `api/v1/` (`p094s3/F.java:27-29`, `b.java:4069`, `4208-4210`). `applianceId` is a cloud ID that differs
  from the ECHONET `deviceId` (`e.d(ctx, deviceId)`). See `protocol-cloud.md`.
* Body (`K3/a.java:197-270`):
```json
{"enabled":true,"title":"timer","timezone":"Asia/Tokyo",
 "time":"HH:mm","advance":false,
 "repetition":{"repeatable":false,"sun":false,"mon":false,"tue":false,"wed":false,"thu":false,"fri":false,"sat":false},
 "control":{"type":49,"mode":66,"temperature":56,"air_flow":65,"wind_vertical":0,"wind_horizontal":1}}
```
  * `control.type`: `48` (0x30) = ON timer, `49` (0x31) = OFF timer.
  * `mode`: 65–69 as in §3.
  * `temperature`: T×2 (int). Always `255` unless the mode is cool or heat.
  * `air_flow`, `wind_vertical`, `wind_horizontal`: the §3.3 hex codes **as decimal ints** (fan auto `41` → `65`,
    vertical auto `00` → `0`, horizontal front `01` → `1`; `255` = none). Defaults: `TimerSettingActivity.java:976-1003`.
  * Timer kinds (`TimerSettingActivity.java:1060-1129`):
    * ON: type 48, `advance:false`.
    * Pre-run (先行運転, reach the temperature by `time`): type 48, `advance:true`.
    * OFF: type 49, `advance:false`.
    * Sleep: `"type":"sleep"` with `"time"` (start, default 20:00) and `"end_time"` (default 06:00),
      `advance:true`, control type 48. Only offered when the spec year byte ≥ 0x20 (`TimerSettingActivity.java:971-972`).
  * `time` is wall-clock **Asia/Tokyo** (hard-coded timezone). The app's default is now plus 10–20 minutes, rounded
    to 10 minutes (`TimerSettingActivity.java:978-990`).
  * The response or list items add `timer_id`. Parse: `K3/a.java:87-162`.
* **Relative timers:** none. "Off in 2 h" = compute `now(Asia/Tokyo) + 2h` → `HH:mm` and POST an OFF timer with
  `repeatable:false`. ECHONET `0x90`–`0x95` are never used. Whether the cloud would relay them is **[unknown]**.

---

## 6. Capability detection

1. The model name comes from the box/device list field `model`, or from ECHONET `0x8C` in `echonetAttr`
   (`ApplianceListActivity.java:29342`, `C4694c.java:288-318`). A few `AY-D…`/`AC-…4FD2` patterns become `"1"`
   (generic) (`p094s3/C.java:9`, `74-94`).
2. Download `…/static/air/property/spec_versions.csv`, which lists `eoj, version, file` (currently `0130,202110010,spec_0130.csv`).
   Then download `spec_0130.csv`. Rows are `eoj,yearCode,model,specHex(64 chars),option` (`g.java:202-223`,
   `248-305`). They are stored per model (`e.java:124-140`, `285-295`). Both CSVs were fetched on 2026-10-24: 1070
   aircon rows covering years 14–22. 
   Example row: `0130,22,AY-P28DM,0000288822004206110002000100000000000000000000000000000000220001,-1`.
3. If the model is missing, the spec is all zeros. The app then falls back to the year from vendor EPC **`0xF0` byte 5**
   in the box's `echonetProperty` (an ECHONET frame in hex) (`C4694c.java:149-166`, `249-285`). The spec string has
   the same layout as `0xF0`: the debug decoder `F3/e.java:35-112` logs it as "0xF0:N byte目". **[inferred]**
   Reading the device's own `0xF0` is therefore a valid alternative.

Spec bytes (0-based index into the 32-byte spec; helpers in `F3/e.java`):

| byte | name | meaning |
|---|---|---|
| 2 | capacity | e.g. `28` = 2.8 kW **[inferred]** |
| 4 | **year** | e.g. `22`. Read as **decimal text** for "year" (`e.e`, `C4694c.b()`). Some checks parse it as hex (`e.j`: `0x17` = 2017, `0x18`, `0x20`) |
| 5 | WATCH | `01` → monitoring variant (Edion "室温ウォッチ") |
| 6 | – | `41` + year < 17 → a legacy notification flag (`e.d`) |
| 7 | flags | `0x80` HUMIDITY_SENSOR (show `BA`) · `0x20` HAS_AIRCLEANER · `0x04` WAGAYA (我が家流 support) · others unknown |
| 8 | flags | `0x01` AIoT · `0x02` COCORO AIR (regional) · `0x04` COCORO AIR (learning) · `0x10` **HALF_DEG** (0.5 °C step; use FA[27] instead of B3) · `0x20` **GENTLE** (やさしさ sub-mode) · `0x40` SPEED · `0x80` FLAG_80 (gates an icon from FA[48] and a notification) |
| 10 | **VERT_CAP** | vertical louver: `00` none, `01` full, `02` limited |
| 11 | **HORZ_CAP** | horizontal louver: `00` none, `01` full, `02` limited |
| 12 | **FAN_CAP** | fan: `00` none, `01` full, `02` no quiet |
| 13 | TEMP_RANGE | MAX = `02` ? 30 : 32 · COOL_MIN = `02` ? 14 : 18 · HEAT_MIN = `01` ? 15 : 18 (`e.f/h/i`). `02` never appears in the CSV |
| 29 | year again | hex, ≥ 0x18 enables some settings text |
| 30 | bit0 | an extra notification capability |

The COCORO AIR menu (`e.p`) is enabled by byte8&1 when year > 0x17. Otherwise it needs byte8&1 and byte8&6.

Derived rules:
* step = HALF_DEG ? 0.5 : 1.0
* cool T ∈ [COOL_MIN, MAX], heat T ∈ [HEAT_MIN, 32] (`p129z3/d.java:241-293`, `a.java:846-849`)
* wind tab only when year ≥ 18
* gentle sub-mode only if GENTLE
* pet sub-modes depend on pets registered in the user's cloud profile (UI only); the bytes are always valid in cool

---

## 7. Worked examples (model year ≥ 19, HALF_DEG set, year ≥ 21 so 42 is written, HORZ_CAP ≠ 00)

The app sends **two separate deviceControl requests**, one per screen action.

**A. "Power on, cool, 24.0 °C" (mode screen, normal sub-mode)**, so `status` =
```json
[{"statusCode":"80","valueType":"valueSingle","valueSingle":{"code":"30"}},
 {"statusCode":"cf","valueType":"valueSingle","valueSingle":{"code":"41"}},
 {"statusCode":"b0","valueType":"valueSingle","valueSingle":{"code":"42"}},
 {"statusCode":"fa","valueType":"valueBinary","valueBinary":{"code":"9000002000400000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"}}]
```
FA = checksum `90` (=0x20+0x40+0x30), `00`, bitmap `00200040…` (bit 11 = field 27, bit 26 = field 42), byte 27 = `30` (48 = 24.0×2), byte 42 = `00`.
For a model without HALF_DEG, replace the `fa` entry with `{"statusCode":"b3","valueType":"valueRange","valueRange":{"type":"int","code":"24"}}`.
For a 2018 model, use N = 128: the same prefix padded to 256 hex chars, with the same checksum.

**B. "Fan auto, vertical louver position 3" (wind screen; horizontal kept at front `01`)**, so `status` =
```json
[{"statusCode":"fa","valueType":"valueBinary","valueBinary":{"code":"c40000000000c000000000000000000000000000000000000000000000000000000000000000000000000000000000000301000000000000000000000000000000000000000000000000000000000000"}},
 {"statusCode":"a0","valueType":"valueSingle","valueSingle":{"code":"41"}}]
```
"Position 3" is read as vertical code `03` (斜め下1). The app always sends both 49 and 50: use the current
horizontal value from the status FA[50] (or `FF` when the model has none).

Combining A and B into one request with a merged FA (fields 27, 42, 49 and 50 →
`540000200040c000…30…0301…`) is **[unverified]**: the app never does it.

**C. "Off-timer in 2 hours"** (now = 14:07 JST): `POST …/appliances/{applianceId}/timers`
```json
{"enabled":true,"title":"timer","timezone":"Asia/Tokyo","time":"16:07","advance":false,
 "repetition":{"repeatable":false,"sun":false,"mon":false,"tue":false,"wed":false,"thu":false,"fri":false,"sat":false},
 "control":{"type":49,"mode":66,"temperature":48,"air_flow":65,"wind_vertical":0,"wind_horizontal":1}}
```
`control` mode, temperature and wind are still sent for OFF timers (the app fills defaults). Whether the cloud
accepts minutes that are not a multiple of 10 is **[unknown]**: the app's default is rounded, and the picker
granularity was not checked.

---

## 8. Cross-check with open-source projects

* **dvcrn/cocoro-sdk** (TypeScript), `src/state.ts` and `src/devices/aircon/*`. It treats FA as a 160-char "State8".
  Temperature at chars 52–53 (byte 27), `s[6]='2'` (bitmap bit 11), and chars 0–1 = (T+16)×2 (the checksum) are all
  explained by §2. EPC set: 80, B0, B3, A0, CF, BB, FA. Matches. https://github.com/dvcrn/cocoro-sdk
* **dvcrn/sharp-cocoro** (Python) + **dvcrn/ha-sharp-cocoro** (Home Assistant climate). The fan-direction template
  `c2…c0…0101…` with checksum `0xC1+v` matches the §3.3 frame (fields 49 + 50, horizontal = 01). The swing-mode list
  (auto, 1–5, 7) matches the vertical codes. https://github.com/dvcrn/sharp-cocoro ·
  https://github.com/dvcrn/ha-sharp-cocoro
* rcmdnk/cocoro, cocorojs (npm), and rsokolowski/aiosharp-cocoro-air are **air-purifier** libraries (no aircon
  encoding). The EU API is different.

---

## 9. Open questions

1. 2022+ models (COCORO HOME app): this app rejects them. The protocol may still match: the 2022 CSV rows use the same
   spec layout, and dvcrn reports success with 160-char frames. Verify on the user's unit.
2. Whether `A0` `32`/`34`/`36` are accepted (the app never sends them).
3. The meaning of FA field 71 = `01` on power-off (purifier models), and of FA[48].
4. Whether one request may merge mode, temperature and wind into a single FA, and whether a partial FA (only some
   bitmap bits) leaves the other settings unchanged. The bitmap design and the OSS behaviour both suggest yes.
5. No ECHONET timers (`0x90`–`0x95`), outdoor temperature (`0xBE`) or power (`0x84`/`0x85`) in the app. Energy data
   comes from a separate graph API (out of scope). Whether the cloud relays those EPCs is unknown.
6. Spec byte 7/8 bits not listed, and bytes 9, 14–28.

---

## 10. cboard registration and timers (implementation guide)

All refs are under `jp/co/sharp/hms/smartlink/` unless another package is named. `b.java` is the cboard client.
Tags: **[confirmed]** = read in code, **[inferred]** = deduced from how the code behaves, **[unknown]** = needs a live test.

### 10.1 Transport (every cboard call)

* Base: `https://cboard.cloudlabs.sharp.co.jp/cocoroapp/api/v1/` (`p094s3/F.java:27-29` + `b.java:4208-4210`, `b.l()`).
* Headers, the same on every call: `X-Client-Id: CocoroAppAPI/c65031fa6101217db12231931fe01e6c` and
  `X-Term-App-Id: <terminalAppId>`. That is the raw `https://db.cloudlabs.sharp.co.jp/clpf/key/…` string, not
  encoded. Calls with a body also send `Content-Type: application/json; charset=utf-8`. Most calls send
  `Accept: application/json`. **[confirmed]**
* **No other auth.** cboard gets no `appSecret`, no JSESSIONID (that cookie belongs to the HMS host), no
  Authorization header, and no custom User-Agent. `b.java` never sets `User-Agent`, `Cookie` or `Authorization`
  (grep count is 0), so Android sends the default `Dalvik/…` UA. The process-wide `CookieManager` would echo back any
  cookie cboard sets, but the code never relies on one. The server must resolve the user from `X-Term-App-Id`
  alone, so the terminalAppId has to be logged in and bound on HMS first (`protocol-cloud.md` §3). **[confirmed]**
  (The server-side lookup is **[inferred]**.)
* Each call checks for exactly one success status. Any other status is an error; `401` maps to `E0101002`
  (`p094s3/AbstractC4704m.java:89,104`).

### 10.2 Where `applianceId` comes from

**There is no "GET appliances" list endpoint.** Every cboard URL is in `b.java:3970-5635`. The only source of
`appliance_id` is the **201 response of `POST terminals/{terminal_id}/appliances`**. **[confirmed]**

`e.H(ctx, deviceId, applianceId)` (`e.java:60-64`, SharedPreferences key `"appliance_id"+deviceId`) has exactly three
callers. All three do `response.appliances[0].appliance_id` → `e.H(ctx, box.deviceId, id)`:

| Caller | When |
|---|---|
| `d.java:45-61` (via `d.c()` at `d.java:70-73`, started from `activity/ApplianceAddActivity.java:493-499`) | right after a new appliance is added |
| `activity/PairingConfirmActivity.java:526-543`, request at `:999` | right after Wi-Fi adapter pairing |
| `activity/ApplianceListActivity.java:28415-28457` (`s0`), request at `:27598-27609` and `:27795-27804` | **lazily on the device list, whenever `terminal_id != 0` and the cached `e.d(deviceId) == 0`**, for example after a reinstall or on a second phone |

Mapping:
* The request carries **only `box_id`**, the HMS `boxInfo.box[].boxId` (`C4694c.f33637S`, set at
  `ApplianceListActivity.java:29284` from `D3/f.java:43`).
* The app keys the result locally by `box[].echonetData[0].deviceId` (`C4694c.f33624F`,
  `ApplianceListActivity.java:29302`).
* No echonetNode or echonetObject is involved. The mapping is **boxId → applianceId**, one per box. The
  deviceId is only the local cache key. **[confirmed]**
* The response array is read at index 0 only. Other fields in it are **[unknown]**.

### 10.3 Prerequisite registration, in order

The app's login orchestration is in `f.java`. After HMS `setting/login` (`f.n()` at `:285`), it calls
`setting/userInfo?terminalAppId=…` (`f.k()` at `:261`, `D3/q.java:2300-2310`), which gives `userId`, `mailAddr`
and so on (`D3/q.java:1996-2001`). Then `f.j()` (`:221-258`) → `f.w()` (`:397-404`):
* If this local account has no stored pushId yet (a new account on this device), it runs the cboard path
  `x()` → `v()`.
* Otherwise it only does HMS `setting/terminal` and skips cboard.

So the cboard `users` and `terminals` calls run **once per (account, install)**.

**Step 1: `POST users`** (`b.java:4526-4557`, runner `k` at `:1944-2080`; called from `f.x()` at `:406-408`)
```
POST https://cboard.cloudlabs.sharp.co.jp/cocoroapp/api/v1/users
X-Client-Id: CocoroAppAPI/c65031fa6101217db12231931fe01e6c
X-Term-App-Id: https://db.cloudlabs.sharp.co.jp/clpf/key/<hex>
(no body, no Content-Type)
→ 201 + JSON body (content ignored by the app; f.java:123-136)
```
Only 201 counts as success. Anything else aborts login with an error dialog. The same Sharp account can log in on a
second phone (a new terminalAppId, same user), and that path also calls `POST users`, so the server must return 201
for a user that already exists. **[inferred]**

**Step 2: `POST terminals`** (`b.java:3966-4063`, runner `z` at `:3838-3935`; called from `f.v()` at
`:393-395` through `b.G()` at `:4477-4484`, which first fetches the FCM token)
```
POST …/api/v1/terminals
Content-Type: application/json; charset=utf-8
Accept: application/json
X-Client-Id: …   X-Term-App-Id: <terminalAppId>

{"notify_name":"gcm",
 "applications":[{"name":"spremote","version":"1.0",
                  "devicetoken":"<FCM token>",            ← only added if non-empty; omit it
                  "notification":[{"name":"appliance","value":1},{"name":"system","value":1}]}]}
→ 201 {"terminal_id": <int>, …}
```
The app stores `terminal_id` under `"terminal_id"+userId` (`f.l()` at `f.java:266-273`, `e.U()` at `e.java:153-157`,
read by `e.q()` at `e.java:301-303`). The HMS `userId` is **only a local cache key** and is never sent to cboard.
`PUT terminals/{terminal_id}` with the same body but `newdevicetoken` updates the push token
(`b.java:4073-4170`, 200 OK). A JS client does not need it.
* Whether a second `POST terminals` with the same terminalAppId returns the same `terminal_id` or a new one is
  **[unknown]**. Persist `terminal_id`.
* Without a `terminal_id` the app never registers appliances. `ApplianceListActivity.java:27798` bails out when
  `iQ == 0`, so timers are unavailable.

**Step 3: `POST terminals/{terminal_id}/appliances`** (`b.java:4297-4345`, runner `B` at `:173-316`)
```
POST …/api/v1/terminals/<terminal_id>/appliances
Content-Type: application/json; charset=utf-8
Accept: application/json
X-Client-Id: …   X-Term-App-Id: <terminalAppId>

{"appliances":[{"box_id":"https://db.cloudlabs.sharp.co.jp/clpf/key/<box hex>"}]}
→ 201 {"appliances":[{"appliance_id": <int>, …}]}
```
Only 201 counts as success. Whether cboard checks that the box is paired to this terminalAppId on HMS is
**[unknown]**. Boxes from `setting/boxInfo` for the logged-in user should pass.

Optional check: `GET terminals/{terminal_id}/appliances/{appliance_id}[?advertising=1]` (`b.java:4982-5024`,
200). It returns notification settings (`notification_list`, `watch_list`, `advertising`;
`activity/NotificationSettingActivity.java:513`). It can confirm that a cached id is still valid. The app itself
never uses it for that.

### 10.4 Is it safe to call on every launch?

* `POST users` / `POST terminals`: the app does **not** repeat them per launch, only once per account+install. Do the
  same: call them once after binding a new terminalAppId, then persist `terminal_id`.
* `POST terminals/{tid}/appliances`: there is no GET to look it up, and the app re-POSTs whenever its local cache is
  empty (reinstall, second phone; `ApplianceListActivity.java:27798-27803`). `appliances/{id}/timers` is not scoped
  to a terminal, and timers set on one phone are expected to show on the others. So the server should return the
  **existing** `appliance_id` for an already-registered box. **[inferred]** (not proven). Recommended client
  logic: cache `applianceId` per `boxId` (or deviceId) and POST only when it is missing. If a cached id later fails
  (`GET …/timers` ≠ 200), clear it and POST again once.

### 10.5 Timers API

All four calls go to `appliances/{appliance_id}/timers`. `appliance_id` is a decimal int in the path.

| Op | Request | Success | Ref |
|---|---|---|---|
| List | `GET …/appliances/{aid}/timers` (Accept + 2 headers) | **200** JSON | `b.java:5507-5539`, runner `E` `:556-692` |
| Create | `POST …/appliances/{aid}/timers` + body | **201** JSON (ignored by the app) | `b.java:4486-4524`, runner `D` `:410-555` |
| Update | `PUT …/appliances/{aid}/timers/{timer_id}` + full body | **204** | `b.java:4775-4813`, runner `C4665a` `:731-826` |
| Delete | `DELETE …/appliances/{aid}/timers/{timer_id}` (2 headers, no Accept, no body) | **204** | `b.java:4881-4912`, runner `C0172b` `:827-911` |

Errors: **409 on POST or PUT** means the timer overlaps another timer ("他のタイマーと重複しています…",
`confirm_overlap_timer`; `TimerSettingActivity.java:691-720`). `401` → `E0101002`.

**List response** (consumers: `AirConControlActivity.java:1752-1774`, `p129z3/j.java:388-405`, item parser
`K3/a.java:87-162`):
```json
{"next_timer_id": 12,
 "timers":[{"timer_id":12,"enabled":true,"type":null,"advance":false,
            "time":"07:30","end_time":null,
            "repetition":{"repeatable":true,"sun":false,"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":false},
            "control":{"type":48,"mode":66,"temperature":52,"air_flow":65,"wind_vertical":0,"wind_horizontal":1}}]}
```
* The parser **requires** `timer_id`, `enabled`, `time`, `repetition.*` (all 8 keys), `control.type`, `control.mode`,
  `control.air_flow`, `control.wind_vertical` and `control.wind_horizontal`.
* It treats `advance`, `type` and `end_time` as optional or nullable. `control.temperature` may be JSON `null`;
  `255` means "none".
* Other fields that may come back (`title`, `timezone`) are not read.

**Create/update body** (`K3/a.java:197-270`). See §5 for field semantics. Exact shapes:
```json
// ON at 07:30 weekdays, cool 26 °C
{"enabled":true,"title":"timer","timezone":"Asia/Tokyo","time":"07:30","advance":false,
 "repetition":{"repeatable":true,"sun":false,"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":false},
 "control":{"type":48,"mode":66,"temperature":52,"air_flow":65,"wind_vertical":0,"wind_horizontal":1}}

// OFF once at 23:00
{"enabled":true,"title":"timer","timezone":"Asia/Tokyo","time":"23:00","advance":false,
 "repetition":{"repeatable":false,"sun":false,"mon":false,"tue":false,"wed":false,"thu":false,"fri":false,"sat":false},
 "control":{"type":49,"mode":66,"temperature":255,"air_flow":65,"wind_vertical":0,"wind_horizontal":1}}

// Sleep 22:00 → 06:00 (heat 20 °C)
{"enabled":true,"title":"timer","timezone":"Asia/Tokyo","type":"sleep","time":"22:00","end_time":"06:00","advance":true,
 "repetition":{"repeatable":false,"sun":false,"mon":false,"tue":false,"wed":false,"thu":false,"fri":false,"sat":false},
 "control":{"type":48,"mode":67,"temperature":40,"air_flow":65,"wind_vertical":0,"wind_horizontal":1}}
```
* **Enable/disable** = `PUT` the **whole** object with `enabled` flipped (`p129z3/j.java:208-232`). There is no
  PATCH.
* `mode` is **omitted** if the label is unknown (`K3/a.java:247-257`). Always send one of 65–69.
* `temperature` = `int(T*2)` for cool (66) or heat (67), otherwise `255` (`K3/a.java:258-262`).
* `repeatable:true` is only allowed with at least one weekday set (`TimerSettingActivity.java:262-276`). A one-shot
  timer has all days `false`. Whether a fired one-shot timer is deleted or set to `enabled:false` on the server is
  **[unknown]**.
* Pre-run (`advance:true`, type 48): before saving, the app forces `air_flow=65` (0x41),
  `wind_vertical=0`, and `wind_horizontal=255/10/1`, depending on the horizontal-louver spec byte
  (`TimerSettingActivity.java:354-365`). Pre-run and sleep allow only cool or heat (`onlyCoolHeat`,
  `TimerSettingActivity.java:288-292`).
* Temperature limits: max 30 or 32, cool min 14 or 18, heat min 15 or 18, set by spec byte 13
  (`F3/e.java:125-139`).

**Limits** **[confirmed, client-side]**
* At most **10 timers** per appliance. The add button refuses at `size() >= 10` (`p129z3/j.java:106-108`,
  `time_alert_limit`). Server-side enforcement is **[unknown]**.
* **10-minute granularity**: the picker shows only minutes 00/10/…/50 (`TimerSettingActivity.java:469-546`). The
  default time is now rounded to the 10-minute mark, plus 10 or 20 minutes (`:978-990`). Whether the server accepts
  `07:35` is **[unknown]**. Send multiples of 10 to be safe.
* Sleep window: `end − start` (wrapping past midnight) must be **3 h to 23 h 50 m** (10800–85800 s,
  `TimerSettingActivity.java:51-54, 655-662`). Defaults 20:00 → 06:00 (`K3/a.java` constructor). The sleep option is
  hidden when spec byte 4 < 0x20 (`TimerSettingActivity.java:971-973`).
* `time` is always Tokyo wall-clock (`timezone` is hard-coded to `Asia/Tokyo`).

**"Next timer" display** (`AirConControlActivity.java:1752-1774`, UI `:224-261`; refreshed by `n2()` at `:1879-1883`
on screen load and after returning from the timer screen):
* If `next_timer_id != 0`, the app finds that timer in `timers[]` and shows its `time` (`HH:mm`) with an ON icon
  when `control.type == 48`, OFF otherwise.
* Shown only when model year ≥ 18.
* The app **computes no remaining time and no date**. A client that wants "in 2 h 10 m" must work out the next
  occurrence from `time`, `repetition` and `now` in Asia/Tokyo itself. Whether `next_timer_id` skips disabled
  timers is **[inferred: yes]**.

### 10.6 Minimal JS sequence

```
launch:
  HMS login with stored terminalAppId (protocol-cloud.md §3)  → JSESSIONID
  GET  setting/boxInfo?mode=other                             → boxId, deviceId per aircon
  if no stored terminal_id:                       (once per terminalAppId)
     POST cboard users                            (expect 201)
     POST cboard terminals {notify_name,applications}  → store terminal_id
  for each aircon box without cached applianceId:
     POST cboard terminals/{terminal_id}/appliances {"appliances":[{"box_id":boxId}]}
          → applianceId = appliances[0].appliance_id; cache by boxId
timers:
  list   GET    appliances/{aid}/timers           → {next_timer_id, timers[]}
  create POST   appliances/{aid}/timers  body     → 201 (409 = overlap)
  edit   PUT    appliances/{aid}/timers/{tid} full body → 204
  delete DELETE appliances/{aid}/timers/{tid}     → 204
```
"Off in 2 h" = OFF timer (type 49), `repeatable:false`, `time = (nowTokyo + 2h)`, rounded **up** to 10 minutes.
