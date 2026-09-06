# 纯 Cloudflare 电商架构
## ——抄 Medusa 的“脑子”，不运行 Medusa

> 目标：构建一个真正 **100% Cloudflare Runtime** 的跨境电商系统，同时吸收 Medusa 成熟的 Commerce Domain、Workflow、Payment、Inventory 等设计思想。
>
> 核心原则：**不用 Medusa Runtime；借鉴 Medusa 的架构思想和领域模型，在 Cloudflare 原生技术栈上重新实现。**

---

## 1. 最终方案

```text
                         Internet
                            │
                    Cloudflare CDN/WAF
                            │
                  Next.js / React Storefront
                            │
                     Workers + Hono
                            │
        ┌───────────┬───────┼────────┬───────────┐
        │           │       │        │           │
       D1          R2      KV     Queues         DO
   Commerce DB    Media   Cache    Async     Strong State
        │                           │           │
        └───────────────┬───────────┘           │
                        │                       │
                  Commerce Domain        Inventory / Cart
                        │                 / Flash Sale
                        │
             ┌──────────┴──────────┐
             │                     │
        Payment Adapter       Fulfillment Adapter
             │                     │
       Stripe / PayPal       Logistics / ERP
```

### 技术栈

| 层 | 技术 | 用途 |
|---|---|---|
| CDN / WAF | Cloudflare | 全球访问、安全、防护 |
| Frontend | Next.js / React | 商城前台、Admin |
| API | Workers + Hono | REST API / Webhook |
| Database | D1 | 商品、订单、用户、库存等 |
| Object Storage | R2 | 商品图片、视频、文件 |
| Cache | KV | Session、Cache、配置 |
| Async | Queues | 邮件、Webhook、物流同步 |
| Stateful | Durable Objects | 库存锁、购物车、限时活动 |
| Search | D1 FTS5 | 初期商品搜索 |
| CI/CD | GitHub Actions + Wrangler | 自动部署 |

---

# 2. 为什么不直接部署 Medusa

Medusa 的核心价值不是它的 Runtime，而是它的 **Commerce Architecture**。

重点抄：

- Product
- Product Variant
- Category
- Price
- Customer
- Cart
- Order
- Payment
- Inventory
- Promotion
- Fulfillment
- Tax
- Region
- Currency
- Sales Channel
- Workflow
- Module / Adapter 思想

不抄：

- Node.js 后端 Runtime
- PostgreSQL 依赖
- Medusa Server 本身
- Medusa Runtime 的基础设施

### 核心思想

> **抄 Medusa 的“脑子”，不用 Medusa 的“身体”。**

这样可以避免为了运行 Medusa 而额外维护：

```text
Node.js
PostgreSQL
Medusa Server
Serverless Compatibility
数据库同步
额外 Hosting
```

---

# 3. Commerce Domain

建议按领域拆分，而不是把所有业务写进 Workers Route。

```text
src/
├── domains/
│   ├── auth/
│   ├── customer/
│   ├── product/
│   ├── category/
│   ├── pricing/
│   ├── inventory/
│   ├── cart/
│   ├── order/
│   ├── payment/
│   ├── fulfillment/
│   ├── promotion/
│   ├── tax/
│   ├── currency/
│   ├── region/
│   └── sales-channel/
│
├── workflows/
│   ├── create-cart/
│   ├── add-to-cart/
│   ├── checkout/
│   ├── create-order/
│   ├── authorize-payment/
│   ├── capture-payment/
│   ├── refund-payment/
│   ├── reserve-inventory/
│   └── fulfill-order/
│
├── adapters/
│   ├── stripe/
│   ├── paypal/
│   ├── shipping/
│   ├── email/
│   └── tax/
│
├── storage/
│   ├── d1/
│   ├── r2/
│   ├── kv/
│   ├── queues/
│   └── durable-objects/
│
└── api/
    ├── store/
    ├── customer/
    └── admin/
```

---

# 4. Cloudflare 各组件职责

## D1：核心 Commerce Database

D1 保存：

```text
users
addresses

products
product_variants
categories
product_categories

prices
price_rules

inventory
inventory_movements

carts
cart_items

orders
order_items

payments
payment_events

coupons
coupon_usages

shipments
shipment_tracking

refunds
reviews
wishlists

admin_users
audit_logs
```

### D1 原则

**所有需要关系查询、事务、持久化的数据进入 D1。**

不要用 KV 代替 D1。

---

# 5. R2：媒体和文件

R2：

```text
/products/
    images/
    videos/

/users/
    avatars/

/orders/
    invoices/

/uploads/
```

适合：

- 商品图片
- 商品视频
- 用户上传
- 发票
- PDF
- 导出文件
- 静态资源

不要把大型文件塞进 D1。

---

# 6. KV：Cache，不是主数据库

