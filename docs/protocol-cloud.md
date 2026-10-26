# Sharp COCORO AIR cloud protocol: auth and HTTP transport

Source of truth: `jp.co.sharp.hms.smartlink` 2.2.18, decompiled with jadx at
`decompiled/jadx/sources/`. File:line references below are relative to that folder.
Cross-checked against open-source clients (see section 9).

Scope: login, session, device discovery, status read, control envelope and result
polling. What the property bytes mean (EPC/EDT meaning, cool/heat/temperature, etc.) is
covered in a separate doc.

Legend: **[confirmed]** read in the APK and seen in third-party code that works;
**[APK]** read in the APK only; **[uncertain]** inferred, needs a live test.

---

## 0. TL;DR for the JS client

1. One-time sign-in: an Auth0 (COCORO MEMBERS) authorization-code + PKCE flow in an
   `ASWebAuthenticationSession` (`expo-web-browser` `openAuthSessionAsync`). You get an
   auth `code` back. **The app never redeems this code itself.** It sends
   `"auth:<code>:<code_verifier>:<client_id>"` to the HMS server, and the server redeems it.
2. `GET setting/terminalAppId/` gets a `terminalAppId`. Then `POST setting/login/` with
   `{tempAccToken, terminalAppId, redirectUrl}` links that terminalAppId to the user and
   sets a `JSESSIONID` cookie.
3. After that, every later session is just
   `POST setting/login/?appSecret=…` with `{"terminalAppId": "<stored id>"}`. No
   browser and no password. Store the `terminalAppId` in the iOS keychain: it is a
   long-lived bearer credential.
4. All `pfApi` calls carry the hardcoded `appSecret` as a query param and the
   `JSESSIONID` cookie. On HTTP 401, log in again with the terminalAppId and retry once.
5. No mTLS and no certificate pinning on `hms.cloudlabs.sharp.co.jp`, so plain `fetch` works.

---

## 1. Constants

| Name | Value | Ref |
|---|---|---|
| HMS base | `https://hms.cloudlabs.sharp.co.jp/` | `p094s3/F.java:37`, `p024e3/c.java:9` |
| pfApi prefix | `<HMS base>hems/pfApi/ta/` | `D3/k.java:58-60` |
| Dev base (ignore) | `https://dev-hms.cloudlabs.sharp.co.jp/` (static default, overwritten at startup) | `D3/k.java:17`, `D3/k.java:62-65`, `AppModel.java:136-137` |
| appSecret | `pngtfljRoYsJE9NW7opn1t2cXA5MtZDKbwon368hs80%3D` (**already URL-encoded**; raw value ends in `=`). Hardcoded, global, the same for every user. It is stored XOR-obfuscated and decoded by `AppModel.g()`. | `AppModel.java:155`, decoder `AppModel.java:251-273` |
| User-Agent | `"smartlink_v200a " + System.getProperty("http.agent")` (for example `smartlink_v200a Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/…)`). The iOS app sends `smartlink_v200i Mozilla/5.0 (iPhone; …)`. | `p094s3/F.java:11-13`, `D3/k.java:62-65` |
| Auth0 issuer | `https://auth.cocoromembers.jp.sharp` | `p084q3/c.java:12` |
| OAuth client_id | `lYCfqtg8PF4wrVUF0IosOME9UiObmY4F` | `p084q3/c.java:7` |
| OAuth audience | `https://api.cocoromembers.jp.sharp/` | `cocoroid/b.java:428,453` |
| Redirect URIs | `cocoroair://cm-login` (interactive), `cocoroair://hms-login` (silent, for HMS), `cocoroair://hms-logout` | `cocoroid/b.java:428,453`; scheme `res/values/strings.xml:346`; manifest `AndroidManifest.xml:481-506` |
| appName (terminal registration) | `"spremote_a:1:" + versionName`, so `spremote_a:1:2.2.18`. The iOS app uses `spremote_i:1:<ver>`. | `D3/q.java:2608` |
| cboard API (optional) | `https://cboard.cloudlabs.sharp.co.jp/cocoroapp/api/v1/` with headers `X-Client-Id: CocoroAppAPI/c65031fa6101217db12231931fe01e6c`, `X-Term-App-Id: <terminalAppId>` | `p094s3/F.java:27`, `smartlink/b.java:4208-4210, 4506-4507` |

