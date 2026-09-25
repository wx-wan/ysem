-- 新增客户非必填字段：所属行业(industry)、公司官网(website)
ALTER TABLE "Customer" ADD COLUMN "industry" TEXT;
ALTER TABLE "Customer" ADD COLUMN "website" TEXT;
