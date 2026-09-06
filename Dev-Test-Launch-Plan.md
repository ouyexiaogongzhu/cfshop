# 開發 / 測試 / 上線計劃

> 配套文檔：`Cloudflare-Native-Commerce-Medusa-Architecture.md`（架構）。
> 本文件回答：怎麼開工、怎麼測、怎麼安全上線。依據 Cloudflare 官方 Workers / Durable Objects / Wrangler 最佳實踐。

## 已確認決策（2026-09-06）

| 決策 | 選擇 | 對計劃的影響 |
|---|---|---|
| 目標市場 | 香港/全球，USD 結算 + HKD 展示 | R10 調整；PayPal 權重高，M4 加 PayPal；香港無 GST，VAT 後置 |
| Storefront | Next.js + @opennextjs/cloudflare | M0 腳手架改 OpenNext；R18 緩存更關鍵 |
| CF 帳號 | 免費版先行 | 本地 dev 全模擬 $0；**首次雲端部署前升 Workers Paid（$5/月，僅開通動作，零代碼改動）**；CI 暫只跑 dry-run |
| Git | github.com/ouyexiaogongzhu/cfshop | M0 含 GitHub Actions CI |
| 登入方式 | Email + 密碼 | M2 無硬郵件依賴（密碼重置郵件後補，Resend adapter 先 stub） |
| 前台語言/設計 | 英文 only；Tailwind + shadcn 乾淨模板 | i18n 框架預留不加語言包；品牌後調 |
| 歐盟策略 | 後置：HK/美/全球先行 | IOSS/UK VAT/GPSR 觸發條件：歐盟單量起來再開 |
| Admin | 先 API + 腳本，UI 後置 | M6 從 2 週縮到 ~1 週 |

---

## 0. 環境與工具策略（先定，再寫碼）

| 環境 | 用途 | 資源 |
|---|---|---|
| Local（`wrangler dev` / Miniflare） | 日常開發，D1/R2/KV/Queues/DO 全部本地模擬 | 本地 `.wrangler/state`，種子數據腳本 |
| Preview（GitHub PR 自動部署） | 每個 PR 一個臨時 URL，跑 E2E | `*-preview` 資源（D1: `db-preview`…） |
| Staging | 對外測試（Stripe **test mode**），真實佈局驗證 | 独立 D1/R2/KV namespace |
| Production | 正式 | 独立資源 + Time Travel 備份 |

規則（寫進 repo 約定）：

- `wrangler.jsonc` 單一配置 + `env.staging` / `env.production` environments；每個 environment 顯式聲明自己的 binding ID（禁止靠自動 provisioning 猜）。
- 新專案 `compatibility_date` 設當天日期；升級舊日期前先看 changelog 再跑測試。
- 型別一律 `wrangler types` 生成，不手寫 `Env`。
- Secrets：`wrangler secret put` 按 environment 分開設；本地用 `.dev.vars`（gitignore）。禁止 secret 進源碼/配置/日誌。
- D1 schema 用 `wrangler d1 migrations`，migration 檔案進 git；staging / prod 分別 `apply`，禁止 dashboard 手改 schema。
- 所有 Worker 開啟 `observability.enabled = true` + `traces.enabled = true`，結構化 JSON log。
- 部署驗證：CI 一律先 `wrangler deploy --dry-run`。

---

## 1. 開發階段（M0 → M7，每階段有 Definition of Done）

### M0 基礎設施（~1 週）
- git init + 連接 github.com/ouyexiaogongzhu/cfshop；Workers Paid 升級推遲到首次雲端部署（本地開發零依賴）
- Monorepo 腳手架（apps/storefront = Next.js + @opennextjs/cloudflare、worker、packages），wrangler.jsonc + 4 環境
- 建立 D1 / R2 / KV / Queues / DO bindings，migration 框架，GitHub Actions 骨架（lint → typecheck → test → dry-run）
- **DoD**：`pnpm dev` 一條命令跑起本地全棧；PR 自動出 Preview URL

### M1 商品（~1–2 週）
- products / product_variants / categories / prices 表 + Store API（列表、詳情、FTS5 搜索）
- R2 圖片上傳（Admin 先用 wrangler/R2 API 灌數據）
- **DoD**：商品 CRUD + 列表分頁 + FTS 搜索有測試覆蓋；圖片走 R2 + Cache API