Identifier formats, taken from real dumps in dvcrn/cocoro-sdk:
- `terminalAppId` and `boxId` are both URL-shaped opaque strings:
  `https://db.cloudlabs.sharp.co.jp/clpf/key/<hex key>`.
- `echonetNode` looks like a MAC address (`28-xx-xx-xx-6f-e1`).
  `echonetObject` is a 6-hex ECHONET EOJ (class group, class, instance). For a home
  air conditioner it should be `013001` **[uncertain: the dump redacts it]**.

---

## 2. Transport rules (all pfApi calls)

Every request in `D3/q.java`, `D3/m.java` and `D3/n.java` is built the same way:

- `HttpURLConnection`, `setInstanceFollowRedirects(false)`, connect and read timeouts
  30 s (for example `D3/q.java:2082-2084`, `D3/m.java:1187-1191`).
- Headers:
  - `User-Agent: smartlink_v200a …` (always).
  - `Accept: application/json` (most calls).
  - `Content-Type: application/json; charset=utf-8` (calls with a body).
  - **No** Authorization header. No custom auth headers.
- Query string: `appSecret=<pre-encoded secret>` on every call. `boxId` is appended
  **raw** (not URL-encoded, so `boxId=https://db.cloudlabs.sharp.co.jp/clpf/key/…`),
  for example `D3/q.java:2071`, `D3/m.java:1177`. `:` and `/` are legal in a query, so
  sending the raw value is safe. Do **not** double-encode the appSecret's `%3D`.
- **Session = cookies.** At app start the app installs a process-wide
  `java.net.CookieManager` with `ACCEPT_ALL` (`AppModel.java:146-149`). The login
  response sets the `JSESSIONID` cookie, and every later call sends it. (The cookie
  name is confirmed by rcmdnk/cocoro, which checks `'JSESSIONID' in response.cookies`.)
  The server may also set load-balancer cookies such as `route=…`. Send back whatever
  it sets.
- Body JSON: Android `JSONObject.toString()` escapes `/` as `\/`, so terminalAppIds go
  over the wire as `https:\/\/db.cloudlabs…`. That is the same JSON value. rcmdnk
  reproduces the escaping, and dvcrn does not and still works, so it does not matter.

### Error model

- HTTP status is the main signal. The app's error tokens are in
  `p094s3/AbstractC4704m.java`:
  - `400`: login: read the body's `errorCode`. `E0101006` means the account is locked
    (`D3/q.java:1092-1105`, string `error_account_lock`).
  - `401`: session invalid or expired (`E0101002`). Also detected as an IOException whose
    message contains `"authentication challenge"` (`AbstractC4704m.java:91`,
    `D3/q.java:79-85`).
  - `404` on boxInfo maps to `007`. `409` on tempBoxInfo is treated as success.
  - `413` is defined but unused here.
- Error bodies are JSON with `errorCode` (`D3/q.java:2034-2036`):
  `{"errorCode":"E0101006", …}`.
- Control-level error codes appear in `controlList[].errorCode` and
  `resultList[].errorCode`, not in the HTTP status:
  - `E1001001`: device not found or offline (`error_disconnect_device`). The app retries
    the control after 10 s, up to 2 times (`smartlink/a.java:375-387`).
  - `E1001002`: device communication timeout (`error_timeout`).
  - `E1004001`: communication error (`error_timeout`).
  - `E1004002`: device busy or being operated by someone else (`error_wait`).
  - Mapping: `activity/e.java:439-468`.
- **Re-login on 401** (`D3/o.java:564-582`). Every API call is wrapped. On the first
  401 from any endpoint other than `setting/login/`, the app calls
  `POST setting/login/` with the stored terminalAppId (`D3/o.java:556-562`) and then
  replays the original request once. A second 401, or a failed re-login, surfaces as
  `018` ("please log in again", `error_relogin`). Session lifetime is not documented.
  Treat it as "until a 401". **[uncertain on the duration]**

---

## 3. Login flow end to end

Orchestration: `jp/co/sharp/hms/smartlink/f.java` (`q()` at :414),
`activity/UserPolicyActivity.java:180-192, 279-281, 304`, and the
`cocoromembers/cocoroid/*` library.

### 3.1 Step A: COCORO MEMBERS interactive sign-in (Auth0, PKCE)