KV 用于：

```text
Session
Cache
Currency Cache
Config
Feature Flags
Rate Limit辅助数据
商品热点缓存
```

不要使用 KV 保存：

```text
订单
支付状态
库存最终状态
财务数据
```

原因：

> KV 适合高速读取，不适合承担 Commerce 的强一致核心状态。

---

# 7. Queues：异步任务

把非核心同步流程放到 Queue：

```text
Order Created
      │
      ├── Email
      ├── Invoice
      ├── Logistics Sync
      ├── ERP Sync
      ├── Analytics
      └── Webhook
```

用户下单接口不应该等待所有任务完成。

核心请求完成：

```text
Create Order
    ↓
Commit
    ↓
Queue
    ↓
return success
```

---

# 8. Durable Objects：强状态

DO 是整个架构里非常重要的一层。

重点用于：

### Inventory Lock

```text
Product Variant
      │
      ▼
Inventory DO
      │
      ├── Check Stock
      ├── Reserve
      ├── Release
      └── Confirm
```

### Cart

```text
Cart ID
  ↓
Cart DO
  ↓
Serialized Cart State
  ↓
D1 Persistence
```

### Flash Sale

```text
Flash Sale
     ↓
Sale DO
     ↓
Atomic Counter
     ↓
Inventory Reservation
```

原则：

> **D1 保存最终数据，DO 负责瞬时强一致状态和并发协调。**

---

# 9. Inventory 设计

不要简单：

```sql
UPDATE inventory
SET quantity = quantity - 1;
```

高并发情况下容易产生库存竞争。

建议：

```text
                    Product Variant
                          │
                          ▼
                   Inventory DO
                          │
                 Atomic Reservation
                          │
             ┌────────────┴────────────┐
             │                         │
           Success                   Failed
             │                         │
             ▼                         ▼
          D1 Record                  Out of Stock
             │
             ▼
           Order
```

库存状态：

```text
available
reserved
sold
```

预占：

```text
available
    ↓
reserved
    ↓
paid
    ↓
sold
```

超时：

```text
reserved
    ↓
expired
    ↓
available
```

---

# 10. Cart 设计

购物车可以采用：

```text
Client
  ↓
Workers
  ↓
Cart DO
  ↓
D1
```

DO 负责：

- 添加商品
- 删除商品
- 修改数量
- 并发修改
- Cart TTL
- Checkout Lock

D1 保存最终 Cart 数据。

---

# 11. Order Workflow

这是最应该借鉴 Medusa 的部分。

```text
CreateOrder
     │
     ▼
Validate Cart
     │
     ▼
Validate Customer
     │
     ▼
Calculate Price
     │
     ▼
Calculate Discount
     │
     ▼
Calculate Tax
     │
     ▼
Reserve Inventory
     │
     ▼
Create Payment
     │
     ▼
Create Order
     │
     ▼
Queue Fulfillment
```

不要把这些逻辑全部写在一个 HTTP Handler。

---

# 12. Payment Adapter

支付系统必须抽象。

```ts
interface PaymentProvider {
  createSession(input): Promise<PaymentSession>

  authorize(input): Promise<Payment>

  capture(input): Promise<Payment>

  refund(input): Promise<Refund>

  cancel(input): Promise<void>

  verifyWebhook(request): Promise<WebhookEvent>
}
```

结构：

```text
Payment Domain
      │
      ▼
PaymentProvider
      │
 ┌────┴─────┐
 │          │
Stripe    PayPal
```

以后增加其他支付渠道时：

```text
Payment Domain
      │
      ├── Stripe
      ├── PayPal
      ├── Adyen
      └── Other
```

核心 Commerce 代码不需要修改。

---

# 13. Webhook 必须异步化

支付：

```text
Payment Provider
       │
       ▼
Workers Webhook
       │
       ▼
Verify Signature
       │
       ▼
Idempotency Check
       │
       ▼
D1 Payment Event
       │
       ▼
Queue
       │
       ▼
Update Order
```

必须保存：

```text
provider_event_id
event_type
payload
received_at
processed_at
status
```

防止重复 Webhook 导致重复处理。

---

# 14. Fulfillment

订单完成后：

```text
Order
  ↓
Queue
  ↓
Fulfillment Service
  ↓
Shipping Adapter
  ↓
Tracking Number
  ↓
D1
```

抽象：

```ts
interface FulfillmentProvider {
  createShipment(input)
  cancelShipment(input)
  getTracking(input)
}
```

---

# 15. Promotion / Coupon

建议独立 Domain：

```text
Promotion
├── percentage discount
├── fixed discount
├── product discount
├── category discount
├── buy X get Y
├── free shipping
└── coupon
```

结算：

```text
Subtotal
   ↓
Promotion
   ↓
Coupon
   ↓
Shipping
   ↓
Tax
   ↓
Grand Total
```