### M2 用戶 + Cart（~1–2 週）
- Auth（session 存 KV）、customer / addresses
- Cart DO：加減商品、數量、TTL、checkout lock；D1 存最終 cart
- **DoD**：併發 addToCart 測試無超賣/丟更新；訪客 cart → 登入合併有測試

### M3 Checkout 核心（~2 週）
- 定價 workflow（subtotal → promotion → shipping → tax → total，全部後端算）
- Inventory DO：reserve / release / confirm，alarm 到期自動釋放預占
- create-order workflow + Queues（下單後異步任務）
- **DoD**：flash-sale 式併發壓測下零超賣；預占超時釋放有 alarm 測試

### M4 Payment（~2 週）
- PaymentProvider interface + Stripe adapter（test mode）+ PayPal adapter（HK/全球市場 PayPal 權重高，與 Stripe 同期做）
- Webhook：驗簽 → payment_events 表冪等 → Queue 異步更新訂單
- **DoD**：重複 webhook 只處理一次（有測試）；webhook 處理 <1s 返回 200

### M5 Fulfillment（~1 週）
- shipments 表 + 物流 adapter（先做手動/Excel 出貨也行）+ tracking
- **DoD**：訂單狀態機測試覆蓋 pending→paid→shipped→delivered / refunded

### M6 Admin API（~1 週）
- 商品/訂單/庫存/優惠 Admin **API only**（不建 UI）：admin_users + audit_logs + Cloudflare Access 前置
- 日常營運先用 wrangler d1 execute + 種子/管理腳本頂著；Admin UI 明確觸發後再做（如非技術人員要操作）

### M7 全球化 + 上線準備（~2 週）
- 多幣種 prices、regions、稅則；價格快照進訂單
- 上線檢查清單（見 §4）
- **DoD**：staging 完整跑通 §4 清單

> 順序原則：每個 M 結束必須全綠（typecheck + test + staging 冒煙）才進下一個。砍需求先砍 M7 的 Sales Channel，不砍測試。

---

## 2. 測試策略（四層，成本從低到高）

| 層 | 工具 | 覆蓋 |
|---|---|---|
| 1. 單元 | Vitest（純函數：定價、promotion、稅、幣種換算） | 錢的路徑 100% 覆蓋，含捨入/幣種小數位 |
| 2. Runtime 整合 | `@cloudflare/vitest-pool-workers`（真 workerd + 本地 D1/R2/KV/Queues/DO） | API 路由、DO RPC、webhook 驗簽、idempotency |
| 3. 併發/狀態 | 同上，多併發調用 Inventory DO / Cart DO | 超賣、重複預占、TTL 釋放、checkout lock |
| 4. E2E | Playwright + Stripe test cards + Preview 環境 | 訪客購物→登入→結帳→webhook→訂單可見 |

必測場景清單（上線前全部綠）：

- **庫存**：100 併發搶 10 件 → 恰好 10 個成功；預占 15 分鐘後 alarm 釋放
- **Webhook**：同一 event 重放 3 次只落一條；亂序事件不覆蓋已確認狀態
- **價格**：訂單保存快照，改價不影響歷史訂單
- **Queue**：消費者 throw → 重試；超過 max retries 進 DLQ 並告警
- **冪等**：checkout 重複提交只產生一張訂單
- **迴歸防線**：CI 跑層 1–3；層 4 在 Preview 部署後跑，staging 每日冒煙

---

## 3. CI/CD（GitHub Actions）

```text
PR:      lint → typecheck → vitest(層1-3) → deploy --dry-run → deploy Preview → Playwright(層4)
main:    同上 → auto deploy staging → staging 冒煙
release: 手動觸發 / tag → D1 migration apply(prod) → deploy prod（gradual deployment 10%→100%）→ 冒煙，失敗自動 rollback
```

要點：

- Production 部署走 gradual deployment，出錯即 `wrrollback`；記住 rollback 不回滾 D1 數據，所以 migration 必須向後兼容（先加列後刪列）。
- `wrangler secret put` / `delete` 本身就是部署，生產 secret 變更走獨立 PR 審批 + 手動執行。
- CI 用 Cloudflare API Token，權限最小化（只授權所需 account/product）。