`cocoroid/b.java:417-441` (`doOidcAuth`). The app opens Chrome Custom Tabs to:

```
GET https://auth.cocoromembers.jp.sharp/authorize
  ?response_type=code
  &client_id=lYCfqtg8PF4wrVUF0IosOME9UiObmY4F
  &redirect_uri=cocoroair://cm-login
  &scope=openid email profile address
  &code_challenge=<BASE64URL(SHA256(verifier))>
  &code_challenge_method=S256
  &nonce=<random>
  &state=<random>
  &audience=https://api.cocoromembers.jp.sharp/
```

PKCE (`p079p3/a.java`): verifier = base64url, no padding, of 32 random bytes (43
chars). Challenge = base64url, no padding, of SHA-256(ASCII verifier). Nonce = 32
random bytes base64url. State = 16 random bytes base64url.

Auth0 Universal Login (`/u/login/identifier`, then `/u/login/password`) redirects to
`cocoroair://cm-login?code=…&state=…`.

The app then redeems that code **for its own use only** (`cocoroid/b.java:533-538`,
`cocoroid/c.java:85-140`):

```
POST https://auth.cocoromembers.jp.sharp/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&client_id=lYCfqtg8PF4wrVUF0IosOME9UiObmY4F
&code=<code>&redirect_uri=cocoroair%3A%2F%2Fcm-login&code_verifier=<verifier>
```

It validates the returned `id_token` against `/.well-known/openid-configuration`
then `jwks_uri` (`cocoroid/d.java:111-126`): RS256, iss, aud, azp, nonce and exp
(`cocoroid/b.java:306-381`). It extracts the `member_no` claim (`cocoroid/b.java:153-160`).
**`member_no` is used only to find the local account and is never sent to HMS**
(`f.java:193-204, 221-252`). A JS client can skip this token exchange entirely.

### 3.2 Step B: silent authorize for HMS

`cocoroid/b.java:443-466` (`doOidcSilentAuth`) runs right after step A succeeds:

```
GET https://auth.cocoromembers.jp.sharp/authorize
  ?response_type=code
  &client_id=lYCfqtg8PF4wrVUF0IosOME9UiObmY4F
  &redirect_uri=cocoroair://hms-login
  &scope=offline_access openid email profile address
  &code_challenge=<S256 of a NEW verifier>
  &code_challenge_method=S256
  &state=<random>
  &prompt=none
  &audience=https://api.cocoromembers.jp.sharp/
```

(No nonce.) The callback is `cocoroair://hms-login?code=…&state=…`. On `?error=…`
(for example `login_required`) the result is -12 (`cocoroid/b.java:483-489`). The app
stores `code` and the new `code_verifier` (`cocoroid/b.java:491-506`) and returns them
with `client_id` (`CocoroIDLoginActivity.java:211-217`).

**JS shortcut [uncertain]:** step A only proves the Auth0 browser session exists. A
single *interactive* authorize using the step B parameters minus `prompt=none` should
yield an equally valid code for `cocoroair://hms-login`. If the HMS server rejects that
code, do A then B in two `openAuthSessionAsync` calls. Use a non-ephemeral session so
the Auth0 cookie carries over.

### 3.3 Step C: build tempAccToken

`UserPolicyActivity.java:279-281`:

```
tempAccToken = "auth:" + code_hms + ":" + code_verifier_hms + ":" + client_id
redirectUrl  = "cocoroair://hms-login"
```

The HMS backend redeems the code at Auth0 itself, so the `redirectUrl` you send must
equal the `redirect_uri` used in step B. Auth codes are single-use and expire in minutes,
so do step D right away.

### 3.4 Step D: get a terminalAppId (only if none is stored)

`f.java:423-426, 410-412`, then `D3/q.java:2226-2255`. This call needs no session:

```
GET https://hms.cloudlabs.sharp.co.jp/hems/pfApi/ta/setting/terminalAppId/?appSecret=pngtfljRoYsJE9NW7opn1t2cXA5MtZDKbwon368hs80%3D
Accept: application/json
User-Agent: smartlink_v200a …
```

200 response, parsed at `D3/q.java:2038-2041`:

```json
{ "terminalAppId": "https://db.cloudlabs.sharp.co.jp/clpf/key/<hex>" }
```