价格计算必须在后端完成。

前端价格只用于展示。

---

# 16. Region / Currency / Tax

跨境电商不要把价格逻辑写死。

```text
Region
├── US
├── EU
├── UK
├── JP
└── HK
```

Currency：

```text
USD
EUR
GBP
JPY
HKD
```

订单保存：

```text
currency
subtotal
discount
shipping
tax
total
```

并保存下单时的价格快照。

不要在订单页面实时重新计算历史订单价格。

---

# 17. Sales Channel

保留 Medusa 的 Sales Channel 思想：

```text
Sales Channel
├── Website
├── Mobile
├── Marketplace
└── Wholesale
```

Product 与 Channel 建立关系。

例如：

```text
Product A
 ├── Website
 ├── Mobile
 └── Marketplace
```

可以控制：

- 是否销售
- 价格
- 库存
- 国家/地区
- 可见性

---

# 18. API

推荐：

```text
/api/store/*
/api/customer/*
/api/admin/*
/api/webhooks/*
```

例如：

```text
GET    /api/store/products
GET    /api/store/products/:id

POST   /api/store/carts
POST   /api/store/carts/:id/items
PATCH  /api/store/carts/:id/items/:itemId

POST   /api/store/checkout

GET    /api/customer/orders
GET    /api/customer/orders/:id

POST   /api/webhooks/stripe
POST   /api/webhooks/paypal
```

Admin：

```text
/api/admin/products
/api/admin/orders
/api/admin/customers
/api/admin/inventory
/api/admin/promotions
/api/admin/settings
```

---

# 19. D1 核心表

最小 MVP：

```text
users
addresses

products
product_variants
categories
product_categories

prices

inventory
inventory_movements

carts
cart_items

orders
order_items

payments
payment_events

shipments
```

第二阶段：

```text
coupons
promotions
reviews
wishlists
refunds
audit_logs
sales_channels
regions
tax_rules
```

---

# 20. 推荐 Monorepo

```text
commerce/
├── apps/
│   ├── storefront/
│   └── admin/
│
├── worker/
│   ├── api/
│   ├── domains/
│   ├── workflows/
│   ├── adapters/
│   └── storage/
│
├── packages/
│   ├── types/
│   ├── validation/
│   ├── pricing/
│   └── shared/
│
├── migrations/
│
├── wrangler.jsonc
├── package.json
└── README.md
```

---

# 21. 开发顺序

## M0：基础设施

```text
Workers
D1
R2
KV
Queues
DO
GitHub Actions
```

## M1：商品

```text
Product
Variant
Category
Price
R2 Media
```

## M2：用户 + Cart

```text
Auth
Customer
Address
Cart
Cart DO
```

## M3：Checkout

```text
Pricing
Promotion
Tax
Currency
Inventory
Order
```

## M4：Payment

```text
Payment Domain
Stripe
PayPal
Webhook
Idempotency
```

## M5：Fulfillment

```text
Shipment
Tracking
Queue
Logistics Adapter
```

## M6：Admin

```text
Product Admin
Order Admin
Inventory Admin
Customer Admin
Promotion Admin
```

## M7：全球化

```text
Multi-region
Multi-currency
Multi-language
Tax
Shipping
Sales Channel
```

---

# 22. 最重要的架构边界

### D1

负责：

> **事实 / 最终持久化数据**

### DO

负责：

> **强一致 / 并发协调 / 临时状态**

### KV

负责：

> **缓存 / Session / 配置**

### R2

负责：

> **文件 / 媒体**

### Queue

负责：

> **异步任务**

### Workers

负责：

> **业务 API / Domain / Workflow**

---

# 23. 最终架构原则

```text
                    Cloudflare
                         │
          ┌──────────────┴──────────────┐
          │                             │
      Storefront                      Admin
          │                             │
          └──────────────┬──────────────┘
                         │
                  Workers + Hono
                         │
              ┌──────────┼──────────┐
              │          │          │
             D1         R2         KV
              │
              ├──────── Queues
              │
              └──────── Durable Objects
```

业务层：

```text
Medusa Architecture
       ↓
Domain Model
       ↓
Workflow
       ↓
Adapter
       ↓
Cloudflare Native Implementation
```

---

# 24. 一句话结论

**不要做：**

```text
Medusa
  ↓
硬塞进 Cloudflare Workers
```

**做：**

```text
Medusa
  ↓
学习 Domain / Workflow / Commerce Architecture
  ↓
自己实现
  ↓
Workers + Hono
  ↓
D1 + R2 + KV + Queues + Durable Objects
```

最终得到：

> **100% Cloudflare Runtime + Medusa 级 Commerce Domain 思路**

这套方案更适合长期自研、全球部署、低运维成本和高度定制化。
