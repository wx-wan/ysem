-- 产品表拆分迁移：Product -> SingleProduct + ComboProduct（+ ComboItem）
-- 步骤：建新表 -> 迁移数据 -> 重建关联 -> 删旧表

-- 1) 单品表 SingleProduct（原 Product 主体）
CREATE TABLE "SingleProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "audienceId" TEXT,
    "categoryId" TEXT,
    "images" TEXT,
    "sizeL" TEXT,
    "sizeW" TEXT,
    "sizeH" TEXT,
    "weight" TEXT,
    "unit" TEXT NOT NULL DEFAULT '个',
    "sampleNo" TEXT,
    "logo" BOOLEAN NOT NULL DEFAULT false,
    "sound" BOOLEAN NOT NULL DEFAULT false,
    "glow" BOOLEAN NOT NULL DEFAULT false,
    "colorChange" BOOLEAN NOT NULL DEFAULT false,
    "sprayWater" BOOLEAN NOT NULL DEFAULT false,
    "colors" TEXT,
    "packaging" TEXT,
    "supplyModes" TEXT DEFAULT '',
    "certificationIds" TEXT DEFAULT '',
    "progress" TEXT DEFAULT '{}',
    "description" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'CNY',
    "taxRate" DOUBLE PRECISION DEFAULT 13,
    "stock" INTEGER DEFAULT 0,
    "lowStockAlert" INTEGER DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SingleProduct_pkey" PRIMARY KEY ("id")
);

-- 2) 组合表 ComboProduct（原 ProductGroup）
CREATE TABLE "ComboProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "ownerId" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboProduct_pkey" PRIMARY KEY ("id")
);

-- 3) 组合明细 ComboItem（原 ProductGroupItem，productId 可空）
CREATE TABLE "ComboItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DOUBLE PRECISION,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("id")
);

-- 4) 外键与索引
CREATE UNIQUE INDEX "SingleProduct_sku_key" ON "SingleProduct"("sku");
CREATE INDEX "SingleProduct_audienceId_idx" ON "SingleProduct"("audienceId");
CREATE INDEX "SingleProduct_categoryId_idx" ON "SingleProduct"("categoryId");
CREATE INDEX "SingleProduct_createdBy_idx" ON "SingleProduct"("createdBy");

CREATE UNIQUE INDEX "ComboProduct_sku_key" ON "ComboProduct"("sku");
CREATE INDEX "ComboProduct_ownerId_idx" ON "ComboProduct"("ownerId");
CREATE INDEX "ComboProduct_createdBy_idx" ON "ComboProduct"("createdBy");

CREATE INDEX "ComboItem_groupId_idx" ON "ComboItem"("groupId");
CREATE INDEX "ComboItem_productId_idx" ON "ComboItem"("productId");

ALTER TABLE "SingleProduct" ADD CONSTRAINT "SingleProduct_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "ProductAudience"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SingleProduct" ADD CONSTRAINT "SingleProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SingleProduct" ADD CONSTRAINT "SingleProduct_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComboProduct" ADD CONSTRAINT "ComboProduct_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComboProduct" ADD CONSTRAINT "ComboProduct_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ComboProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SingleProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) ProductActivity 增加组合关联（comboId）
ALTER TABLE "ProductActivity" ADD COLUMN "comboId" TEXT;
CREATE INDEX "ProductActivity_comboId_idx" ON "ProductActivity"("comboId");
ALTER TABLE "ProductActivity" ADD CONSTRAINT "ProductActivity_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "ComboProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7) 数据迁移 ============================================================
-- 7.1 Product -> SingleProduct（全部单品，组合原本也存 Product，迁移后组合仅保留组头）
INSERT INTO "SingleProduct" (
    "id","name","sku","audienceId","categoryId","images","sizeL","sizeW","sizeH","weight",
    "unit","sampleNo","logo","sound","glow","colorChange","sprayWater","colors","packaging",
    "supplyModes","certificationIds","progress","description","price","currency","taxRate",
    "stock","lowStockAlert","source","visibility","remark","createdBy","createdAt","updatedAt"
)
SELECT
    p."id",p."name",p."sku",p."audienceId",p."categoryId",p."images",p."sizeL",p."sizeW",p."sizeH",p."weight",
    COALESCE(NULLIF(p."unit",''),'个'),p."sampleNo",p."logo",p."sound",p."glow",p."colorChange",p."sprayWater",p."colors",p."packaging",
    p."supplyModes",p."certificationIds",p."progress",p."description",p."price",p."currency",p."taxRate",
    p."stock",p."lowStockAlert",p."source",p."visibility",p."remark",p."createdBy",p."createdAt",p."updatedAt"
FROM "Product" p;

-- 7.2 ProductGroup -> ComboProduct（ProductGroup 仅有 ownerId/status/时间字段）
INSERT INTO "ComboProduct" ("id","name","sku","description","ownerId","status","createdAt","updatedAt")
SELECT
    g."id", g."name",
    'GRP-' || g."id",
    g."description",
    COALESCE(NULLIF(g."ownerId",''), (SELECT "id" FROM "User" LIMIT 1)),
    g."status",
    g."createdAt",
    g."updatedAt"
FROM "ProductGroup" g;

-- 7.3 ProductGroupItem -> ComboItem
INSERT INTO "ComboItem" ("id","groupId","productId","quantity","price","sort","createdAt","updatedAt")
SELECT
    gi."id", gi."groupId", gi."productId", gi."quantity", gi."price", gi."sort", gi."createdAt", gi."updatedAt"
FROM "ProductGroupItem" gi;

-- 8) 重建指向 Product 的外键，改指向 SingleProduct，再删旧表 ----------------
-- 8.1 工艺多对多关联表先改名（Prisma 生成名：Product -> SingleProduct）
ALTER TABLE "_ProductToProductCraft" RENAME TO "_ProductCraftToSingleProduct";

-- 8.2 删除依赖旧 Product 的外键
ALTER TABLE "LeadProduct" DROP CONSTRAINT IF EXISTS "LeadProduct_productId_fkey";
ALTER TABLE "ProductVisibleUser" DROP CONSTRAINT IF EXISTS "ProductVisibleUser_productId_fkey";
ALTER TABLE "ProductActivity" DROP CONSTRAINT IF EXISTS "ProductActivity_productId_fkey";
ALTER TABLE "_ProductCraftToSingleProduct" DROP CONSTRAINT IF EXISTS "_ProductToProductCraft_A_fkey";

-- 8.3 重建外键指向 SingleProduct
ALTER TABLE "LeadProduct" ADD CONSTRAINT "LeadProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SingleProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVisibleUser" ADD CONSTRAINT "ProductVisibleUser_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SingleProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductActivity" ADD CONSTRAINT "ProductActivity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SingleProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ProductCraftToSingleProduct" ADD CONSTRAINT "_ProductCraftToSingleProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "SingleProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8.4 删除旧表
DROP TABLE "ProductGroupItem";
DROP TABLE "ProductGroup";
DROP TABLE "Product";