The app stores it per user in SQLite `AccountInfo(userId, loginId, terminalAppId, nickname)`,
XOR-obfuscated (`p094s3/C4702k.java:107, 227`).

### 3.5 Step E: first login (binds the terminalAppId to the user)

`f.java:285-287`, then `D3/q.java:2341-2388`:

```
POST https://hms.cloudlabs.sharp.co.jp/hems/pfApi/ta/setting/login/?appSecret=pngtfljRoYsJE9NW7opn1t2cXA5MtZDKbwon368hs80%3D&serviceName=iClub
Content-Type: application/json; charset=utf-8
Accept: application/json
User-Agent: smartlink_v200a …

{
  "tempAccToken": "auth:<code>:<code_verifier>:lYCfqtg8PF4wrVUF0IosOME9UiObmY4F",
  "terminalAppId": "https://db.cloudlabs.sharp.co.jp/clpf/key/<hex>",
  "redirectUrl": "cocoroair://hms-login"
}
```

- 200 means success. The body is not read by the app (about 38 bytes of JSON per
  rcmdnk). Keep the `Set-Cookie: JSESSIONID=…`.
- 401 has a body with `errorCode`. 400 with `E0101006` means the account is locked
  (`D3/q.java:1085-1108`).

### 3.6 Step F: user info

`f.java:261-263`, then `D3/q.java:2300-2335`:

```
GET …/setting/userInfo?terminalAppId=<terminalAppId raw>&appSecret=<secret>
Cookie: JSESSIONID=…
```

Response, parsed at `D3/q.java:1996-2002`:

```json
{ "userId": "…", "nickname": "…", "ownerFlag": true, "zipCd": "1234567", "mailAddr": "…" }
```

### 3.7 Step G: register the terminal (enables terminalAppId-only login) [APK; necessity uncertain]

The app calls this when a nickname is known (`f.java:397-404`), and from the nickname
screen on first use (`activity/NicknameActivity.java:226`). See `D3/q.java:2568-2637`:

```
POST …/setting/terminal?appSecret=<secret>
Content-Type: application/json; charset=utf-8
Cookie: JSESSIONID=…

{
  "name": "<nickname>",
  "os": "Android",
  "osVersion": "14",
  "pushId": "<FCM token or empty>",
  "appName": "spremote_a:1:2.2.18",
  "permitTidLogin": 1,
  "expireSecTidLogin": 0
}
```

The app treats 200 as success (no body read). `permitTidLogin: 1` and
`expireSecTidLogin: 0` look like "allow login with only the terminal id, with no
expiry", which is what makes step H work. Calling this once after step E is
recommended. `pushId` can probably be `""` **[uncertain]**. Optional extra keys
`notifySettingUpdate` (object) and `notifyStatusChange` (array) control push
notifications (`D3/q.java:2611-2616`).

For a brand-new account the app also hits cboard `POST api/v1/users` and
`POST api/v1/terminals` (`smartlink/b.java:4526-4546, 3966-4010`, `f.java:393-408`).
This is only needed for push and timer features **[uncertain whether HMS control needs it]**.

### 3.8 Step H: every later launch, or re-login after a 401

`f.java:419-421` and `289-291`, then `D3/q.java:2390-2432`. This is the login every
third-party client uses:

```
POST …/setting/login/?appSecret=pngtfljRoYsJE9NW7opn1t2cXA5MtZDKbwon368hs80%3D
Content-Type: application/json; charset=utf-8
Accept: application/json

{ "terminalAppId": "https://db.cloudlabs.sharp.co.jp/clpf/key/<hex>" }
```

The Android app omits `serviceName` here. rcmdnk/cocoro and dvcrn/cocoro-sdk add
`&serviceName=iClub`, and both forms work.

On 200, a new `JSESSIONID` is set. On 401, the terminalAppId was revoked or unbound, so
redo steps A to E.

### 3.9 Logout (optional)

The app opens
`https://auth.cocoromembers.jp.sharp/v2/logout?client_id=lYCf…&returnTo=cocoroair://hms-logout`
(`CocoroLogoutActivity.java:25`) and clears local prefs. No HMS logout call was found.

---

## 4. Device discovery

### 4.1 `GET setting/boxInfo` (the list of adapters and appliances)

`D3/q.java:2107-2146`. The app always passes `mode=other` for the main list
(`ApplianceListActivity.java:27983, 28687, 30888`). `mode=terminal` appears in `D3/p.java:191`.