---

## 4. 上線檢查清單（Go-Live Checklist）

**安全**
- [ ] WAF 開啟（managed rules）；`/api/admin/*` 加 Cloudflare Access 或 IP 白名單
- [ ] Rate limiting：store API 按 IP，auth/checkout 按更嚴規則
- [ ] Turnstile：註冊/登入/結帳防 bot
- [ ] Stripe webhook secret、全部 secret 確認只在 secrets，不在代碼/log

**數據**
- [ ] D1 Time Travel 確認可用（默認 30 天），演練一次 PITR 恢復
- [ ] R2 bucket：backup 策略 + lifecycle rule（如臨時上傳 `/uploads/` 過期清理）
- [ ] Migration 演練：在 staging 恢複產品數據副本跑最新 migrations

**可觀測性**
- [ ] Workers Logs + Traces 開啟，採樣率定好
- [ ] 告警：5xx 率、p95 延遲、Queue DLQ 深度 > 0、webhook 處理失敗、支付金額對帳 job
- [ ] 每日對帳：orders vs payments vs inventory 三方核對（Cron Trigger）

**性能**
- [ ] 商品頁/列表走 Cache API，命中率驗證
- [ ] 壓測 flash-sale 場景（k6 / wrangler 撞 DO），確認 DO 單實例吞吐夠用
- [ ] Storefront Lighthouse / Core Web Vitals 達標

**支付**
- [ ] Stripe 切 live mode，webhook endpoint 重新配置並驗簽測試
- [ ] 測試真實小額交易一單，走完 refund 全流程
- [ ] 退稅/發票/隱私政策（目標市場 GDPR 等）確認

**發佈**
- [ ] DNS 切換 / 自定義域名 + SSL 驗證
- [ ] Gradual deploy 10% 觀察 30 分鐘 → 100%
- [ ] Rollback 演練過一次（知道按哪個鈕）

---

## 5. 風險登記簿

### 🔴 高優先級（會造成數據錯誤）

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R1 | **DO ↔ D1 無分佈式事務**：DO 扣庫存成功、D1 寫訂單失敗（網絡抖動 / Worker 超時），兩邊對不上，需人工對賬 | 庫存扣了但訂單沒生成 | **禁止「先 DO 後 D1」的關鍵路徑**。用 Outbox Pattern：先在 D1 寫訂單 + outbox 表（同一事務），Queue 異步驅動 DO；反向同步用 DO alarm 定時把狀態推回 D1。單向流動，不追求兩邊同刻一致 |
| R2 | **DO 熱點**：爆款集中在單一 variant | 高併發下 DO 單實例排隊 | DO 內只做原子計數，D1 落最終狀態；上線前壓測（§2 層 3） |
| R3 | **D1 查詢限制**：單查詢 30s 超時；後台報表（月銷售統計）數據量稍大就超時 | 報表掛、慢查詢拖垮 Worker | 報表一律異步：Queue / Cron 預生成彙總表，或導出本地處理；列表用 cursor 分頁，不用大 OFFSET。註：D1 底層 SQLite **支持** ROW_NUMBER() 等窗口函數，「不支持」是誤傳——真正限制是超時與掃描量，大表上照樣要靠彙總表 |
| R4 | **D1 migration 出錯無法回滾** | 數據損壞 | 只寫向後兼容 migration（先加後刪）；staging 演練 + Time Travel 恢復演練（§4） |

