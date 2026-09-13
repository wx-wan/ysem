-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'KRW', 'RUB', 'SEK', 'NOK', 'DKK');

-- CreateEnum
CREATE TYPE "AttachmentOwnerType" AS ENUM ('LEAD', 'LEAD_ITEM', 'CUSTOMER', 'OPPORTUNITY', 'OPPORTUNITY_ITEM', 'QUOTATION', 'QUOTATION_ITEM', 'SAMPLE_ORDER', 'SALES_ORDER', 'SALES_ORDER_ITEM', 'PRODUCTION_ORDER', 'QUALITY_INSPECTION', 'SHIPMENT', 'PURCHASE_ORDER', 'PAYMENT', 'PRODUCT', 'COMBO_PRODUCT', 'SUPPLIER', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "ApprovalBizType" AS ENUM ('QUOTATION', 'SAMPLE_ORDER', 'SALES_ORDER', 'PRODUCTION_ORDER', 'SHIPMENT', 'PURCHASE_ORDER', 'PAYMENT', 'PROFIT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MasterStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SupplyMode" AS ENUM ('DEEP_CUSTOM', 'LIGHT_CUSTOM', 'STOCK');

-- CreateEnum
CREATE TYPE "ProductVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ProductTaskType" AS ENUM ('SAMPLE', 'QUOTATION', 'DESIGN', 'MOLD', 'CERTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('MANUAL', 'EXCEL', 'RPA', 'SYNC');

-- CreateEnum
CREATE TYPE "CustomerLevel" AS ENUM ('DIAMOND', 'STRATEGIC', 'PREMIUM', 'NORMAL', 'POTENTIAL');

-- CreateEnum
CREATE TYPE "IntentLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'READY');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'INVALID');

-- CreateEnum
CREATE TYPE "OpportunityOutcome" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('DRAFT', 'DESIGNING', 'MOLDING', 'SAMPLE_SENT', 'FEEDBACK', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SampleRoundResult" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DEPOSIT_PENDING', 'DEPOSIT_PAID', 'IN_PRODUCTION', 'QC', 'READY_TO_SHIP', 'SHIPPED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PRODUCTION', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('INCOMING', 'IN_PRODUCTION', 'FINAL', 'PRE_SHIPMENT');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'BOOKED', 'SHIPPED', 'ARRIVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'BALANCE', 'FULL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'RECEIVED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL', 'ARRIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseItemStatus" AS ENUM ('PENDING', 'PARTIAL', 'ARRIVED');

-- CreateEnum
CREATE TYPE "PurchaseType" AS ENUM ('MATERIAL', 'OUTSOURCE', 'PACKAGING');

-- CreateEnum
CREATE TYPE "ProfitStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "realName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "avatar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "departmentId" TEXT,
    "roleId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "refreshTokens" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "status" INTEGER NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "dataScope" TEXT NOT NULL DEFAULT 'SELF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BUTTON',
    "parentId" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,
    "leaderId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,

    CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "realName" TEXT,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "businessType" TEXT,
    "businessId" TEXT,
    "businessNo" TEXT,
    "summary" TEXT,
    "diff" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalConfig" (
    "id" TEXT NOT NULL,
    "bizType" "ApprovalBizType" NOT NULL,
    "approverIds" TEXT NOT NULL,
    "approverNames" TEXT,
    "flow" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRecord" (
    "id" TEXT NOT NULL,
    "bizType" "ApprovalBizType" NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessNo" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approverId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "ApprovalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "datePattern" TEXT NOT NULL DEFAULT 'yyyyMMdd',
    "padding" INTEGER NOT NULL DEFAULT 4,
    "currentPeriod" TEXT NOT NULL DEFAULT '',
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "ownerType" "AttachmentOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyExchangeRate" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currencyCode" "Currency" NOT NULL,
    "rateToCny" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "englishName" TEXT,
    "contactName" TEXT,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "wechat" TEXT,
    "country" TEXT,
    "region" TEXT,
    "customerLevel" "CustomerLevel" NOT NULL DEFAULT 'NORMAL',
    "customerType" TEXT,
    "source" "LeadSource",
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isKeyAccount" BOOLEAN NOT NULL DEFAULT false,
    "intentLevel" "IntentLevel",
    "notes" TEXT,
    "ownerId" TEXT,
    "firstOrderAt" TIMESTAMP(3),
    "lastOrderAt" TIMESTAMP(3),
    "totalOrderAmountCny" DECIMAL(18,4) DEFAULT 0,
    "coverImage" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerActivity" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "summary" TEXT,
    "diff" TEXT,
    "realName" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "supplierNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "country" TEXT,
    "address" TEXT,
    "crafts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paymentTerms" TEXT,
    "rating" INTEGER,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadItem" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'ONLINE',
    "parentId" TEXT,
    "contact" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "leadNo" TEXT NOT NULL,
    "leadName" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL DEFAULT 'MANUAL',
    "channelId" TEXT,
    "shopId" TEXT,
    "customerId" TEXT,
    "companyName" TEXT,
    "contactName" TEXT,
    "contactMethod" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "customerType" TEXT,
    "productInterest" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "targetPrice" TEXT,
    "certRequire" TEXT,
    "packageReq" TEXT,
    "deliveryReq" TEXT,
    "targetMarket" TEXT,
    "specialReq" TEXT,
    "remark" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "convertedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProduct" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'V1',
    "customName" TEXT,
    "customColors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customPackaging" TEXT,
    "customMaterial" TEXT,
    "customSizeL" DOUBLE PRECISION,
    "customSizeW" DOUBLE PRECISION,
    "customSizeH" DOUBLE PRECISION,
    "customWeight" DOUBLE PRECISION,
    "customFeatures" JSONB,
    "customerSku" TEXT,
    "logoRequired" BOOLEAN NOT NULL DEFAULT false,
    "remark" TEXT,
    "agreedPrice" DECIMAL(18,6),
    "agreedCurrency" "Currency" DEFAULT 'USD',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "price" DECIMAL(18,6) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "taxRate" DECIMAL(9,4),
    "sourceType" TEXT,
    "sourceId" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCraft" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProductCraftToSingleProduct" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProductCraftToSingleProduct_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "ProductAudience" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "productNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "model" TEXT,
    "audienceId" TEXT,
    "categoryId" TEXT,
    "material" TEXT,
    "sizeL" DOUBLE PRECISION,
    "sizeW" DOUBLE PRECISION,
    "sizeH" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "colors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "packaging" TEXT,
    "features" JSONB,
    "description" TEXT,
    "supplyModes" "SupplyMode"[] DEFAULT ARRAY[]::"SupplyMode"[],
    "moq" INTEGER,
    "leadTime" INTEGER,
    "hsCode" TEXT,
    "defaultPrice" DECIMAL(18,6),
    "defaultCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "defaultTaxRate" DECIMAL(9,4) DEFAULT 13,
    "stock" INTEGER DEFAULT 0,
    "lowStockAlert" INTEGER DEFAULT 0,
    "visibility" "ProductVisibility" NOT NULL DEFAULT 'PUBLIC',
    "ownerId" TEXT,
    "coverImage" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "remark" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVisibleUser" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVisibleUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "issuer" TEXT,
    "category" TEXT,
    "validUntil" TIMESTAMP(3),
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "logo" TEXT,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCertification" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "certNo" TEXT,
    "issuedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTask" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProductTaskStatus" NOT NULL DEFAULT 'PENDING',
    "refType" TEXT,
    "refId" TEXT,
    "refNo" TEXT,
    "ownerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboProduct" (
    "id" TEXT NOT NULL,
    "comboNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "ownerId" TEXT,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" DECIMAL(18,6),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "opportunityNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "outcome" "OpportunityOutcome" NOT NULL DEFAULT 'OPEN',
    "outcomeAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "estimatedAmount" DECIMAL(18,4),
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8),
    "estimatedCloseDate" TIMESTAMP(3),
    "intentLevel" "IntentLevel",
    "probability" DECIMAL(5,2),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityItem" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "spec" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "targetPrice" DECIMAL(18,6),
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "remark" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityActivity" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT,
    "leadId" TEXT,
    "action" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "comment" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8),
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "totalAmountCny" DECIMAL(18,4),
    "tradeTerms" TEXT,
    "paymentTerms" TEXT,
    "leadTime" INTEGER,
    "validUntil" TIMESTAMP(3),
    "portOfLoading" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "customerSnapshot" JSONB,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "productSku" TEXT,
    "spec" TEXT,
    "craft" TEXT,
    "size" TEXT,
    "packaging" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "costPrice" DECIMAL(18,6),
    "leadTime" INTEGER,
    "remark" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleOrder" (
    "id" TEXT NOT NULL,
    "sampleNo" TEXT NOT NULL,
    "opportunityId" TEXT,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "spec" TEXT,
    "craft" TEXT,
    "size" TEXT,
    "packaging" TEXT,
    "sampleType" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "requirement" TEXT,
    "targetPrice" TEXT,
    "status" "SampleStatus" NOT NULL DEFAULT 'DRAFT',
    "currentRound" INTEGER NOT NULL DEFAULT 1,
    "feeAmount" DECIMAL(18,4),
    "feeCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "feeRecoverable" BOOLEAN NOT NULL DEFAULT false,
    "customerSnapshot" JSONB,
    "ownerId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleRound" (
    "id" TEXT NOT NULL,
    "sampleOrderId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL DEFAULT 1,
    "designAt" TIMESTAMP(3),
    "moldAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "feedbackAt" TIMESTAMP(3),
    "trackingNo" TEXT,
    "feeAmount" DECIMAL(18,4),
    "result" "SampleRoundResult" NOT NULL DEFAULT 'PENDING',
    "feedback" TEXT,
    "improvements" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "quotationId" TEXT,
    "customerId" TEXT NOT NULL,
    "sampleOrderId" TEXT,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMP(3),
    "depositPaidAt" TIMESTAMP(3),
    "productionStartAt" TIMESTAMP(3),
    "qcAt" TIMESTAMP(3),
    "readyToShipAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8),
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "totalAmountCny" DECIMAL(18,4),
    "depositRatio" DECIMAL(9,4),
    "depositAmount" DECIMAL(18,4),
    "balanceAmount" DECIMAL(18,4),
    "paidAmountCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "orderDate" TIMESTAMP(3),
    "deliveryDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "tradeTerms" TEXT,
    "paymentTerms" TEXT,
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "customerSnapshot" JSONB,
    "termsSnapshot" JSONB,
    "ownerId" TEXT,
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT,
    "customerProductId" TEXT,
    "productName" TEXT NOT NULL,
    "productSku" TEXT,
    "spec" TEXT,
    "craft" TEXT,
    "size" TEXT,
    "material" TEXT,
    "packaging" TEXT,
    "colors" TEXT[],
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "costPrice" DECIMAL(18,6),
    "costAmount" DECIMAL(18,4),
    "deliveryDate" TIMESTAMP(3),
    "shippedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remark" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "productionNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "status" "ProductionStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "workshop" TEXT,
    "requirement" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderItem" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "salesOrderItemId" TEXT,
    "productName" TEXT NOT NULL,
    "spec" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "completedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defectQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "supplierId" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "status" "ProductionItemStatus" NOT NULL DEFAULT 'PENDING',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "purchaseNo" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "productionOrderId" TEXT,
    "supplierId" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "expectedArrivalAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "currency" "Currency" NOT NULL DEFAULT 'CNY',
    "exchangeRate" DECIMAL(18,8),
    "totalAmount" DECIMAL(18,4),
    "totalAmountCny" DECIMAL(18,4),
    "purchaseType" "PurchaseType" NOT NULL DEFAULT 'MATERIAL',
    "ownerId" TEXT,
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT,
    "productionOrderItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "spec" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'CNY',
    "arrivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "PurchaseItemStatus" NOT NULL DEFAULT 'PENDING',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "shipmentDate" TIMESTAMP(3),
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "atd" TIMESTAMP(3),
    "ata" TIMESTAMP(3),
    "incoterm" TEXT,
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "carrier" TEXT,
    "vessel" TEXT,
    "billOfLadingNo" TEXT,
    "trackingNo" TEXT,
    "shippingMethod" TEXT,
    "packageCount" INTEGER,
    "grossWeight" DOUBLE PRECISION,
    "netWeight" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "freightAmount" DECIMAL(18,4),
    "freightCurrency" "Currency",
    "freightAmountCny" DECIMAL(18,4),
    "customsDeclarationNo" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentItem" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "spec" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "packageCount" INTEGER,
    "grossWeight" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityInspection" (
    "id" TEXT NOT NULL,
    "inspectionNo" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "productionOrderId" TEXT,
    "shipmentId" TEXT,
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "inspectionDate" TIMESTAMP(3),
    "inspectorId" TEXT,
    "inspectorName" TEXT,
    "sampleQty" INTEGER,
    "defectQty" INTEGER,
    "defectRate" DECIMAL(9,4),
    "defectSummary" TEXT,
    "disposition" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL,
    "type" "PaymentType" NOT NULL DEFAULT 'OTHER',
    "salesOrderId" TEXT,
    "purchaseOrderId" TEXT,
    "customerId" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8),
    "amount" DECIMAL(18,4) NOT NULL,
    "amountCny" DECIMAL(18,4),
    "ratio" DECIMAL(9,4),
    "payDate" TIMESTAMP(3),
    "method" TEXT,
    "bankAccount" TEXT,
    "voucherRemark" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profit" (
    "id" TEXT NOT NULL,
    "profitNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "revenue" DECIMAL(18,4) NOT NULL,
    "revenueCny" DECIMAL(18,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8),
    "materialCostCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outsourceCostCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "packagingCostCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "laborCostCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "freightCostCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "otherCostCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCostCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "profitCny" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "margin" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "status" "ProfitStatus" NOT NULL DEFAULT 'DRAFT',
    "costSnapshot" JSONB,
    "calculatedAt" TIMESTAMP(3),
    "remark" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "LoginLog_userId_loginAt_idx" ON "LoginLog"("userId", "loginAt");

-- CreateIndex
CREATE INDEX "OperationLog_businessType_businessId_idx" ON "OperationLog"("businessType", "businessId");

-- CreateIndex
CREATE INDEX "OperationLog_module_createdAt_idx" ON "OperationLog"("module", "createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_userId_createdAt_idx" ON "OperationLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalConfig_bizType_key" ON "ApprovalConfig"("bizType");

-- CreateIndex
CREATE INDEX "ApprovalRecord_bizType_businessId_idx" ON "ApprovalRecord"("bizType", "businessId");

-- CreateIndex
CREATE INDEX "ApprovalRecord_approverId_status_idx" ON "ApprovalRecord"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_code_key" ON "NumberSequence"("code");

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "Attachment"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Attachment_category_idx" ON "Attachment"("category");

-- CreateIndex
CREATE UNIQUE INDEX "DailyExchangeRate_date_currencyCode_key" ON "DailyExchangeRate"("date", "currencyCode");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerNo_key" ON "Customer"("customerNo");

-- CreateIndex
CREATE INDEX "Customer_ownerId_idx" ON "Customer"("ownerId");

-- CreateIndex
CREATE INDEX "Customer_companyName_idx" ON "Customer"("companyName");

-- CreateIndex
CREATE INDEX "Customer_country_idx" ON "Customer"("country");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE INDEX "Customer_customerLevel_idx" ON "Customer"("customerLevel");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierNo_key" ON "Supplier"("supplierNo");

-- CreateIndex
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "LeadItem_leadId_idx" ON "LeadItem"("leadId");

-- CreateIndex
CREATE INDEX "LeadItem_productId_idx" ON "LeadItem"("productId");

-- CreateIndex
CREATE INDEX "Channel_category_idx" ON "Channel"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_parentId_name_key" ON "Channel"("parentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerType_name_key" ON "CustomerType"("name");

-- CreateIndex
CREATE INDEX "CustomerType_sort_idx" ON "CustomerType"("sort");

-- CreateIndex
CREATE INDEX "CustomerType_isActive_idx" ON "CustomerType"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_leadNo_key" ON "Lead"("leadNo");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE INDEX "Lead_customerId_idx" ON "Lead"("customerId");

-- CreateIndex
CREATE INDEX "Lead_channelId_idx" ON "Lead"("channelId");

-- CreateIndex
CREATE INDEX "Lead_source_idx" ON "Lead"("source");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerProduct_productId_idx" ON "CustomerProduct"("productId");

-- CreateIndex
CREATE INDEX "CustomerProduct_customerId_idx" ON "CustomerProduct"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProduct_customerId_productId_version_key" ON "CustomerProduct"("customerId", "productId", "version");

-- CreateIndex
CREATE INDEX "ProductPrice_customerId_productId_idx" ON "ProductPrice"("customerId", "productId");

-- CreateIndex
CREATE INDEX "ProductPrice_validTo_idx" ON "ProductPrice"("validTo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPrice_productId_customerId_minQty_currency_key" ON "ProductPrice"("productId", "customerId", "minQty", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCraft_name_key" ON "ProductCraft"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCraft_code_key" ON "ProductCraft"("code");

-- CreateIndex
CREATE INDEX "_ProductCraftToSingleProduct_B_idx" ON "_ProductCraftToSingleProduct"("B");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAudience_name_key" ON "ProductAudience"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAudience_code_key" ON "ProductAudience"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_audienceId_name_key" ON "ProductCategory"("audienceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_productNo_key" ON "Product"("productNo");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "Product_audienceId_idx" ON "Product"("audienceId");

-- CreateIndex
CREATE INDEX "Product_ownerId_idx" ON "Product"("ownerId");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE INDEX "ProductVisibleUser_userId_idx" ON "ProductVisibleUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVisibleUser_productId_userId_key" ON "ProductVisibleUser"("productId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_code_key" ON "Certificate"("code");

-- CreateIndex
CREATE INDEX "ProductCertification_certificateId_idx" ON "ProductCertification"("certificateId");

-- CreateIndex
CREATE INDEX "ProductCertification_validUntil_idx" ON "ProductCertification"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCertification_productId_certificateId_key" ON "ProductCertification"("productId", "certificateId");

-- CreateIndex
CREATE INDEX "ProductTask_productId_status_idx" ON "ProductTask"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductTask_refType_refId_idx" ON "ProductTask"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboProduct_comboNo_key" ON "ComboProduct"("comboNo");

-- CreateIndex
CREATE UNIQUE INDEX "ComboProduct_sku_key" ON "ComboProduct"("sku");

-- CreateIndex
CREATE INDEX "ComboProduct_ownerId_idx" ON "ComboProduct"("ownerId");

-- CreateIndex
CREATE INDEX "ComboItem_productId_idx" ON "ComboItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboItem_groupId_productId_key" ON "ComboItem"("groupId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_opportunityNo_key" ON "Opportunity"("opportunityNo");

-- CreateIndex
CREATE INDEX "Opportunity_outcome_idx" ON "Opportunity"("outcome");

-- CreateIndex
CREATE INDEX "Opportunity_customerId_idx" ON "Opportunity"("customerId");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");

-- CreateIndex
CREATE INDEX "Opportunity_createdAt_idx" ON "Opportunity"("createdAt");

-- CreateIndex
CREATE INDEX "OpportunityItem_opportunityId_idx" ON "OpportunityItem"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityItem_productId_idx" ON "OpportunityItem"("productId");

-- CreateIndex
CREATE INDEX "OpportunityActivity_opportunityId_idx" ON "OpportunityActivity"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityActivity_leadId_idx" ON "OpportunityActivity"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quotationNo_key" ON "Quotation"("quotationNo");

-- CreateIndex
CREATE INDEX "Quotation_customerId_idx" ON "Quotation"("customerId");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_ownerId_idx" ON "Quotation"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_opportunityId_version_key" ON "Quotation"("opportunityId", "version");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- CreateIndex
CREATE INDEX "QuotationItem_productId_idx" ON "QuotationItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SampleOrder_sampleNo_key" ON "SampleOrder"("sampleNo");

-- CreateIndex
CREATE INDEX "SampleOrder_opportunityId_idx" ON "SampleOrder"("opportunityId");

-- CreateIndex
CREATE INDEX "SampleOrder_customerId_idx" ON "SampleOrder"("customerId");

-- CreateIndex
CREATE INDEX "SampleOrder_status_idx" ON "SampleOrder"("status");

-- CreateIndex
CREATE INDEX "SampleOrder_productId_idx" ON "SampleOrder"("productId");

-- CreateIndex
CREATE INDEX "SampleRound_sampleOrderId_idx" ON "SampleRound"("sampleOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "SampleRound_sampleOrderId_roundNo_key" ON "SampleRound"("sampleOrderId", "roundNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNo_key" ON "SalesOrder"("orderNo");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE INDEX "SalesOrder_opportunityId_idx" ON "SalesOrder"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesOrder_ownerId_idx" ON "SalesOrder"("ownerId");

-- CreateIndex
CREATE INDEX "SalesOrder_orderDate_idx" ON "SalesOrder"("orderDate");

-- CreateIndex
CREATE INDEX "SalesOrder_deliveryDate_idx" ON "SalesOrder"("deliveryDate");

-- CreateIndex
CREATE INDEX "SalesOrderItem_orderId_idx" ON "SalesOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_productId_idx" ON "SalesOrderItem"("productId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_customerProductId_idx" ON "SalesOrderItem"("customerProductId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderItem_orderId_lineNo_key" ON "SalesOrderItem"("orderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_productionNo_key" ON "ProductionOrder"("productionNo");

-- CreateIndex
CREATE INDEX "ProductionOrder_salesOrderId_idx" ON "ProductionOrder"("salesOrderId");

-- CreateIndex
CREATE INDEX "ProductionOrder_status_idx" ON "ProductionOrder"("status");

-- CreateIndex
CREATE INDEX "ProductionOrder_ownerId_idx" ON "ProductionOrder"("ownerId");

-- CreateIndex
CREATE INDEX "ProductionOrderItem_productionOrderId_idx" ON "ProductionOrderItem"("productionOrderId");

-- CreateIndex
CREATE INDEX "ProductionOrderItem_salesOrderItemId_idx" ON "ProductionOrderItem"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "ProductionOrderItem_supplierId_idx" ON "ProductionOrderItem"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_purchaseNo_key" ON "PurchaseOrder"("purchaseNo");

-- CreateIndex
CREATE INDEX "PurchaseOrder_salesOrderId_idx" ON "PurchaseOrder"("salesOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_productionOrderId_idx" ON "PurchaseOrder"("productionOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_ownerId_idx" ON "PurchaseOrder"("ownerId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productionOrderItemId_idx" ON "PurchaseOrderItem"("productionOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_lineNo_key" ON "PurchaseOrderItem"("purchaseOrderId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentNo_key" ON "Shipment"("shipmentNo");

-- CreateIndex
CREATE INDEX "Shipment_salesOrderId_idx" ON "Shipment"("salesOrderId");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "Shipment_shipmentDate_idx" ON "Shipment"("shipmentDate");

-- CreateIndex
CREATE INDEX "ShipmentItem_shipmentId_idx" ON "ShipmentItem"("shipmentId");

-- CreateIndex
CREATE INDEX "ShipmentItem_salesOrderItemId_idx" ON "ShipmentItem"("salesOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityInspection_inspectionNo_key" ON "QualityInspection"("inspectionNo");

-- CreateIndex
CREATE INDEX "QualityInspection_productionOrderId_idx" ON "QualityInspection"("productionOrderId");

-- CreateIndex
CREATE INDEX "QualityInspection_shipmentId_idx" ON "QualityInspection"("shipmentId");

-- CreateIndex
CREATE INDEX "QualityInspection_result_idx" ON "QualityInspection"("result");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentNo_key" ON "Payment"("paymentNo");

-- CreateIndex
CREATE INDEX "Payment_salesOrderId_idx" ON "Payment"("salesOrderId");

-- CreateIndex
CREATE INDEX "Payment_purchaseOrderId_idx" ON "Payment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Payment_direction_status_idx" ON "Payment"("direction", "status");

-- CreateIndex
CREATE INDEX "Payment_payDate_idx" ON "Payment"("payDate");

-- CreateIndex
CREATE UNIQUE INDEX "Profit_profitNo_key" ON "Profit"("profitNo");

-- CreateIndex
CREATE UNIQUE INDEX "Profit_salesOrderId_key" ON "Profit"("salesOrderId");

-- CreateIndex
CREATE INDEX "Profit_status_idx" ON "Profit"("status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Permission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginLog" ADD CONSTRAINT "LoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerActivity" ADD CONSTRAINT "CustomerActivity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadItem" ADD CONSTRAINT "LeadItem_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadItem" ADD CONSTRAINT "LeadItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProduct" ADD CONSTRAINT "CustomerProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCraftToSingleProduct" ADD CONSTRAINT "_ProductCraftToSingleProduct_A_fkey" FOREIGN KEY ("A") REFERENCES "ProductCraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductCraftToSingleProduct" ADD CONSTRAINT "_ProductCraftToSingleProduct_B_fkey" FOREIGN KEY ("B") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "ProductAudience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "ProductAudience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVisibleUser" ADD CONSTRAINT "ProductVisibleUser_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVisibleUser" ADD CONSTRAINT "ProductVisibleUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCertification" ADD CONSTRAINT "ProductCertification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCertification" ADD CONSTRAINT "ProductCertification_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTask" ADD CONSTRAINT "ProductTask_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboProduct" ADD CONSTRAINT "ComboProduct_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ComboProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityItem" ADD CONSTRAINT "OpportunityItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityItem" ADD CONSTRAINT "OpportunityItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleOrder" ADD CONSTRAINT "SampleOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleOrder" ADD CONSTRAINT "SampleOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleOrder" ADD CONSTRAINT "SampleOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleRound" ADD CONSTRAINT "SampleRound_sampleOrderId_fkey" FOREIGN KEY ("sampleOrderId") REFERENCES "SampleOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_sampleOrderId_fkey" FOREIGN KEY ("sampleOrderId") REFERENCES "SampleOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_customerProductId_fkey" FOREIGN KEY ("customerProductId") REFERENCES "CustomerProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderItem" ADD CONSTRAINT "ProductionOrderItem_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderItem" ADD CONSTRAINT "ProductionOrderItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderItem" ADD CONSTRAINT "ProductionOrderItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productionOrderItemId_fkey" FOREIGN KEY ("productionOrderItemId") REFERENCES "ProductionOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentItem" ADD CONSTRAINT "ShipmentItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profit" ADD CONSTRAINT "Profit_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- V1.0 Manual Constraints
-- Prisma Schema 无法表达 exactly-one 语义，以下 CHECK 由人工追加，
-- 由 V1.0 Baseline Migration 一并部署（Round 2B-1）。
-- ============================================================

-- QualityInspection: 必须且只能归属于 ProductionOrder 或 Shipment 之一
ALTER TABLE "QualityInspection"
  ADD CONSTRAINT "quality_inspection_exactly_one_owner_ck"
  CHECK (
    ("productionOrderId" IS NOT NULL AND "shipmentId" IS NULL)
    OR
    ("productionOrderId" IS NULL AND "shipmentId" IS NOT NULL)
  );

-- Payment: 必须且只能归属于 SalesOrder 或 PurchaseOrder 之一
ALTER TABLE "Payment"
  ADD CONSTRAINT "payment_exactly_one_owner_ck"
  CHECK (
    ("salesOrderId" IS NOT NULL AND "purchaseOrderId" IS NULL)
    OR
    ("salesOrderId" IS NULL AND "purchaseOrderId" IS NOT NULL)
  );