```
GET …/setting/boxInfo?appSecret=<secret>&mode=other
Accept: application/json
Cookie: JSESSIONID=…
```

Response, parsed at `D3/q.java:2008-2020`, `D3/f.java:42-60`, `D3/g.java:173-192`,
`D3/s.java:144-160` (this example is a real dump from dvcrn/cocoro-sdk `dumps/boxInfo.json`):

```json
{
  "box": [{
    "boxId": "https://db.cloudlabs.sharp.co.jp/clpf/key/xxxx",
    "maxFlag": false,
    "pairingFlag": true,
    "pairedTerminalNum": 2,
    "timezone": "Asia/Tokyo",
    "terminalAppInfo": [
      { "terminalAppId": "https://db.cloudlabs.sharp.co.jp/clpf/key/xxxx", "appName": "spremote_i:1:2.2.15", "userNumber": 0 }
    ],
    "echonetData": [{
      "maker": "SHARP", "series": null, "model": "AY-XXXXX-W", "serialNumber": null,
      "deviceId": 21331,
      "echonetNode": "28-xx-xx-xx-6f-e1",
      "echonetObject": "012345",
      "echonetAttr": "<hex>", "echonetProperty": "<hex>",
      "simulPerfModeFlag": false,
      "propertyUpdatedAt": "2021-08-02T17:40:12",
      "labelData": {
        "id": 12345, "place": "寝室", "name": "寝室のエアコン",
        "deviceType": "AIR_CON", "zipCd": "12345", "yomi": "しんしつのえあこん",
        "lSubInfo": "{\"room_data\":{\"size\":4.0,\"struct\":\"prefab\",\"unit\":\"tatami\"}}"
      }
    }]
  }]
}
```

| Need | Field |
|---|---|
| Box id (query `boxId=` on later calls) | `box[].boxId` |
| Device id (inside the control body) | `box[].echonetData[].deviceId` (int) |
| ECHONET node / object | `echonetData[].echonetNode`, `echonetData[].echonetObject` |
| Display name / room | `echonetData[].labelData.name`, `.place` |
| Model | `echonetData[].model` (for example `AY-…` for an air conditioner, `KI-…` for an air purifier) |
| Type | `echonetData[].labelData.deviceType`: `"AIR_CON"` (air conditioner) or `"AIR_CLEANER"` (air purifier). The app keeps only boxes whose **first** `echonetData` has one of these two types (`D3/q.java:2015`, `D3/f.java:31-40`, `p094s3/V.java:81-86`). |
| Static capability blob | `echonetAttr` / `echonetProperty`: hex strings, decoded to bytes (`D3/g.java:180-185`) |
| Timestamps | `propertyUpdatedAt`: `yyyy-MM-dd'T'HH:mm:ss` in **Asia/Tokyo** local time (`D3/m.java:605-615`) |

In practice there is one `echonetData` per box. The app and dvcrn both use index 0.

Other `setting/boxInfo` verbs: `PUT ?boxId=` deletes an adapter (`D3/q.java:2721-2756`).
`POST setting/tempBoxInfo` registers a provisional adapter during Wi-Fi setup
(`D3/q.java:2639-2682`, 201 or 409 counts as OK).

### 4.2 `setting/deviceInfo` (per-box device registration and labels)

The device list is not needed (boxInfo already has it). For reference:
- `GET …/setting/deviceInfo?boxId=<boxId>&appSecret=<secret>` (`D3/q.java:2148-2183`).
  The response has `echonetData[]` of the same shape as above (`D3/q.java:2022-2032`).
- `POST` (register) with the same URL (`D3/q.java:2472-2520`), body
  `{"type":"echonetLite","echonetData":{maker,series,model,serialNumber,echonetNode,echonetObject},"labelData":{place,name,deviceType,zipCd,yomi[,lSubInfo]}}`.
- `PUT` with the same URL (`D3/q.java:2055-2105`), body as above plus
  `"mode":"labelUpdate"` (rename) or `"mode":"delete"`.

### 4.3 Capabilities plus current state: `GET control/deviceProperty`

`D3/m.java:1279-1337`. The control screen loads this first (`smartlink/a.java:488-500`):