### 🟡 中優先級（功能受限或體驗受損）

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R5 | **Webhook 重複/亂序**：Stripe/PayPal 會重發同一 event | 重複發貨、重複扣款記錄 | `payment_events.provider_event_id` 唯一索引，處理前先查表；狀態機單向流轉。已列入 M4 DoD |
| R6 | **3DS 異步支付無「待確認」態**：用戶跳銀行認證，webhook 晚到 | 訂單狀態混亂 | 訂單狀態機加 `pending_payment`，webhook 成功才轉 `paid`；DO/Cron 15 分鐘超時自動取消並釋放庫存 |
| R7 | **應用層無限流**：結算接口被刷，請求排隊拖垮 Worker | 站點不可用 | checkout/auth 等敏感接口做簡單限流（每 IP 每分鐘 N 次，Cache API 或 DO 計數即可）；配合 §4 的 WAF rate limiting |
| R8 | **FTS5 中文搜索弱**：「手機殼」搜不到「iPhone 保護殼」 | >100 SKU 後搜索體驗差 | 初期 LIKE + KV 同義詞/標籤映射（人工維護）；商品過百再接 Meilisearch。小站靠分類瀏覽可應付 |
| R9 | **DO 冷啟動**：低流量站點 DO 被回收後重建 | 加購/結帳偶發延遲 | 實測延遲通常遠小於 1–2s，先別優化：`wrangler deploy` 開 minify + UI loading 兜底。不要用定時 keep-alive 轟 DO（白燒費用），實測真的慢再說 |

### 🔒 安全與合規

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R14 | **PCI DSS**：自研支付易觸碰原始卡號 | 合規責任重、審計成本高 | 卡號**永遠不經過自己的 Worker**：前端用 Stripe Elements / Payment Element 直連 Stripe，後端只拿 payment intent id / token 落 D1。M4 的 Stripe adapter 按此設計，寫進驗收標準 |
| R15 | **GDPR 被遺忘權**：歐洲用戶要求刪除數據，但訂單、payment_events、audit_logs 都有他的痕跡 | 合規投訴 | 「刪除我的數據」接口：用戶資料軟刪 + **匿名化**（訂單/日誌保留財務記錄但抹去個人標識，物理刪除與稅務保留義務衝突）；Privacy Policy 寫明存儲與處理方式。列入 M2/M6 |
| R16 | **Admin 暴力破解**：單密碼後台 | 後台被攻破 = 全站淪陷 | Admin 整體前置 **Cloudflare Access**（§4 已列，SSO/OTP 免自建）；admin 登錄加限流；不做自研密碼輪換體系 |

### 💸 成本失控

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R17 | **D1 按行讀計費**：首頁列表無緩存，一次刷新 = 幾百行讀 | 流量起來後賬單指數漲 | 首頁/商品頁/分類頁走 **Cache API / Workers Cache**（官方首選，KV 是備選），HTML 或 API 響應緩存命中就不碰 D1；上線前壓測順帶記錄每請求行讀數 |
| R18 | **Workers 請求數**：一個頁面觸發多個 Worker 請求，免費 10 萬/天耗得比想象快 | 賬單超預期 | OpenNext 下靜態資源仍走 Workers Assets（免費、不佔額度），但 SSR/API 每頁都燒 Worker 請求 → 首頁/商品頁 HTML 緩存（R17）同時省這筆；合併 API（頁面數據一次取齊） |
| R19 | **R2 Class A/B 操作費**：圖片頻繁重處理時操作費超過存儲費 | 隱性成本 | 圖片一次上傳不重複處理；對外 serving 走 Cache API 緩存，減少 R2 Class B 讀；需要變體（縮略圖）用 Cloudflare Images 或變換結果緩存 |
| R20 | 賬單無預警 | 月底 surprise | Dashboard 設 **billing notifications** 閾值通知（上線當天就設，不等第一張賬單） |

### 🟢 低優先級（明確觸發前不做）

| # | 風險 | 對策 |
|---|---|---|
| R10 | 多幣種/多 Region 複雜度 | 已定：USD 為結算/標價主幣，HKD 展示幣後置（prices 表天生多幣種，不用重構）；香港無銷售稅，觸達歐盟再處理 VAT/IOSS；Region 表不建 |
| R11 | 多商戶擴展（tenant_id 缺失） | 100% 自營就直接忽略——預留 tenant_id 是為不確定的需求付利息。確定要做平台模式的那天再加字段+回填 |
| R12 | Queue 消息丟失 | 消費者冪等 + DLQ 告警 + 重放腳本 |
| R13 | 過度設計拖慢 M0–M4 | 砍 Sales Channel / 多語言到最後；每階段 DoD 鎖範圍 |

---

## 一句話結論

按 M0→M7 逐段交付，每段用官方 Vitest pool-workers 打底測試；上線不是「部署完」，而是 §4 清單全打勾——其中**庫存併發測試、webhook 冪等、D1 恢復演練**三項一票否決。
