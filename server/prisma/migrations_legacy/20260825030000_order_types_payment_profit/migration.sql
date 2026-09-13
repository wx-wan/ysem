-- 扩展 Order 单据类型，新增付款单 / 利润单

-- 调整 Order.type 注释（仅注释变更，列本身已是 String，无需改结构）
-- 打样阶段默认值从 DEPOSIT 改为 DESIGN（仅影响新 SAMPLE 记录；现有 ORDER 阶段值保留）

-- 新增付款单表
CREATE TABLE IF NOT EXISTS "PaymentRecord" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "paymentNo" TEXT,
  "payDate" TEXT,
  "amount" DOUBLE PRECISION,
  "ratio" DOUBLE PRECISION,
  "method" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "remark" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- 新增利润单表
CREATE TABLE IF NOT EXISTS "ProfitRecord" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "profitNo" TEXT,
  "revenue" DOUBLE PRECISION,
  "cost" DOUBLE PRECISION,
  "profit" DOUBLE PRECISION,
  "margin" DOUBLE PRECISION,
  "currency" TEXT DEFAULT 'CNY',
  "remark" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProfitRecord_pkey" PRIMARY KEY ("id")
);

-- 外键
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfitRecord" ADD CONSTRAINT "ProfitRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfitRecord" ADD CONSTRAINT "ProfitRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 索引
CREATE INDEX IF NOT EXISTS "PaymentRecord_orderId_idx" ON "PaymentRecord"("orderId");
CREATE INDEX IF NOT EXISTS "PaymentRecord_customerId_idx" ON "PaymentRecord"("customerId");
CREATE INDEX IF NOT EXISTS "ProfitRecord_orderId_idx" ON "ProfitRecord"("orderId");
CREATE INDEX IF NOT EXISTS "ProfitRecord_customerId_idx" ON "ProfitRecord"("customerId");