```
GET …/control/deviceProperty?appSecret=<secret>&boxId=<boxId>&echonetNode=<node>&echonetObject=<obj>&status=true
Cookie: JSESSIONID=…
```

Response, parsed at `D3/m.java:617-648, 832-875`:

```json
{ "deviceProperty": {
    "deviceId": 21331, "echonetNode": "…", "echonetObject": "…", "registerLevel": 3,
    "propertyUpdatedAt": "2021-08-02T17:40:19",
    "label": "寝室のエアコン", "className": "家庭用エアコン",
    "maker": "SHARP", "series": null, "model": "AY-…", "place": "寝室",
    "property": [
      { "statusName": "動作状態", "statusCode": "80", "get": true, "set": true, "inf": true,
        "valueType": "valueSingle", "valueSingle": [{"name":"ON","code":"30"},{"name":"OFF","code":"31"}] },
      { "statusName": "…", "statusCode": "B3", "get": true, "set": true, "inf": false,
        "valueType": "valueRange", "valueRange": {"type":"int","min":"…","max":"…","step":"…","unit":"…"} },
      { "statusName": "…", "statusCode": "F3", "get": true, "set": true, "inf": false,
        "valueType": "valueBinary", "valueBinary": {"data":"…"} }
    ],
    "status": [ /* same shape as the status entries in section 5 */ ]
} }
```

`status=false` omits `status`.

---

## 5. Status read: `GET control/deviceStatus`

`D3/m.java:1343-1378`. Used to refresh after a control and on the list screen
(`smartlink/a.java:398-415`, `D3/p.java:170`):

```
GET …/control/deviceStatus?appSecret=<secret>&boxId=<boxId>&echonetNode=<node>&echonetObject=<obj>
Cookie: JSESSIONID=…
```

Response, parsed at `D3/m.java:720-735`, `smartlink/a.java:532-533`:

```json
{ "deviceStatus": {
    "deviceId": 21331, "echonetNode": "…", "echonetObject": "…", "registerLevel": 3,
    "propertyUpdatedAt": "2021-08-02T17:40:19",
    "status": [
      { "statusCode": "80", "valueType": "valueSingle", "valueSingle": {"code": "30"}, "valueRange": null, "valueBinary": null },
      { "statusCode": "B3", "valueType": "valueRange",  "valueRange":  {"type": "int", "code": "26"} },
      { "statusCode": "F3", "valueType": "valueBinary", "valueBinary": {"code": "0003000000…"} }
    ]
} }
```

The status entry codec is `D3/m.java:1093-1141`:
- `statusCode` is the ECHONET EPC as 2 hex chars. The server sends upper case.
- `valueSingle.code`: 1-byte enum as hex (for example `"30"` = ON, `"31"` = OFF for EPC 0x80).
- `valueRange.code`: **decimal** string. `type` is `"int"`.
- `valueBinary.code`: hex string of the raw EDT, or `null` if unknown.
- The app's default type per EPC (`D3/m.java:892-911`): single for `80 88 A0 CF`, range
  for `B3 BA BB` (B3 and BA unsigned, BB signed), and binary for everything else.

These are cloud-cached values, so check `propertyUpdatedAt` for freshness.

---

## 6. Control write: `POST control/deviceControl` then poll `control/controlResult`

### 6.1 Send

`D3/m.java:1167-1216`. The body is built in `smartlink/a.java:968-990`, and the status
array in `F3/a.java` (encoding is covered in the other doc):

```
POST …/control/deviceControl?appSecret=<secret>&boxId=<boxId>
Content-Type: application/json; charset=utf-8
Accept: application/json
Cookie: JSESSIONID=…

{
  "controlList": [{
    "deviceId": 21331,
    "echonetNode": "28-xx-xx-xx-6f-e1",
    "echonetObject": "013001",
    "status": [
      { "statusCode": "80", "valueType": "valueSingle", "valueSingle": { "code": "30" } },
      { "statusCode": "b3", "valueType": "valueRange",  "valueRange":  { "type": "int", "code": "26" } },
      { "statusCode": "fa", "valueType": "valueBinary", "valueBinary": { "code": "<hex>" } }
    ]
  }]
}
```

Notes:
- The Android app formats EPCs with `String.format("%2x", …)`, which gives **lower-case**
  hex (`"cf"`, `"a0"`, `"fa"`) (`F3/a.java:11-61`). rcmdnk sends upper case `"F3"`.
  Both work, so the server is case-insensitive. Pick one and be consistent.
