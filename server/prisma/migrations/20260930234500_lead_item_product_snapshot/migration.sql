-- 线索明细·产品需求快照（V1.2 追加，非破坏性）
-- 背景：与客户侧同构 —— 产品**未建档**时线索里的产品需求（产品名 / 工艺 / 受众 / 品类 /
--       长宽高 / 克重 / 参考图片）**不创建产品库记录**，只写进本快照；
--       建档（关联 productId）后本字段改由 Product 档案刷新留痕。
ALTER TABLE "LeadItem" ADD COLUMN "productSnapshot" JSONB;