- Several EPCs go in one request. The app sends 80, A0, A1, CF, B0 and B3 together for
  a mode change (`F3/a.java:24-40`).
- There is no `deviceToken` in this body. (`deviceToken` appears only in an unrelated
  `ccs-pf/api/inquiryNumber` call, `D3/l.java:224-226`.)

Response (200), parsed at `D3/m.java:544-555`, `smartlink/a.java:362-387`:

```json
{ "controlList": [ { "id": "<control request id>", "errorCode": null } ] }
```

- `errorCode == null` means the command was accepted. Keep `id` and poll.
- `errorCode == "E1001001"` means the device is offline. The app retries the same
  control after 10 s, up to 2 times. Any other code is an error (section 2).

### 6.2 Poll the result

`D3/m.java:1218-1269`. The polling logic is in `smartlink/a.java:362-372, 390-445`:

```
POST …/control/controlResult?boxId=<boxId>&appSecret=<secret>
Content-Type: application/json; charset=utf-8
Accept: application/json
Cookie: JSESSIONID=…

{ "resultList": [ { "id": "<id from controlList>" } ] }
```

Response, parsed at `D3/m.java:676-682`:

```json
{ "resultList": [ { "id": "…", "status": "success", "message": "…", "cancelled_by": "…", "errorCode": "…" } ] }
```

App timing:
1. Wait **2 s** after deviceControl, then make the first controlResult call (`smartlink/a.java:370`).
2. `status` values:
   - `"success"` or `"unmatch"`: done. Then re-read the state with
     `control/deviceStatus` (or `deviceProperty?status=true`) (`smartlink/a.java:396-416`).
   - `"wait"` or `"exec"`: poll again after **1 s**, up to **20** retries. After that,
     give up and re-read the state (`smartlink/a.java:418-445`).
   - `"error"`: fail with `errorCode` (`smartlink/a.java:419-427`).

dvcrn/cocoro-sdk skips polling and only checks `controlList[].errorCode`. That is
acceptable for fire-and-forget use, but polling gives real confirmation.

---

## 7. Other pfApi endpoints seen (not needed for basic control)

| Method | Path | Ref |
|---|---|---|
| GET | `setting/terminal?appSecret=[&boxId=][&mode=house]` gives `{"terminal":[…]}` | `D3/q.java:2257-2298, 2043-2053` |
| POST / PUT | `setting/pairing/?appSecret=&boxId=&houseFlag=false` (PUT adds `&terminalAppId=`) for pairing and unpairing | `D3/q.java:2434-2470, 2684-2719` |
| GET / POST | `setting/billSetting?boxId=&appSecret=` (electricity price) | `D3/q.java:2189-2224, 2522-2566` |
| GET | `data/energy?cmd=daily|monthly&type=&id=<boxId>&date=&appSecret=` | `D3/n.java:453, 495` |

`p104u3/a.java` is a raw TCP socket client to the device's LAN IP with an HMAC-SHA256
key (two hardcoded hex keys, selected by prod or dev base URL, `p104u3/a.java:62-72`).
It is used only from `PairingConfirmActivity` during Wi-Fi adapter pairing. Day-to-day
cloud control does not need it.

---

## 8. Will this work from Expo / React Native `fetch`?

- **mTLS: not required for pfApi.** pfApi calls use a plain `HttpURLConnection` with no
  custom `SSLSocketFactory` or `KeyManager`. The only TLS customisation in app code is
  `jp/co/sharp/hms/smartlink/web/a.java:114-126`, a WebView
  `onReceivedClientCertRequest` that presents `assets/CocoroAirClient.pfx`. That WebView
  loads `https://device.api.aiot.sharp.co.jp/v1/cocoro-home/…` (`p094s3/F.java:32`,
  `CocoroHomeWebViewActivity.java:235-247`). Because the native client cannot present a
  certificate, the HMS server cannot require one. Third-party clients that use plain
  `requests` or `node-fetch` confirm this.
- **Certificate pinning: none.** `res/xml/network_security_config.xml` only allows
  cleartext for `aiot.sharp`, and has no `<pin-set>`. App code never uses OkHttp
  `CertificatePinner`.
- **Cookies:** RN on iOS uses `NSURLSession` with the shared `NSHTTPCookieStorage`, so
  `JSESSIONID` set by `setting/login/` is stored and re-sent automatically to the same
  host. Do not rely on reading `Set-Cookie` from JS (it is often hidden or merged).
  Handle a 401 by calling TID login and retrying. **[uncertain: verify that cookies
  persist across app restarts; a fresh login per launch is cheap anyway]**
- **User-Agent:** RN iOS lets you set the `User-Agent` header on fetch. Send a
  `smartlink_v200…` prefix. Whether the server checks it is unknown, so match the app.
- **OAuth step:** fetch cannot capture a `cocoroair://` redirect. Use
  `expo-web-browser`'s `openAuthSessionAsync(authorizeUrl, 'cocoroair://hms-login')`.
  It runs `ASWebAuthenticationSession`, which intercepts the callback scheme without
  any Info.plist registration. A headless username and password flow against Auth0
  `/u/login/identifier` and `/u/login/password` is possible (hldh214/cocoro-air does it
  for a different redirect target), but it breaks easily (CAPTCHA, custom prompts)
  and is not recommended.
- **CORS:** not applicable on native.

---

## 9. Cross-check with open-source projects

| Project | What it confirms |
|---|---|
| [rcmdnk/cocoro](https://github.com/rcmdnk/cocoro) (Python, [PyPI](https://pypi.org/project/cocoro/)) | `POST /setting/login/?appSecret=&serviceName=iClub` with `{"terminalAppId":"https://db.cloudlabs.sharp.co.jp/clpf/key/<key>"}`, the `JSESSIONID` cookie, `GET /setting/boxInfo/?appSecret=&mode=other`, and a `deviceControl` body `{"controlList":[{"deviceId","echonetNode","echonetObject","status":[{"statusCode":"F3","valueType":"valueBinary","valueBinary":{"code":…}}]}]}`. It gets its credentials from a mitmproxy capture of the iOS app. |
| [dvcrn/cocoro-sdk](https://github.com/dvcrn/cocoro-sdk) (TypeScript, `fetch-cookie` + `node-fetch`) | The same login, boxInfo, `control/deviceProperty?…&status=true`, and deviceControl calls. It provides the real `boxInfo` and `deviceProperty` dumps used above, including the iOS appName `spremote_i:1:2.2.15`. A cookie-jar fetch is all it needs. |
| dvcrn/sharp-cocoro (Python), dvcrn/ha-sharp-cocoro (Home Assistant), dvcrn/homebridge-sharp-cocoro, spect88/cocoro (Ruby) | Ports of the same terminalAppId-only login. None of them implements the OIDC binding (steps A to E). All expect a captured terminalAppId. |
| [hldh214/cocoro-air](https://github.com/hldh214/cocoro-air) | A **different backend** (`cocoroplusapp.jp.sharp/v1/cocoro-air`, mainly air purifiers). Useful only because it shows `auth.cocoromembers.jp.sharp` is Auth0 Universal Login. |
| [aiosharp-cocoro-air](https://pypi.org/project/aiosharp-cocoro-air/) | The EU cloud. Not applicable. |

New in this doc compared with those projects: where `appSecret` comes from (hardcoded
and obfuscated in the APK), how to mint and bind your own `terminalAppId` without a
proxy (steps A to E with `tempAccToken = "auth:code:verifier:client_id"`), the
`controlResult` polling contract, and the error codes.

---

## 10. Open questions (need a live test)

1. Does a single interactive authorize with `redirect_uri=cocoroair://hms-login` (no
   `prompt=none`) give a code HMS accepts, or are both steps A and B required?
2. Is `POST setting/terminal` (`permitTidLogin:1`) required before terminalAppId-only
   login works, and does it accept an empty `pushId`?
3. Is the iOS app's appSecret the same as Android's? Third-party docs capture it from
   iOS without printing it. Any secret that works is fine.
4. Session (`JSESSIONID`) lifetime, and whether a terminalAppId ever expires
   (`expireSecTidLogin:0` suggests it does not).
5. The exact `echonetObject` for the user's air conditioner (expected `013001`), and
   whether the server cares about the case of `statusCode`.
6. Whether the cboard `users` and `terminals` registration is needed for a new
   terminalAppId to see devices in `boxInfo`. Presumably not, since boxes are tied to
   the user.
