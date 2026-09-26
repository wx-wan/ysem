import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Alert,
  AutoComplete,
  Button,
  Cascader,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Col,
  Select,
  Space,
  Tag,
  Tooltip,
  Modal,
} from 'antd';
import dayjs from 'dayjs';
import { CheckOutlined, CloseOutlined, UserAddOutlined, ArrowLeftOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import AppModal from '../AppModal';
import CountrySelect, { findCountry } from '../CountrySelect';

import { ProductEditModal, type ProductEditModalHandle } from '../product/modals/ProductEditModal';
import ConvertCreateSummaryModal from './ConvertCreateSummaryModal';
import { type Channel } from '../../api/channel';
import { customerApi, type Customer } from '../../api/customers';
import { leadApi, type Lead, type LeadPayload } from '../../api/lead';
import { salesApi, type SalesItem } from '../../api/sales';
import { productApi, type Product, type ProductAudience, type ProductCraft, type ProductOption } from '../../api/products';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUserStore } from '../../stores/useUserStore';
import { convertLeadToOpportunity } from '../../utils/convertLead';
import { throttle } from '../../utils/rateLimit';
import type { CustomerOption } from './useLeadOptions';
import ProductImageList from '../common/ProductImageList';
import CustomerTypeSelect from '../CustomerTypeSelect';
import ChipSelect from '../common/ChipSelect';
import ContactMethodInput from '../common/ContactMethodInput';
import type { ContactMethodHandle } from '../common/ContactMethodInput';
import CompanyNameInput from '../common/CompanyNameInput';
import type { CompanyStatus } from '../common/CompanyNameInput';
import MoneyInput, { formatMoneyValue, currentRateOf, type MoneyValue } from '../common/MoneyInput';
import { useCommToolOptions } from '../../stores/useCommToolStore';
import { useUnitOptions } from '../../stores/useUnitStore';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { parseImages, serializeImages, type ProductImageItem } from '../../utils/productImages';

export interface LeadFormModalHandle {
  openCreate: () => void;
  /** 打开编辑；initialStep 可指定初始步骤（如 2 直接进入「确认商机」阶段） */
  openEdit: (record: Lead, initialStep?: number) => void;
}

// 负责人头像底色（按列表顺序循环取色）
const OWNER_COLORS = ['#1677ff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

// 线索来源：安全解析 sourceKey JSON（{ channelId, shopId }）
const safeParseSource = (raw?: string): { channelId?: string; shopId?: string } | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { channelId?: string; shopId?: string };
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

interface Props {
  channels: Channel[];
  productOptions: ProductOption[];
  crafts: ProductCraft[];
  audiences: ProductAudience[];
  customerOptions: CustomerOption[];
  /** 新建客户 / 产品建档成功后刷新对应选项 */
  onRefreshCustomers: () => void;
  onRefreshProducts: () => void;
  /** 保存 / 关联成功后刷新列表与详情；传入 savedId 时父级会自动选中并打开该线索详情 */
  onSaved: (savedId?: string) => void;
}

/**
 * 线索新建 / 编辑 / 详情弹窗：三步向导（客户信息 → 需求详情 → 分配跟进）。
 * Form 包裹整个弹窗，字段沿用原有逻辑，按步骤分组校验后统一提交。
 */
const LeadFormModal = forwardRef<LeadFormModalHandle, Props>((props, ref) => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();

  const {
    channels,
    productOptions,
    crafts,
    audiences,
    customerOptions,
    onRefreshCustomers,
    onRefreshProducts,
    onSaved,
  } = props;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  // 三步向导当前步骤（0 客户信息 / 1 需求详情 / 2 确认商机：仅展示需求清单 + 客户/产品建档校验）
  const [step, setStep] = useState(0);
  const [linkedPipeline, setLinkedPipeline] = useState<SalesItem | null>(null);
  const navigate = useNavigate();
  const productEditRef = useRef<ProductEditModalHandle>(null);
  // 联系方式「新增」按钮放在 Form.Item label 旁时，用 ref 触发组件内部 add()
  const contactMethodRef = useRef<ContactMethodHandle>(null);
  // 转商机强制建档时，保存待解锁的 Promise（弹窗保存后 resolve 出新记录 id；用户取消关闭时 reject）
  const pendingResolveRef = useRef<((v: { id: string }) => void) | null>(null);
  const pendingRejectRef = useRef<((e: Error) => void) | null>(null);

  // 步骤状态：每个步骤独立维护自己的 { status, locked, editing }，避免跨步骤共用变量导致状态纠缠
  // 步骤0（客户信息）：status=归属/建档状态(mine/other/publicSea/none/idle)；locked=建档后锁定全部必填项；editing=点击「编辑」解锁态
  const [step0, setStep0] = useState<{ status: CompanyStatus; locked: boolean; editing: boolean }>({
    status: 'idle',
    locked: false,
    editing: false,
  });
  // 命中客户的归属信息：主键用于关联 Lead.customerId，公司名用于与当前输入比对（覆盖本人 / 他人 / 公海）
  const [matchedCustomerId, setMatchedCustomerId] = useState<string | null>(null);
  const [matchedCompanyName, setMatchedCompanyName] = useState<string | null>(null);
  // mine（本人已建档）时拉取完整客户对象，用于转商机时比对信息变更并同步更新
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  // 公司名称归属「实时查询」信号：每次打开弹窗自增，驱动 CompanyNameInput 用 /ownership 重新查询（而非派生）
  const [companyQuerySeq, setCompanyQuerySeq] = useState(0);
  // 步骤1（需求详情）：status=产品归属/建档状态(idle/exist/none)；locked=建档后锁定产品级字段；editing=点击「编辑」解锁态
  const [step1, setStep1] = useState<{ status: 'idle' | 'exist' | 'none'; locked: boolean; editing: boolean }>({
    status: 'idle',
    locked: false,
    editing: false,
  });
  // 命中产品的主键：建档/更新用于同步产品档案
  const [matchedProductId, setMatchedProductId] = useState<string | null>(null);
  // exist（已建档）时拉取完整产品对象，作为需求详情「产品级字段」变更比对基线
  const [matchedProduct, setMatchedProduct] = useState<Product | null>(null);
  const handleCompanyResolved = (info: {
    status: CompanyStatus;
    companyName?: string;
    customerId?: string;
    ownerName?: string;
    publicSea?: boolean;
  }) => {
    setStep0((s) => ({ ...s, status: info.status }));
    setMatchedCustomerId(info.customerId ?? null);
    setMatchedCompanyName(info.companyName ?? null);
    // 归属不再是「本人已建档」时，退出「编辑已建档客户」状态
    if (info.status !== 'mine') setStep0((s) => ({ ...s, editing: false }));
    // 客户已存在（本人 / 他人 / 公海）：拉取完整档案并自动带入线索表单客户信息（与下拉选中保持一致）；
    // 仅本人已建档（mine）额外留存 matchedCustomer 作为信息变更比对基线，其余情况仅带入不留存基线
    if (info.customerId) {
      customerApi
        .getById(info.customerId)
        .then((r) => {
          const c = (r?.data?.data as Customer) ?? null;
          // 仅「新建线索」自动带入命中客户的默认值（国家/类型/来源/联系人等）；
          // 编辑既有线索（含暂存草稿）时，线索自带的联系人/联系方式才是权威数据，
          // 不能用客户档案覆盖（否则暂存的联系人回显会被客户旧数据顶掉）。
          if (c && !editing?.id) applyCustomerFieldValues(c);
          setMatchedCustomer(info.status === 'mine' ? c : null);
        })
        .catch(() => setMatchedCustomer(null));
    } else {
      setMatchedCustomer(null);
    }
  };

  // 选中/解析到既有客户时，把其国家/地区、客户类型、来源渠道、联系人、联系方式自动带入线索表单
  const applyCustomerFieldValues = (c: {
    country?: string;
    customerType?: string;
    channelId?: string | null;
    shopId?: string | null;
    contactName?: string;
    contactMethods?: { tool: string; account: string }[] | null;
  }) => {
    const patch: Record<string, any> = {};
    if (c.country) patch.targetMarket = c.country;
    if (c.customerType) patch.customerType = c.customerType;
    if (c.channelId) {
      // 历史数据 shopId 兜底为渠道自身（shopId === channelId）时归一为仅 channelId，避免保存时父子校验 400
      patch.sourceKey =
        c.shopId && c.shopId !== c.channelId
          ? JSON.stringify({ channelId: c.channelId, shopId: c.shopId })
          : JSON.stringify({ channelId: c.channelId });
    }
    if (c.contactName) patch.contactName = c.contactName;
    if (c.contactMethods && c.contactMethods.length) patch.contactMethods = c.contactMethods;
    if (Object.keys(patch).length) form.setFieldsValue(patch);
  };

  // 选中下拉既有客户：自动带入其国家/地区、客户类型、来源渠道、联系人、联系方式（来源组合为 sourceKey JSON），并立即关联客户主键
  const handleCustomerPick = (opt: {
    label: string;
    id?: string;
    country?: string;
    customerType?: string;
    channelId?: string | null;
    shopId?: string | null;
    contactName?: string;
    contactMethods?: { tool: string; account: string }[] | null;
    [k: string]: any;
  }) => {
    applyCustomerFieldValues(opt);
    // 选中既有客户：立即关联 customerId（归属查询随后校正 mine/other 状态；避免「未建档」误闪）
    setMatchedCustomerId(opt.id ?? null);
    setMatchedCompanyName(opt.label);
    setStep0((s) => ({ ...s, status: 'idle' }));
    setStep0((s) => ({ ...s, editing: false }));
  };

  // 选中/解析到既有产品时，把其名称、描述、参考图自动带入线索需求详情（产品级字段）
  const applyProductFieldValues = (p: {
    name?: string;
    description?: string | null;
    images?: string | null;
  }) => {
    const patch: Record<string, any> = {};
    if (p.name) patch.productKey = p.name;
    if (p.description) patch.productDesc = p.description;
    if (p.images) patch.images = p.images;
    if (Object.keys(patch).length) form.setFieldsValue(patch);
  };

  // 产品名解析（失焦/下拉选中）：命中既有产品则拉取全量档案并带入（镜像 handleCompanyResolved），否则标记为待新建
  const handleProductResolved = (name?: string) => {
    const nm = (name ?? '').trim();
    if (!nm) {
      setStep1((s) => ({ ...s, status: 'idle' }));
      setMatchedProductId(null);
      setMatchedProduct(null);
      return;
    }
    const opt = productOptions.find((p) => p.name === nm);
    if (opt) {
      setMatchedProductId(opt.id);
      productApi
        .getById(opt.id)
        .then((r: any) => {
          const p = (r?.data?.data ?? r?.data ?? r) as Product | null;
          if (p) applyProductFieldValues(p);
          setMatchedProduct(p);
          setStep1((s) => ({ ...s, status: 'exist' }));
        })
        .catch(() => setMatchedProduct(null));
    } else {
      setStep1((s) => ({ ...s, status: 'none' }));
      setMatchedProductId(null);
      setMatchedProduct(null);
    }
  };

  // 建档 / 更新产品：操作前校验需求详情必填项；建档 = 从表单创建产品，更新 = 同步变化的「产品级字段」；
  // 二者均同时关联线索（一步完成）、随后锁定产品级字段
  const handleFileOrUpdateProduct = async () => {
    try {
      await form.validateFields(['productKey', 'quantity', 'craftIds', 'categoryCascade', 'sizeL', 'sizeW', 'sizeH', 'weight']);
    } catch {
      return; // 字段飘红，停留在当前步
    }
    const v = form.getFieldsValue(true) as Record<string, any>;
    const name = (v.productKey || '').trim();
    if (!name) return;
    try {
      let pid: string;
      const existingPid = (matchedProduct?.id ?? matchedProductId) as string | null;
      if (step1.status === 'exist' && existingPid && matchedProduct) {
        // 比对基线取解析时已带回的 matchedProduct，仅同步表单中发生变化的「产品级字段」
        const upd = buildProductUpdate(matchedProduct);
        if (upd) await productApi.update(existingPid, upd);
        pid = existingPid;
        message.success(t('common.updateSuccess'));
      } else {
        pid = await createProductFromForm();
        message.success(t('common.createSuccess'));
      }
      // 关联命中产品 + 锁定需求详情的产品级字段
      setMatchedProductId(pid);
      setStep1((s) => ({ ...s, status: 'exist' }));
      setStep1((s) => ({ ...s, locked: true }));
      setStep1((s) => ({ ...s, editing: false }));
      setMatchedProduct({
        ...(matchedProduct ?? {}),
        id: pid,
        name: v.productKey,
        description: v.productDesc || null,
        images: v.images || null,
      } as Product);
      // 关联线索产品主键（已建档线索立即写回；新建线索待保存时按名匹配 productId）
      if (editing?.id) {
        await leadApi.update(editing.id, { productId: pid, productName: null });
        setEditing({ ...editing, productId: pid, productName: null });
      }
      onRefreshProducts();
      onSaved(editing?.id);
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // 从表单全量值创建产品（区别于 createProductSilently：后者读 editing 快照，新建线索时 editing 无产品字段，会建出空产品）
  const createProductFromForm = async (): Promise<string> => {
    const v = form.getFieldsValue(true) as Record<string, any>;
    const res: any = await productApi.create({
      name: (v.productKey || '').trim(),
      description: v.productDesc || undefined,
      images: serializeImages(parseImages(v.images)),
      // 需求详情分类与规格带入产品主数据
      craftIds: Array.isArray(v.craftIds) ? v.craftIds : [],
      audienceId: v.categoryCascade?.[0] ?? null,
      categoryId: v.categoryCascade?.[1] ?? null,
      sizeL: v.sizeL != null ? Number(v.sizeL) : null,
      sizeW: v.sizeW != null ? Number(v.sizeW) : null,
      sizeH: v.sizeH != null ? Number(v.sizeH) : null,
      weight: v.weight != null ? Number(v.weight) : null,
    } as any);
    return (res?.data?.id ?? res?.data?.data?.id ?? res?.id) as string;
  };

  // 命中已建档产品时：对比需求详情「产品级字段」与该产品建档时的值，返回发生变化的字段（建档/转商机时同步更新产品档案）
  const buildProductUpdate = (p: Product): Record<string, any> | null => {
    const v = form.getFieldsValue(true) as Record<string, any>;
    const norm = (x: any) => (x === undefined || x === null || x === '' ? null : x);
    const patch: Record<string, any> = {};
    if (norm(v.productKey) !== norm(p.name)) patch.name = norm(v.productKey);
    if (norm(v.productDesc) !== norm(p.description)) patch.description = norm(v.productDesc);
    const formImgs = serializeImages(parseImages(v.images));
    const baseImgs = serializeImages(parseImages(p.images));
    if (formImgs !== baseImgs) patch.images = formImgs;
    // 分类与规格：工艺（数组排序后比对）/ 受众品类 / 长宽高克重
    const formCraftIds = Array.isArray(v.craftIds) ? [...v.craftIds].sort() : [];
    const baseCraftIds = Array.isArray(p.crafts) ? p.crafts.map((c: any) => c.id).sort() : [];
    if (JSON.stringify(formCraftIds) !== JSON.stringify(baseCraftIds)) patch.craftIds = Array.isArray(v.craftIds) ? v.craftIds : [];
    if (norm(v.categoryCascade?.[0]) !== norm(p.audienceId)) patch.audienceId = norm(v.categoryCascade?.[0]);
    if (norm(v.categoryCascade?.[1]) !== norm(p.categoryId)) patch.categoryId = norm(v.categoryCascade?.[1]);
    if (Number(v.sizeL ?? null) !== Number(p.sizeL ?? null)) patch.sizeL = v.sizeL != null ? Number(v.sizeL) : null;
    if (Number(v.sizeW ?? null) !== Number(p.sizeW ?? null)) patch.sizeW = v.sizeW != null ? Number(v.sizeW) : null;
    if (Number(v.sizeH ?? null) !== Number(p.sizeH ?? null)) patch.sizeH = v.sizeH != null ? Number(v.sizeH) : null;
    if (Number(v.weight ?? null) !== Number(p.weight ?? null)) patch.weight = v.weight != null ? Number(v.weight) : null;
    return Object.keys(patch).length ? patch : null;
  };

  // 建档后重新拉取线索最新详情，刷新 editing，避免快照不一致导致「待建档」标签残留
  const refreshEditing = async () => {
    if (!editing?.id) return;
    try {
      const res: any = await leadApi.get(editing.id);
      const item: Lead = res?.data?.data ?? res?.data;
      if (item) setEditing(item);
    } catch {
      /* 忽略：拉取失败不影响主流程 */
    }
  };

  const currentUser = useAuthStore((s) => s.user);
  const fetchUsers = useUserStore((s) => s.fetchUsers);
  const users = useUserStore((s) => s.users);

  // ============ 表单联动 ============
  const watchTargetMarket = Form.useWatch('targetMarket', form);
  const watchProductKey = Form.useWatch('productKey', form);
  const watchQuantity = Form.useWatch('quantity', form);
  const watchCustomerKey = Form.useWatch('customerKey', form);
  const watchUnit = Form.useWatch('unit', form);

  // 线索来源选项：来源渠道 + 来源平台由前端拼接为一个 JSON（{ channelId, shopId }）作为选项值；
  // 无子平台的渠道仅传 channelId（不兜底 shopId = 渠道自身），否则后端父子一致性校验必然 400
  const sourceOptions = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    channels.forEach((c) => {
      const children = c.children || [];
      if (!children.length) {
        list.push({ label: c.name, value: JSON.stringify({ channelId: c.id }) });
      } else {
        children.forEach((child) => {
          list.push({ label: `${c.name} · ${child.name}`, value: JSON.stringify({ channelId: c.id, shopId: child.id }) });
        });
      }
    });
    return list;
  }, [channels]);

  // 线索名称：目标国家 + 产品名称 + 数量，自动生成
  const leadNamePreview = useMemo(() => {
    const parts: string[] = [];
    if (watchTargetMarket) parts.push(watchTargetMarket);
    if (watchProductKey) parts.push(watchProductKey);
    if (watchQuantity !== undefined && watchQuantity !== null) parts.push(String(watchQuantity));
    return parts.join('-');
  }, [watchTargetMarket, watchProductKey, watchQuantity]);

  const productNameOptions = useMemo(
    () => productOptions.map((p) => ({ label: p.name, value: p.name })),
    [productOptions],
  );

  // 工艺下拉（多选）：来自 productOptions 同级的 crafts 主数据
  const craftOptions = useMemo(
    () => crafts.map((c) => ({ label: c.name, value: c.id })),
    [crafts],
  );
  // 受众 → 品类 级联选项（受众为一级，品类为二级 children）
  const cascadeOptions = useMemo(
    () =>
      audiences.map((a) => ({
        value: a.id,
        label: a.name,
        children: (a.categories || []).map((c) => ({ value: c.id, label: c.name })),
      })),
    [audiences],
  );

  // 沟通工具下拉（取自系统设置 → 沟通工具维护，带 10 分钟本地缓存）
  const { options: commToolOptions } = useCommToolOptions();
  // 单位下拉（取自系统设置 → 数据管理 → 单位维护）
  const { options: unitOptions } = useUnitOptions();
  // 币种列表（取自系统设置 → 数据管理 → 币种维护）：金额组件内部自行读取汇率，
  // 此处仅用于摘要页按币种符号格式化展示
  const { currencies, rates } = useCurrencyStore();
  // 联系方式校验由 ContactMethodInput 内部按字段（沟通工具 / 账号）分开判定：
  // 组件 ref.validate() 触发逐字段校验并飘红，字段变化且有值时组件自动清除该字段飘红。
  // 这里只负责在「下一步 / 提交」时触发它，不再用 Form.Item rules 做整体校验。
  const validateContactMethods = () => contactMethodRef.current?.validate() ?? true;


  // 实时比对：当前客户信息表单字段相对「本人已建档」基线 matchedCustomer 是否发生变更
  // （编辑态主按钮：无修改展示「锁定」，有修改展示「更新」）
  const customerChanged = Form.useWatch((values: Record<string, any>) => {
    if (step0.status !== 'mine' || !matchedCustomer) return false;
    if ((values.targetMarket ?? '') !== (matchedCustomer.country ?? '')) return true;
    if ((values.customerType ?? '') !== (matchedCustomer.customerType ?? '')) return true;
    if ((values.contactName ?? '') !== (matchedCustomer.contactName ?? '')) return true;
    // 比对联系方式时忽略「tool/account 均为空」的占位空行，否则与客户的空联系方式误判为差异
    const isRealCm = (r: any) => r && (r.tool || r.account);
    const baseCm = (matchedCustomer.contactMethods || []).filter(isRealCm);
    const formCm = Array.isArray(values.contactMethods) ? values.contactMethods.filter(isRealCm) : [];
    if (baseCm.length !== formCm.length) return true;
    for (let i = 0; i < baseCm.length; i++) {
      if (baseCm[i]?.tool !== formCm[i]?.tool || baseCm[i]?.account !== formCm[i]?.account) return true;
    }
    const baseSrc = `${matchedCustomer.channelId ?? ''}|${matchedCustomer.shopId ?? ''}`;
    const formSrc = safeParseSource(values.sourceKey);
    const formSrcStr = `${formSrc?.channelId ?? ''}|${formSrc?.shopId ?? ''}`;
    if (baseSrc !== formSrcStr) return true;
    return false;
  }, form);

  // 实时比对：客户信息「各字段」相对「本人已建档」基线 matchedCustomer 是否变更（用于对应 label 右侧显示「有更新」）
  const allFormValues = Form.useWatch([], form) as Record<string, any> | undefined;
  const customerFieldDiff = (() => {
    if (step0.status !== 'mine' || !matchedCustomer) return null;
    const v = allFormValues ?? (form.getFieldsValue(true) as Record<string, any>);
    const baseCm = matchedCustomer.contactMethods || [];
    const formCm = Array.isArray(v.contactMethods) ? v.contactMethods.filter(Boolean) : [];
    const cmChanged =
      baseCm.length !== formCm.length ||
      baseCm.some((b: any, i: number) => b?.tool !== formCm[i]?.tool || b?.account !== formCm[i]?.account);
    const baseSrc = `${matchedCustomer.channelId ?? ''}|${matchedCustomer.shopId ?? ''}`;
    const formSrc = safeParseSource(v.sourceKey);
    const srcChanged = baseSrc !== `${formSrc?.channelId ?? ''}|${formSrc?.shopId ?? ''}`;
    return {
      targetMarket: (v.targetMarket ?? '') !== (matchedCustomer.country ?? ''),
      customerType: (v.customerType ?? '') !== (matchedCustomer.customerType ?? ''),
      contactName: (v.contactName ?? '') !== (matchedCustomer.contactName ?? ''),
      contactMethods: cmChanged,
      sourceKey: srcChanged,
    };
  })();
  // 对应字段 label 右侧的「有更新」标记（仅该字段相对客户表基线有改动时显示）
  const UpdatedTag = ({ show }: { show?: boolean }) =>
    show ? (
      <Tag color="blue" style={{ marginInlineEnd: 0, lineHeight: '18px' }}>
        {t('lead.updatedTag')}
      </Tag>
    ) : null;

  // 实时比对：当前需求详情「产品级字段」相对「已建档」基线 matchedProduct 是否发生变更
  const productChanged = Form.useWatch((values: Record<string, any>) => {
    if (step1.status !== 'exist' || !matchedProduct) return false;
    if ((values.productKey ?? '') !== (matchedProduct.name ?? '')) return true;
    if ((values.productDesc ?? '') !== (matchedProduct.description ?? '')) return true;
    const baseImgs = serializeImages(parseImages(matchedProduct.images));
    const formImgs = serializeImages(parseImages(values.images));
    if (baseImgs !== formImgs) return true;
    // 分类与规格：工艺（数组排序后比对）/ 受众品类（级联值）/ 长宽高克重
    const formCraftIds = Array.isArray(values.craftIds) ? [...values.craftIds].sort() : [];
    const baseCraftIds = Array.isArray(matchedProduct.crafts) ? matchedProduct.crafts.map((c: any) => c.id).sort() : [];
    if (JSON.stringify(formCraftIds) !== JSON.stringify(baseCraftIds)) return true;
    const formAud = values.categoryCascade?.[0] ?? null;
    const formCat = values.categoryCascade?.[1] ?? null;
    if ((formAud ?? '') !== (matchedProduct.audienceId ?? '')) return true;
    if ((formCat ?? '') !== (matchedProduct.categoryId ?? '')) return true;
    if (Number(values.sizeL ?? null) !== Number(matchedProduct.sizeL ?? null)) return true;
    if (Number(values.sizeW ?? null) !== Number(matchedProduct.sizeW ?? null)) return true;
    if (Number(values.sizeH ?? null) !== Number(matchedProduct.sizeH ?? null)) return true;
    if (Number(values.weight ?? null) !== Number(matchedProduct.weight ?? null)) return true;
    return false;
  }, form);

  // ============ 三步向导 ============
  const wizardSteps = [t('lead.stepCustomer'), t('lead.stepRequirement'), t('lead.stepConfirm')];

  const goPrev = () => setStep((s) => Math.max(s - 1, 0));


  // 下一步：按当前步骤校验必填项后前进；选中本人已建档客户/产品且未改动时无需建档/更新，直接前进
  const goNext = async () => {
    if (step === 0) {
      // 联系方式（逐字段）+ 客户必填项 一并校验，所有错误同时飘红
      const contactOk = validateContactMethods();
      let fieldsOk = true;
      try {
        await form.validateFields(['customerKey', 'targetMarket', 'customerType', 'contactName', 'contactMethods', 'sourceKey']);
      } catch {
        fieldsOk = false;
      }
      if (!contactOk || !fieldsOk) {
        setStep(0);
        return;
      }
    } else if (step === 1) {
      try {
        await form.validateFields(['productKey', 'quantity', 'craftIds', 'categoryCascade', 'sizeL', 'sizeW', 'sizeH', 'weight']);
      } catch {
        return; // 字段飘红，停留在当前步
      }
    }
    setStep((s) => Math.min(s + 1, wizardSteps.length - 1));
  };

  // ============ 打开 / 提交 ============
  const openCreate = () => {
    setEditing(null);
    setLinkedPipeline(null);
    setStep(0);
    setMatchedCustomer(null);
    setMatchedCustomerId(null);
    setMatchedCompanyName(null);
    setStep0((s) => ({ ...s, status: 'idle' }));
    form.resetFields();
    // 清空联系方式组件内部的字段级校验状态（避免上一次的飘红残留）
    contactMethodRef.current?.reset();
    // 默认至少一条空的联系方式记录
    form.setFieldsValue({ contactMethods: [{ tool: '', account: '' }] });
    // 默认单位 个；目标价位默认 CNY（汇率恒为 1），金额待填
    form.setFieldsValue({
      unit: '个',
      targetPrice: { currency: 'CNY', amount: null, exchangeRate: 1 } as MoneyValue,
    });
    onRefreshCustomers();
    fetchUsers();
    // 新建线索默认负责人为当前登录用户：同时写入表单字段（用于提交）与 editing（用于右上角回显）
    if (currentUser) {
      const defaultOwner = {
        id: currentUser.id,
        realName: currentUser.realName,
        username: currentUser.username,
      };
      setEditing({ ownerId: currentUser.id, owner: defaultOwner } as unknown as Lead);
      form.setFieldsValue({ ownerId: currentUser.id });
    }
    setDrawerOpen(true);
    setStep0((s) => ({ ...s, locked: false }));
    setStep0((s) => ({ ...s, editing: false }));
    setStep1((s) => ({ ...s, locked: false }));
    setStep1((s) => ({ ...s, editing: false }));
    setStep1((s) => ({ ...s, status: 'idle' }));
    setMatchedProductId(null);
    setMatchedProduct(null);
    // 新建：无公司名，querySignal 自增仅作一致性（空名查询无操作）
    setCompanyQuerySeq((n) => n + 1);
  };

  const openEdit = async (record: Lead, initialStep = 0) => {
    setEditing(record);
    setLinkedPipeline(null);
    setStep(initialStep);
    setMatchedCustomer(null);
    setMatchedCustomerId(null);
    setMatchedCompanyName(null);
    setStep0((s) => ({ ...s, status: 'idle' }));
    setMatchedProduct(null);
    setMatchedProductId(null);
    setStep1((s) => ({ ...s, status: 'idle' }));
    setStep1((s) => ({ ...s, locked: false }));
    setStep1((s) => ({ ...s, editing: false }));
    form.resetFields();
    // 清空联系方式组件内部的字段级校验状态
    contactMethodRef.current?.reset();
    onRefreshCustomers();
    try {
      const res = await leadApi.get(record.id);
      const item = res.data;
      // 用详情接口的权威数据更新 editing（确保 status 等字段最新、完整）
      setEditing(item);
      form.setFieldsValue({
        customerKey: item.customer?.companyName || item.companyName || undefined,
        // 联系人：回填 Lead.contactName
        contactName: item.contactName || undefined,
        // 线索来源：后端 channel/shop 关系（ID）拼接回 JSON；
        // 历史数据的 shopId 兜底为渠道自身（shopId === channelId）时归一为仅 channelId，避免保存时父子校验 400
        sourceKey: item.channel?.id
          ? JSON.stringify(
              item.shop?.id && item.shop.id !== item.channel.id
                ? { channelId: item.channel.id, shopId: item.shop.id }
                : { channelId: item.channel.id },
            )
          : undefined,
        // 采购产品：回填 LeadItem 明细（V1.0 产品关联落在 items）
        productKey: item.items?.[0]?.product?.name || item.items?.[0]?.productName || undefined,
        contactMethods:
          Array.isArray(item.contactMethods) && item.contactMethods.length
            ? item.contactMethods
            : [{ tool: '', account: '' }],
        quantity: item.quantity ?? undefined,
        // 单位：回填线索取值，缺失时回退默认 个
        unit: item.unit ?? '个',
        // 负责人（标题栏 Form.Item 字段，一并回填）：canonical 为 ownerId，回退 owner relation
        ownerId: item.ownerId ?? item.owner?.id ?? undefined,
        // 详情扩展字段
        targetMarket: item.targetMarket || undefined,
        productType: item.productType || undefined,
        // 产品描述：回填 LeadItem.productDesc
        productDesc: item.items?.[0]?.productDesc || undefined,
        // 需求详情扩展：产品分类与规格（落 LeadItem）
        craftIds: item.items?.[0]?.craftIds || [],
        categoryCascade:
          item.items?.[0]?.audienceId && item.items?.[0]?.categoryId
            ? [item.items?.[0].audienceId, item.items?.[0].categoryId]
            : undefined,
        sizeL: item.items?.[0]?.sizeL ?? undefined,
        sizeW: item.items?.[0]?.sizeW ?? undefined,
        sizeH: item.items?.[0]?.sizeH ?? undefined,
        weight: item.items?.[0]?.weight ?? undefined,
        // 目标价位：金额组件值（币种 + 金额 + 实时汇率，仅用于展示换算，不再随金额落库汇率快照）
        targetPrice: {
          currency: item.currency ?? 'CNY',
          amount: item.targetPrice != null && item.targetPrice !== '' ? Number(item.targetPrice) || null : null,
          exchangeRate: currentRateOf(item.currency ?? 'CNY', rates),
        } as MoneyValue,
        expectedDelivery: item.expectedDelivery ? dayjs(item.expectedDelivery) : undefined,
        customerType: item.customerType || undefined,
        // 参考图片：回填 Attachment(ownerType=LEAD) 记录
        images: item.attachments && item.attachments.length
          ? serializeImages(item.attachments.map((a) => ({ url: a.url, name: a.name || '' })))
          : '',
      });
      // 归属状态不再由线索冗余字段（customerId 缺失）派生，而是在打开弹窗时由 CompanyNameInput
      // 通过 /ownership 实时查询决定（querySignal 触发）。此处仅递增信号，组件挂载/打开即查询。
      setCompanyQuerySeq((n) => n + 1);
      // 已关联客户且非草稿（已正式建档）的线索打开即锁定客户信息，防止改后与客户档案脱节；
      // 草稿态（draft=true，即便历史数据误带 customerId）一律不锁定，仍可编辑、可暂存
      setStep0((s) => ({ ...s, locked: !!item.customerId && !item.draft }));
      setStep0((s) => ({ ...s, editing: false }));
      // 已关联产品且非草稿（已正式建档）的线索打开即锁定需求详情的产品级字段
      const reopenProductName = item.items?.[0]?.product?.name || item.items?.[0]?.productName || undefined;
      const pid = (item.items?.[0]?.productId ?? item.productId ?? null) as string | null;
      setStep1((s) => ({ ...s, locked: !!pid && !item.draft }));
      setStep1((s) => ({ ...s, editing: false }));
      // 重开（含暂存草稿）：产品名已填但无 productId → 视为「待建档(none)」，展示「未建档」标签与「建档」按钮；
      // 有 productId 视为已建档(exist)；名、id 皆无则回到 idle（避免草稿重开后标签与主按钮错位）
      setStep1((s) => ({ ...s, status: pid ? 'exist' : (reopenProductName ? 'none' : 'idle') }));
      setMatchedProductId(pid);
      if (pid) {
        productApi
          .getById(pid)
          .then((r: any) => {
            const p = (r?.data?.data ?? r?.data ?? r) as Product | null;
            if (p) setMatchedProduct(p);
          })
          .catch(() => setMatchedProduct(null));
      }
      // 溯源：若已关联商机，加载商机信息用于展示
      if (item.pipelineId) {
        try {
          const pRes = await salesApi.get(item.pipelineId);
          setLinkedPipeline(pRes.data.data);
        } catch {
          setLinkedPipeline(null);
        }
      }
    } catch {
      /* 详情加载失败可忽略，表单保持空 */
    }
    setDrawerOpen(true);
  };

  // 由表单全量取值构建 LeadPayload：客户/产品按「手输新名 vs 命中下拉」决定存 companyName/productName 还是 customerId/productId
  const buildLeadPayload = (
    values: Record<string, any>,
    matched?: { id: string | null; name: string | null },
  ): LeadPayload => {
    // 建档后手动注入命中客户（避免依赖异步 setState 的闭包旧值）；缺省回退到归属查询结果
    const mId = matched?.id ?? matchedCustomerId;
    const mName = matched?.name ?? matchedCompanyName;
    // 客户：可手输新客户名，或下拉选择已有客户；手输新名仅存文本，确认后才会建档
    let customerId: string | null = null;
    let companyName: string | undefined;
    const customerName = values.customerKey?.trim();
    if (customerName) {
      // 优先用归属查询命中的客户（覆盖本人 / 他人 / 公海，归属判断最准）
      if (mId && mName && mName.toLowerCase() === customerName.toLowerCase()) {
        customerId = mId;
      } else {
        const matched = customerOptions.find((c) => c.label === customerName);
        if (matched) {
          customerId = matched.value;
        } else {
          companyName = customerName;
        }
      }
    }
    // 采购产品：可手输新产品名，或下拉选择已有产品；手输新名仅存文本，确认后才会建档
    let productId: string | null = null;
    let productName: string | undefined;
    const productNameInput = values.productKey?.trim();
    if (productNameInput) {
      const matched = productOptions.find((p) => p.name === productNameInput);
      if (matched) {
        productId = matched.id;
      } else {
        productName = productNameInput;
      }
    }
    return {
      // 名称由前端按「目标国家+产品名称+数量」规则生成后直接保存
      leadName: leadNamePreview || undefined,
      customerId,
      companyName,
      contactMethods: values.contactMethods || null,
      // 联系人：回填到 Lead.contactName
      contactName: values.contactName ?? null,
      // 来源渠道 / 来源平台：以组合 sourceKey（JSON {channelId, shopId}）原样提交，
      // 由后端入库前拆分为独立列（F-8L-A）
      sourceKey: values.sourceKey ?? null,
      productId,
      productName,
      quantity: values.quantity ? Number(values.quantity) || 0 : 0,
      // 数量单位：隐藏字段（数量输入框后缀可选），随提交落库
      unit: values.unit || null,
      // 负责人在弹窗标题栏（Form.Item 注册字段），随校验一并取回
      ownerId: values.ownerId || null,
      // 详情扩展字段
      targetMarket: values.targetMarket || null,
      productType: values.productType || null,
      productDesc: values.productDesc || null,
      // 目标价位：仅币种 + 金额落库；汇率快照改为建档美元汇率（后端建档时自动抓取，不随金额传入）
      targetPrice: values.targetPrice?.amount != null ? String(values.targetPrice.amount) : null,
      currency: values.targetPrice?.currency ?? null,
      expectedDelivery: values.expectedDelivery
        ? dayjs.isDayjs(values.expectedDelivery)
          ? values.expectedDelivery.toISOString()
          : new Date(values.expectedDelivery).toISOString()
        : null,
      customerType: values.customerType || null,
      // 参考图片：对象数组（url + name），后端转为 Attachment(ownerType=LEAD) 记录
      images: parseImages(values.images).map((i) => ({ url: i.url, name: i.name })),
      // 需求详情扩展：产品分类与规格（落 LeadItem，建档时带入产品）
      craftIds: Array.isArray(values.craftIds) ? values.craftIds : [],
      audienceId: values.categoryCascade?.[0] ?? null,
      categoryId: values.categoryCascade?.[1] ?? null,
      sizeL: values.sizeL != null ? Number(values.sizeL) : null,
      sizeW: values.sizeW != null ? Number(values.sizeW) : null,
      sizeH: values.sizeH != null ? Number(values.sizeH) : null,
      weight: values.weight != null ? Number(values.weight) : null,
    };
  };

  // 暂存：跳过必填校验，直接保存（新建则创建草稿线索，编辑则更新）；空联系方式行不提交。
  // 暂存数据仅落「线索表」（buildLeadPayload 已把公司名 / 联系人 / 来源 / 需求等写入 Lead 字段），
  // 不创建 / 写入客户表、产品表（客户 / 产品主数据的增改仅在「建档 / 锁定 / 提交」时执行）。
  const saveDraft = async () => {
    // 第一阶段（客户信息）暂存：客户公司名称必填，仍须校验
    if (step === 0) {
      try {
        await form.validateFields(['customerKey']);
      } catch {
        return; // 字段飘红，停留在当前步
      }
    }
    const values = form.getFieldsValue(true) as Record<string, any>;
    const validContacts = Array.isArray(values.contactMethods)
      ? values.contactMethods.filter((m: any) => m && m.tool?.trim() && m.account?.trim())
      : [];
    const payload = buildLeadPayload(values);
    payload.contactMethods = validContacts.length ? validContacts : null;
    payload.draft = true;
    // 暂存：记录当前向导阶段（0 客户信息 / 1 需求详情 / 2 确认商机），供详情面板据此展示「编辑」或「确认」
    payload.stage = step;
    try {
      let savedId: string | undefined;
      if (editing?.id) {
        await leadApi.update(editing.id, payload);
        savedId = editing.id;
      } else {
        const created = await leadApi.create(payload);
        savedId = created.data?.id;
      }
      message.success(t('lead.draftSaved'));
      setDrawerOpen(false);
      onSaved(savedId);
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  const submit = async () => {
    // 联系方式：字段级校验（工具 / 账号分开判定），不通过时回到第 1 步展示飘红
    if (!validateContactMethods()) {
      setStep(0);
      return;
    }
    // 校验当前挂载的字段；取值必须用 getFieldsValue(true)（preserve 保留前序步骤值）
    await form.validateFields();
    const values = form.getFieldsValue(true) as Record<string, any>;
    const payload = buildLeadPayload(values);
    // 完整提交：记录当前阶段（确认动作仅在最后一步触发，stage 记为 2）
    payload.stage = step;
    // 正式提交 = 非草稿
    payload.draft = false;
    try {
      let savedId: string | undefined;
      if (editing?.id) {
        await leadApi.update(editing.id, payload);
        savedId = editing.id;
        message.success(t('common.updateSuccess'));
      } else {
        const created = await leadApi.create(payload);
        savedId = created.data?.id;
        message.success(t('common.createSuccess'));
      }
      setDrawerOpen(false);
      onSaved(savedId);
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // 从表单全量值创建客户（区别于 createCustomerSilently：后者读 editing 快照，新建线索时 editing 无客户字段，会建出空客户）
  const createCustomerFromForm = async (): Promise<string> => {
    const v = form.getFieldsValue(true) as Record<string, any>;
    const src = safeParseSource(v.sourceKey);
    const res: any = await customerApi.create({
      companyName: (v.customerKey || '').trim(),
      contactName: v.contactName || undefined,
      country: v.targetMarket ? findCountry(v.targetMarket)?.zh : undefined,
      customerType: v.customerType || undefined,
      contactMethods: Array.isArray(v.contactMethods) ? v.contactMethods.filter(Boolean) : undefined,
      channelId: src?.channelId ?? undefined,
      shopId: src?.shopId ?? undefined,
    } as any);
    return (res?.data?.id ?? res?.data?.data?.id ?? res?.id) as string;
  };

  // 建档 / 更新客户：操作前校验全部必填项；建档 = 从表单创建客户，更新 = 同步变化字段；
  // 二者均同时保存并关联线索（一步完成）、随后锁定客户信息步骤全部必填项
  const handleFileOrUpdateCustomer = async () => {
    // 联系方式（逐字段）+ 客户必填项 一并校验，所有错误同时飘红，避免只卡在联系方式而漏掉其它必填
    const contactOk = validateContactMethods();
    let fieldsOk = true;
    try {
      await form.validateFields(['customerKey', 'targetMarket', 'customerType', 'contactName', 'contactMethods', 'sourceKey']);
    } catch {
      fieldsOk = false; // 字段飘红，停留在当前步
    }
    if (!contactOk || !fieldsOk) {
      setStep(0);
      return;
    }
    const v = form.getFieldsValue(true) as Record<string, any>;
    const name = (v.customerKey || '').trim();
    if (!name) return;
    try {
      let custId: string;
      // 更新：本人已建档且已关联客户主键时，严格走「客户更新」逻辑（绝不变为创建）
      const existingCustId = (matchedCustomer?.id ?? matchedCustomerId) as string | null;
      if (step0.status === 'mine' && existingCustId) {
        // 比对基线取归属查询（handleCompanyResolved）时已带回的 matchedCustomer，避免重复调用接口；
        // 仅当表单相对客户表基线确实存在变化字段时才调用客户更新，否则仅锁定、不重复更新客户
        const upd = matchedCustomer ? buildCustomerUpdate(matchedCustomer) : null;
        if (upd) {
          await customerApi.update(existingCustId, upd);
          message.success(t('common.updateSuccess'));
        } else {
          message.success(t('common.lockSuccess'));
        }
        custId = existingCustId;
      } else {
        // 建档：从表单值创建全新客户
        custId = await createCustomerFromForm();
        message.success(t('common.createSuccess'));
      }
      // 关联命中客户 + 锁定客户信息步骤全部必填项
      setMatchedCustomerId(custId);
      setMatchedCompanyName(name);
      setStep0((s) => ({ ...s, status: 'mine' }));
      setStep0((s) => ({ ...s, locked: true }));
      setStep0((s) => ({ ...s, editing: false }));
      // 用表单当前值刷新客户基线 matchedCustomer：更新/建档后，表单内容已与客户表一致，
      // 基线对齐即「有更新」Tag 全部清空、主按钮切回「锁定」
      const src = safeParseSource(v.sourceKey);
      const realCm = Array.isArray(v.contactMethods)
        ? v.contactMethods.filter((r: any) => r && (r.tool || r.account))
        : [];
      setMatchedCustomer({
        ...(matchedCustomer ?? {}),
        id: custId,
        companyName: name,
        country: v.targetMarket || null,
        customerType: v.customerType || null,
        contactName: v.contactName || null,
        contactMethods: realCm as any,
        channelId: src?.channelId ?? null,
        shopId: src?.shopId ?? null,
      } as Customer);
      // 建档 + 保存线索（一步）：注入命中客户确保关联 customerId，但不关闭弹窗，便于继续填需求
      const payload = buildLeadPayload(v, { id: custId, name });
      payload.stage = step;
      // 建档 / 锁定 = 正式落库客户主数据，线索不再处于草稿态
      payload.draft = false;
      let savedId: string | undefined;
      if (editing?.id) {
        await leadApi.update(editing.id, payload);
        savedId = editing.id;
      } else {
        const created = await leadApi.create(payload);
        savedId = created.data?.id;
      }
      if (savedId) {
        setEditing((prev) => ({ ...(prev as Lead), id: savedId as string, customerId: custId, draft: false, status: 'NEW' }));
      }
      onRefreshCustomers();
      onSaved(savedId);
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // 确认建档：直接用线索信息静默创建客户（不再弹窗）；来源由编辑中线索的 channelId/shopId 带入
  const createCustomerSilently = async (initial?: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
  }): Promise<{ id: string }> => {
    const res: any = await customerApi.create({
      companyName: initial?.companyName ?? editing?.companyName ?? '',
      contactName: initial?.contactName ?? editing?.contactName ?? undefined,
      email: initial?.email ?? editing?.email ?? undefined,
      phone: initial?.phone ?? editing?.phone ?? undefined,
      country:
        initial?.country ??
        (editing?.targetMarket ? findCountry(editing.targetMarket)?.zh : undefined),
      contactMethods: editing?.contactMethods ?? undefined,
      channelId: editing?.channelId ?? undefined,
      shopId: editing?.shopId ?? undefined,
    } as any);
    const cust = (res?.data ?? res) as { id: string };
    return { id: cust.id };
  };

  // 确认建档：直接用线索信息静默创建产品（不再弹窗）；描述取线索产品需求
  const createProductSilently = async (initial?: {
    name?: string;
    description?: string;
  }): Promise<{ id: string }> => {
    const res: any = await productApi.create({
      name: initial?.name ?? editing?.items?.[0]?.productName ?? '',
      description: initial?.description ?? editing?.items?.[0]?.productDesc ?? undefined,
    } as any);
    const p = (res?.data ?? res) as { id: string };
    return { id: p.id };
  };

  // 需求清单校验：客户/产品是否建档、必填项是否齐全；全部通过才允许确认转商机
  const computeRequirement = () => {
    const v = form.getFieldsValue(true) as Record<string, any>;
    const nameMatchesMatched =
      !!matchedCustomerId && !!matchedCompanyName && !!v.customerKey && matchedCompanyName.toLowerCase() === v.customerKey.trim().toLowerCase();
    const customerFiled =
      !!editing?.customerId || nameMatchesMatched || (!!v.customerKey && customerOptions.some((c) => c.label === v.customerKey));
    const productFiled =
      !!editing?.items?.[0]?.productId || (!!v.productKey && productNameOptions.some((p) => p.label === v.productKey));
    const customerReady = !!v.customerKey && customerFiled;
    const productReady = !!v.productKey && productFiled;
    const quantityReady = v.quantity != null && v.quantity !== '' && Number(v.quantity) !== 0;
    const sourceReady = !!v.sourceKey;
    const assigneeReady = !!v.ownerId || !!editing?.ownerId;
    const allReady = customerReady && productReady && quantityReady && sourceReady && assigneeReady;
    return { v, customerFiled, productFiled, allReady };
  };

  // 命中本人已建档客户时：对比线索表单字段与该客户建档时的值，返回发生变化的字段（转商机时同步更新客户档案）
  const buildCustomerUpdate = (c: Customer): Record<string, any> | null => {
    const v = form.getFieldsValue(true) as Record<string, any>;
    const norm = (x: any) => (x === undefined || x === null || x === '' ? null : x);
    const patch: Record<string, any> = {};
    if (norm(v.contactName) !== norm(c.contactName)) patch.contactName = norm(v.contactName);
    // 忽略「tool/account 均为空」的占位空行，避免与客户的空联系方式误判为差异而触发多余更新
    const isRealCm = (r: any) => r && (r.tool || r.account);
    const formMethods = Array.isArray(v.contactMethods) ? v.contactMethods.filter(isRealCm) : [];
    const custMethods = Array.isArray(c.contactMethods) ? c.contactMethods.filter(isRealCm) : [];
    if (JSON.stringify(formMethods) !== JSON.stringify(custMethods)) patch.contactMethods = formMethods;
    if (norm(v.targetMarket) !== norm(c.country)) patch.country = norm(v.targetMarket);
    if (norm(v.customerType) !== norm(c.customerType)) patch.customerType = norm(v.customerType);
    const src = safeParseSource(v.sourceKey);
    if (norm(src?.channelId) !== norm(c.channelId)) patch.channelId = norm(src?.channelId);
    if (norm(src?.shopId) !== norm(c.shopId)) patch.shopId = norm(src?.shopId);
    return Object.keys(patch).length ? patch : null;
  };

  // 转商机流程：未建档客户 → 静默创建并 resolve 出新 id（Promise 兼容 convertLead 调用约定）
  const openCustomerForm = (initial?: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
  }) =>
    new Promise<{ id: string }>((resolve, reject) => {
      createCustomerSilently(initial)
        .then((r) => resolve(r))
        .catch((e) => reject(e));
    });

  // 未建档产品：弹出「新建产品」弹窗（与产品页一致），保存后 resolve 新 id；用户取消关闭则 reject（回到汇总页）
  // 线索参考图（即产品图）一并带入新建产品弹窗，仅写入产品表
  const openProductForm = (initial?: { name?: string; description?: string; images?: ProductImageItem[] }) =>
    new Promise<{ id: string }>((resolve, reject) => {
      pendingResolveRef.current = resolve;
      pendingRejectRef.current = reject;
      const { name, description, images } = initial || {};
      productEditRef.current?.open(undefined, { name, description, images }, false);
    });

  // 待建档清单汇总弹窗（方案A）：客户/产品均缺失时，先弹出汇总页，逐项打开真实弹窗建档
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryItems, setSummaryItems] = useState<{ customerName?: string; productName?: string }>({});
  const summaryResolveRef = useRef<((v: { customerId?: string; productId?: string }) => void) | null>(null);
  const summaryRejectRef = useRef<((e: Error) => void) | null>(null);
  const showCreateSummary = (items: { customerName?: string; productName?: string }) =>
    new Promise<{ customerId?: string; productId?: string }>((resolve, reject) => {
      summaryResolveRef.current = resolve;
      summaryRejectRef.current = reject;
      setSummaryItems(items);
      setSummaryOpen(true);
    });

  // 确认线索：检测客户/产品建档 → 未建档则弹出真实新建弹窗强制建档 → 新建商机 → 标记「已确认」
  const handleConfirmLead = () => {
    if (!editing) return;
    modal.confirm({
      title: t('lead.confirmConvertTitle'),
      content: t('lead.confirmConvertContent'),
      okText: t('common.ok'),
      cancelText: t('common.cancel'),
      // onOk 不返回 Promise，让确认弹窗立即关闭；convertLead 的建档流程由后续弹窗接管，避免层级堆叠。
      onOk: () => {
        (async () => {
          try {
            // 命中本人已建档客户且线索信息较建档时发生变化：转商机前先同步更新客户档案
            if (matchedCustomer && step0.status === 'mine') {
              const upd = buildCustomerUpdate(matchedCustomer);
              if (upd) {
                await customerApi.update(matchedCustomer.id, upd);
                await leadApi.update(editing.id, { customerId: matchedCustomer.id, companyName: null });
                onRefreshCustomers();
              }
            }
            const res = await convertLeadToOpportunity(editing.id, { openCustomerForm, openProductForm, showCreateSummary });
            const successModal = modal.success({
              title: t('lead.convertSuccessTitle'),
              content: (
                <div>
                  <p>{t('lead.convertSuccessDesc')}</p>
                  <p>
                    {t('lead.convertSuccessPipeline')}：
                    <Button
                      type="link"
                      style={{ padding: 0, height: 'auto', fontWeight: 700 }}
                      onClick={() => {
                        successModal.destroy();
                        setDrawerOpen(false);
                        navigate('/sales/opportunities');
                      }}
                    >
                      {res.pipeline?.opportunityNo}
                    </Button>
                  </p>
                  {res.customerCreated && <p>{t('lead.convertCreatedCustomer')}</p>}
                  {res.productCreated && <p>{t('lead.convertCreatedProduct')}</p>}
                </div>
              ),
            });
            onSaved?.();
          } catch {
            // convertLead 内部已 message.error，此处仅吞掉异常避免 unhandled rejection
          }
        })();
      },
    });
  };

  // 认领线索（公海 → 私海）
  const handleClaimLead = async () => {
    if (!editing) return;
    try {
      await leadApi.claim(editing.id);
      message.success(t('lead.claimSuccess'));
      onSaved?.();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // ============ 提交 / 暂存 / 转商机 / 认领 防连点（节流）============
  // 用 ref 持有最新函数实现，配合一次性创建的 throttle 包裹，避免每次渲染重建导致节流失效；
  // leading 立即执行首点，800ms 内重复点击丢弃，防止重复提交 / 重复转商机（如重复报错）。
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const handleConfirmLeadRef = useRef(handleConfirmLead);
  handleConfirmLeadRef.current = handleConfirmLead;
  const handleClaimLeadRef = useRef(handleClaimLead);
  handleClaimLeadRef.current = handleClaimLead;
  const throttledSaveDraft = useMemo(() => throttle(() => void saveDraftRef.current(), 800), []);
  const throttledSubmit = useMemo(() => throttle(() => void submitRef.current(), 800), []);
  const throttledConfirmLead = useMemo(() => throttle(() => handleConfirmLeadRef.current(), 800), []);
  const throttledClaimLead = useMemo(() => throttle(() => void handleClaimLeadRef.current(), 800), []);

  // ============ 确认建档 ============
  // 客户「未建档」标签点击：直接用线索信息静默创建客户并关联（不再弹窗）
  const confirmCreateCustomer = async () => {
    if (readonly) return;
    const name = editing?.companyName || watchCustomerKey;
    if (!name) return;
    try {
      const { id } = await createCustomerSilently({ companyName: name });
      await handleCustomerFiled({ id } as Customer);
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  // 确认建档：直接用线索信息静默创建产品（不再弹窗）
  const confirmCreateProduct = async () => {
    if (readonly) return;
    const name = editing?.items?.[0]?.productName || watchProductKey;
    if (!name) return;
    try {
      const { id } = await createProductSilently({ name });
      await handleProductFiled({ id } as Product);
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  // 静默创建客户成功后：关联客户到当前线索（转商机流程由 convertLead 内部直接 resolve，不走此回调）
  const handleCustomerFiled = async (customer?: Customer) => {
    if (!customer?.id) return;
    // 新建线索（尚无 id）：客户已建档，刷新下拉后标签自动消失，后续保存线索时即可匹配到 customerId
    if (!editing?.id) {
      message.success(t('common.createSuccess'));
      onRefreshCustomers();
      return;
    }
    try {
      await leadApi.update(editing.id, { customerId: customer.id, companyName: null });
      message.success(t('common.createSuccess'));
      onRefreshCustomers();
      onSaved();
      setEditing({ ...editing, customerId: customer.id, companyName: null });
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  // 新建产品弹窗保存成功后：转商机流程则解锁 Promise；否则关联到当前线索
  const handleProductFiled = async (saved?: Product) => {
    if (!saved?.id) return;
    if (pendingResolveRef.current) {
      const resolve = pendingResolveRef.current;
      pendingResolveRef.current = null;
      pendingRejectRef.current = null;
      resolve({ id: saved.id });
      refreshEditing();
      return;
    }
    // 新建线索（尚无 id）：产品已建档，刷新下拉后标签自动消失，后续保存线索时即可匹配到 productId
    if (!editing?.id) {
      message.success(t('common.createSuccess'));
      onRefreshProducts();
      return;
    }
    try {
      await leadApi.update(editing.id, { productId: saved.id, productName: null });
      message.success(t('common.createSuccess'));
      onRefreshProducts();
      onSaved();
      setEditing({ ...editing, productId: saved.id, productName: null });
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  // 公海线索（无负责人）：不支持修改，仅可认领（canonical 归属字段为 ownerId）
  const isPoolLead = !!editing?.id && !editing.ownerId;
  // 只读：已推进（已确认 / 已打样 / 已成交）或公海线索均不可编辑（公海仅保留认领操作）
  const readonly = (!!editing?.id && editing.status !== 'NEW') || isPoolLead;

  useImperativeHandle(ref, () => ({ openCreate, openEdit }));

  return (
    <>
      {/* 新建 / 编辑 / 详情弹窗（左右两栏）：Form 包裹整个弹窗，标题栏负责人字段一并纳入表单管理 */}
      <Form form={form} layout="vertical" preserve autoComplete="off" disabled={readonly} size="large" className="lead-form-v2">
        <AppModal
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onMaskClick={() => {
            modal.confirm({
              title: t('lead.leaveConfirmTitle'),
              content: t('lead.leaveConfirmContent'),
              okText: t('lead.leaveConfirmOk'),
              cancelText: t('common.cancel'),
              okButtonProps: { danger: true },
              onOk: () => setDrawerOpen(false),
            });
          }}
          title={
            <div className="lead-wizard-header">
              <button type="button" className="lead-wizard-header__close" onClick={() => setDrawerOpen(false)}>
                <CloseOutlined />
              </button>
              <div className="lead-wizard-header__title">
                <span>{editing?.id ? editing.leadName || t('lead.editTitle') : t('lead.createTitle')}</span>
                {editing?.id && editing.leadNo && <span className="lead-wizard-header__no">{editing.leadNo}</span>}
              </div>
              <div className="lead-wizard-header__subtitle">
                {t('lead.wizardProgress', { current: step + 1, total: wizardSteps.length, label: wizardSteps[step] })}
              </div>
              <div className="lead-wizard-steps">
                {wizardSteps.map((label, i) => (
                  <div
                    key={label}
                    className={`lead-wizard-steps__item${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
                    onClick={() => setStep(i)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="lead-wizard-steps__dot">{i < step ? <CheckOutlined /> : i + 1}</span>
                    <span className="lead-wizard-steps__label">{label}</span>
                    {i < wizardSteps.length - 1 && <span className="lead-wizard-steps__line" />}
                  </div>
                ))}
              </div>
            </div>
          }
          closable={false}
          headerBorder={false}
          headerPadding={0}
          width={760}
          bodyPadding={24}
          style={{ borderRadius: 20 }}
          footer={
            <div className="lead-wizard-footer">
              <div className="lead-wizard-footer__side">
                {step > 0 ? (
                  <Button type="link" size="large" icon={<ArrowLeftOutlined />} onClick={goPrev}>{t('lead.prevStep')}</Button>
                ) : (
                  <Button type="link" size="large" onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
                )}
              </div>
              <div className="lead-wizard-footer__dots">
                {wizardSteps.map((_, i) => (
                  <span key={i} className={`lead-wizard-footer__dot${i === step ? ' is-active' : ''}`} />
                ))}
              </div>
              <div className="lead-wizard-footer__side lead-wizard-footer__side--right">
                {/* 暂存：非只读（可编辑）且当前步骤未锁定建档时显示，跳过必填校验直接保存；
                   已锁定 / 已建档客户（step0 或 step1 处于锁定）不显示暂存；只读（公海 / 已转商机等）隐藏 */}
                {!readonly && !(step === 0 && step0.locked) && !(step === 1 && step1.locked) && (
                  <Button size="large" className="lead-ghost-btn" onClick={throttledSaveDraft}>{t('lead.keepAsLead')}</Button>
                )}
                {step === 0 ? (
                  // 主操作按钮（客户信息步骤）按四态展示：
                  // 已锁定/已建档 → 编辑 + 下一步；未锁定+未建档(none) → 建档；未锁定+已建档(mine) → 锁定；其余（idle/other/publicSea）→ 仅暂存
                  <>
                    {step0.locked ? (
                      <>
                        {/* 已锁定（已建档）客户：提供「编辑」解锁修正，并提供「下一步」前进 */}
                        <Button size="large" onClick={() => setStep0((s) => ({ ...s, locked: false, editing: true }))}>{t('common.edit')}</Button>
                        <Button size="large" type="primary" onClick={goNext}>{t('lead.nextStep')}</Button>
                      </>
                    ) : step0.status === 'none' ? (
                      // 未建档客户（已输入公司名并解析为不存在）：建档
                      <Button size="large" type="primary" icon={<CheckOutlined />} onClick={handleFileOrUpdateCustomer}>
                        {t('lead.fileLead')}
                      </Button>
                    ) : step0.status === 'mine' ? (
                      // 编辑态（未锁定/已建档）：无修改展示「锁定」，有修改展示「更新」
                      customerChanged ? (
                        <Button size="large" type="primary" onClick={handleFileOrUpdateCustomer}>
                          {t('lead.updateCustomer')}
                        </Button>
                      ) : (
                        <Button size="large" type="primary" onClick={handleFileOrUpdateCustomer}>
                          {t('lead.lock')}
                        </Button>
                      )
                    ) : null}
                  </>
                ) : step === 1 ? (
                  // 主操作按钮（需求详情步骤）按四态展示（镜像客户信息）：
                  // 已锁定/已建档 → 编辑 + 下一步；未锁定+未建档(none) → 建档；未锁定+已建档(exist) → 锁定；其余（idle）→ 仅暂存
                  <>
                    {step1.locked ? (
                      <>
                        {/* 已锁定（已建档）产品：提供「编辑」解锁修正，并提供「下一步」前进 */}
                        <Button size="large" onClick={() => setStep1((s) => ({ ...s, locked: false, editing: true }))}>{t('common.edit')}</Button>
                        <Button size="large" type="primary" onClick={goNext}>{t('lead.nextStep')}</Button>
                      </>
                    ) : step1.status === 'none' ? (
                      // 未建档产品（已输入产品名并解析为不存在）：建档
                      <Button size="large" type="primary" icon={<CheckOutlined />} onClick={handleFileOrUpdateProduct}>
                        {t('lead.fileLead')}
                      </Button>
                    ) : step1.status === 'exist' ? (
                      // 编辑态（未锁定/已建档）：无修改展示「锁定」，有修改展示「更新」
                      productChanged ? (
                        <Button size="large" type="primary" onClick={handleFileOrUpdateProduct}>
                          {t('lead.updateProduct')}
                        </Button>
                      ) : (
                        <Button size="large" type="primary" onClick={handleFileOrUpdateProduct}>
                          {t('lead.lock')}
                        </Button>
                      )
                    ) : null}
                  </>
                ) : (
                  <>
                    {/* 公海线索：仅可认领，确认（转商机）不可用 */}
                    {isPoolLead && (
                      <Button size="large" type="primary" icon={<UserAddOutlined />} onClick={throttledClaimLead}>
                        {t('lead.claim')}
                      </Button>
                    )}
                    {/* 已建档线索：最终步提供「确认」（转商机），样式与保存一致（primary） */}
                    {editing?.id && !readonly && !isPoolLead && editing.status === 'NEW' && computeRequirement().allReady && (
                      <Button size="large" type="primary" onClick={throttledConfirmLead}>
                        {t('lead.confirmLead')}
                      </Button>
                    )}
                    {/* 新建线索：最终步以「确认」提交（样式与保存一致），不再单独显示「保存」按钮 */}
                    {!editing?.id && (
                      <Button size="large" type="primary" icon={<CheckOutlined />} onClick={throttledSubmit}>{t('lead.confirmRequirement')}</Button>
                    )}
                  </>
                )}
              </div>
            </div>
          }
        >
          {/* 负责人：界面不选择（新建默认当前登录用户、编辑沿用原负责人），隐藏字段保证提交携带 */}
          <Form.Item name="ownerId" hidden>
            <Input />
          </Form.Item>
          {/* 单位：随数量需求后缀展示，隐藏字段以便提交时携带（币种已并入目标价位金额组件） */}
          <Form.Item name="unit" hidden>
            <Input />
          </Form.Item>

          {/* 步骤一：客户信息 */}
          {step === 0 && (
            <>
              <Row gutter={[16, 0]}>
                <Col span={24}>
                  <Form.Item
                    name="customerKey"
                    label={
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span>{t('lead.customerCompany')}</span>
                        {step0.status === 'none' && !step0.locked && (
                          <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                            {t('lead.pendingTag')}
                          </Tag>
                        )}
                        {step0.locked && (
                          <Tag color="green" style={{ marginInlineEnd: 0 }}>
                            {t('lead.filedTag')}
                          </Tag>
                        )}
                      </span>
                    }
                    rules={[{ required: true, message: t('lead.customerRequired') }]}
                  >
                    <CompanyNameInput
                      onResolved={handleCompanyResolved}
                      onPick={handleCustomerPick}
                      options={customerOptions}
                      querySignal={companyQuerySeq}
                      disabled={step0.locked}
                      placeholder={t('lead.customerPlaceholder')}
                    />
                  </Form.Item>
                </Col>
              </Row>
              {/* 客户基础信息（国家/地区 · 客户类型 · 联系人 · 联系方式 · 来源）原公共组件已内联 */}
              <Row gutter={[16, 0]}>
                <Col span={12}>
                  <Form.Item name="targetMarket" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span>{t('lead.targetMarket')}</span><UpdatedTag show={customerFieldDiff?.targetMarket} /></span>} rules={[{ required: true, message: t('lead.targetMarketRequired') }]}>
                    <CountrySelect placeholder={t('lead.targetMarketPlaceholder')} disabled={step0.locked} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="customerType" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span>{t('lead.customerType')}</span><UpdatedTag show={customerFieldDiff?.customerType} /></span>} rules={[{ required: true, message: t('lead.customerTypeRequired') }]}>
                    <CustomerTypeSelect placeholder={t('lead.customerTypePlaceholder')} disabled={step0.locked} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={[16, 0]}>
                {/* 左：联系人 + 联系方式 */}
                <Col span={12}>
                  <Form.Item name="contactName" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span>{t('customer.contactName')}</span><UpdatedTag show={customerFieldDiff?.contactName} /></span>} rules={[{ required: true, message: t('customer.contactNameRequired') }]}>
                    <Input placeholder={t('customer.contactNamePlaceholder')} disabled={step0.locked} />
                  </Form.Item>
                  <Form.Item
                    name="contactMethods"
                    rules={[{ required: true, message: t('customer.contactMethodsRequired') }]}
                    label={
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span>{t('customer.contactMethods')}</span>
                          <UpdatedTag show={customerFieldDiff?.contactMethods} />
                        </span>
                        <Button type="link" size="small" onClick={() => contactMethodRef.current?.add()} disabled={step0.locked}>
                          + {t('lead.addContactMethod')}
                        </Button>
                      </div>
                    }
                  >
                    <ContactMethodInput showAddButton={false} toolWidth={120} ref={contactMethodRef} options={commToolOptions} disabled={step0.locked} />
                  </Form.Item>
                </Col>
                {/* 右：来源渠道 */}
                <Col span={12}>
                  <Form.Item name="sourceKey" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span>{t('lead.leadSource')}</span><UpdatedTag show={customerFieldDiff?.sourceKey} /></span>} rules={[{ required: true, message: t('lead.leadSourceRequired') }]}>
                    <ChipSelect options={sourceOptions} size="large" disabled={step0.locked} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          {/* 步骤二：需求详情 */}
          {step === 1 && (
            <Row gutter={[16, 0]}>
              <Col span={24}>
                <Form.Item
                  name="productKey"
                  label={
                    <>
                      <span>{t('lead.product')}</span>
                      {step1.status === 'none' && !step1.locked && (
                        <Tag color="orange" style={{ marginInlineEnd: 0 }}>{t('lead.pendingTag')}</Tag>
                      )}
                      {step1.locked && (
                        <Tag color="green" style={{ marginInlineEnd: 0 }}>{t('lead.filedTag')}</Tag>
                      )}
                    </>
                  }
                  rules={[{ required: true, message: t('lead.productRequired') }]}
                >
                  <AutoComplete
                    allowClear
                    disabled={step1.locked}
                    placeholder={t('lead.productPlaceholder')}
                    options={productNameOptions}
                    filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(String(input ?? '').toLowerCase())}
                    onSelect={(value) => handleProductResolved(String(value))}
                    onBlur={() => handleProductResolved(form.getFieldValue('productKey'))}
                  />
                </Form.Item>
              </Col>
              {/* 产品分类：工艺（多选）+ 受众→品类（级联），必填；位置在采购产品下一行 */}
              <Col span={12}>
                <Form.Item
                  name="craftIds"
                  label={t('lead.craft')}
                  rules={[{ required: !step1.locked, message: t('lead.craftRequired') }]}
                >
                  <Select
                    mode="multiple"
                    allowClear
                    disabled={step1.locked}
                    placeholder={t('lead.craftPlaceholder')}
                    options={craftOptions}
                    maxTagCount="responsive"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="categoryCascade"
                  label={t('lead.audienceCategory')}
                  rules={[
                    { required: !step1.locked, message: t('lead.audienceCategoryRequired') },
                    {
                      validator: (_, value) =>
                        !value || value.length >= 2
                          ? Promise.resolve()
                          : Promise.reject(new Error(t('lead.categoryRequired'))),
                    },
                  ]}
                >
                  <Cascader
                    options={cascadeOptions}
                    disabled={step1.locked}
                    placeholder={t('lead.audienceCategoryPlaceholder')}
                    expandTrigger="hover"
                  />
                </Form.Item>
              </Col>
              {/* 规格：长 / 宽 / 高 / 克重，必填，占一行（级联组件下方） */}
              <Col span={6}>
                <Form.Item
                  name="sizeL"
                  label={t('lead.sizeL')}
                  rules={[{ required: !step1.locked, message: t('lead.sizeRequired') }]}
                >
                  <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} addonAfter="cm" placeholder="0" disabled={step1.locked} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="sizeW"
                  label={t('lead.sizeW')}
                  rules={[{ required: !step1.locked, message: t('lead.sizeRequired') }]}
                >
                  <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} addonAfter="cm" placeholder="0" disabled={step1.locked} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="sizeH"
                  label={t('lead.sizeH')}
                  rules={[{ required: !step1.locked, message: t('lead.sizeRequired') }]}
                >
                  <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} addonAfter="cm" placeholder="0" disabled={step1.locked} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="weight"
                  label={t('lead.weight')}
                  rules={[{ required: !step1.locked, message: t('lead.sizeRequired') }]}
                >
                  <InputNumber min={0} step={0.1} precision={2} style={{ width: '100%' }} addonAfter="g" placeholder="0" disabled={step1.locked} />
                </Form.Item>
              </Col>
              <Col span={12}>
                {/* 数量需求：Input + 单位 Select 用 Space.Compact 组合（antd 6 弃用 addonAfter）。
                    校验规则挂在 noStyle 的内层 Form.Item 上，外层仅负责 label 与布局 */}
                <Form.Item label={t('lead.quantityRequirement')} required className="lead-quantity-item">
                  <Space.Compact style={{ width: '100%' }}>
                    <Form.Item
                      name="quantity"
                      noStyle
                      rules={[{ required: true, message: t('lead.quantityRequired') }]}
                    >
                      <Input
                        style={{ flex: 1, minWidth: 0 }}
                        inputMode="numeric"
                        maxLength={12}
                        placeholder={t('lead.quantityRequirementPlaceholder')}
                        // 仅允许输入非负整数（数量需求）
                        onChange={(e) => form.setFieldsValue({ quantity: e.target.value.replace(/[^\d]/g, '') })}
                      />
                    </Form.Item>
                    <Select
                      value={watchUnit}
                      onChange={(v: string) => form.setFieldsValue({ unit: v })}
                      options={unitOptions}
                      style={{ width: 88 }}
                    />
                  </Space.Compact>
                </Form.Item>
              </Col>
              <Col span={12}>
                {/* 目标价位：统一金额组件（币种 + 金额 + 汇率快照）；币种取系统设置维护的启用币种 */}
                <Form.Item name="targetPrice" label={t('lead.targetPrice')}>
                  <MoneyInput placeholder={t('lead.targetPricePlaceholder')} size="large" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="productDesc" label={t('lead.productDesc')}>
                  <Input.TextArea rows={3} autoComplete="off" placeholder={t('lead.productDescPlaceholder')} disabled={step1.locked} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="expectedDelivery" label={t('lead.expectedDelivery')}>
                  <DatePicker
                    style={{ width: '100%' }}
                    placeholder={t('lead.expectedDeliveryPlaceholder')}
                    disabledDate={(current) => !!current && current < dayjs().startOf('day')}
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item name="images" label={t('lead.attachments')}>
                  <ProductImageList disabled={readonly || step1.locked} allowFiles />
                </Form.Item>
              </Col>
            </Row>
          )}

          {/* 步骤三：确认商机（仅展示需求清单 + 客户/产品建档校验） */}
          {step === 2 && (
            <>
              {/* 溯源：已关联商机 */}
              {(editing?.pipelineId || linkedPipeline) && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  title={
                    <Space>
                      <span>
                        {t('lead.linkedPipeline')}：<b>{linkedPipeline?.opportunityNo || editing?.pipelineId}</b>
                      </span>
                      <Button
                        type="link"
                        size="small"
                        disabled={!editing?.pipelineId && !linkedPipeline?.id}
                        onClick={() => {
                          const id = editing?.pipelineId || linkedPipeline?.id;
                          if (id) navigate(`/sales/opportunities?pipelineId=${id}`);
                          else navigate('/sales/opportunities');
                        }}
                      >
                        {t('lead.viewPipeline')}
                      </Button>
                    </Space>
                  }
                />
              )}

              {/* 确认商机阶段内容与详情「详细信息」一致：上=客户需求（本阶段标题为「需求清单」），下=基本信息。
                  客户 / 产品未建档时展示可点击的「未建档」标签，弹窗建档后方可确认转商机 */}
              {!computeRequirement().allReady && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  title={t('lead.requirementPendingTip')}
                />
              )}
              <div className="lead-wizard-summary">
                <div className="lead-wizard-summary__title">{t('lead.customerReq')}</div>
                {(() => {
                  const v = form.getFieldsValue(true) as Record<string, any>;
                  return (
                    <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', whiteSpace: 'pre-wrap' }}>
                      {v.productDesc || editing?.items?.[0]?.productDesc || editing?.productDesc || '—'}
                    </div>
                  );
                })()}
              </div>
              <div className="lead-wizard-summary" style={{ marginTop: 12 }}>
                {(() => {
                  const req = computeRequirement();
                  const v = req.v;
                  // 客户建档判定：线索已关联客户，或输入的客户在客户列表中存在
                  const customerFiled = req.customerFiled;
                  // 产品建档判定：明细行已关联产品，或输入的产品在产品列表中存在
                  const productFiled = req.productFiled;
                  const rows = [
                    { label: t('lead.fieldLeadNo'), value: editing?.leadNo, required: false },
                    {
                      label: t('lead.customerCompany'),
                      value: v.customerKey,
                      required: true,
                      filed: v.customerKey ? customerFiled : undefined,
                      onFile: () => confirmCreateCustomer(),
                    },
                    {
                      label: t('lead.product'),
                      value: v.productKey,
                      required: true,
                      filed: v.productKey ? productFiled : undefined,
                      onFile: () => confirmCreateProduct(),
                    },
                    { label: t('lead.quantityRequirement'), value: v.quantity != null && v.quantity !== '' && Number(v.quantity) !== 0 ? `${v.quantity}${v.unit || '个'}` : undefined, required: true },
                    { label: t('lead.targetPrice'), value: formatMoneyValue(v.targetPrice, currencies), required: false },
                    {
                      label: t('lead.expectedDelivery'),
                      value: v.expectedDelivery ? dayjs(v.expectedDelivery).format('YYYY-MM-DD') : undefined,
                      required: false,
                    },
                    { label: t('lead.leadSource'), value: sourceOptions.find((o) => o.value === v.sourceKey)?.label, required: true },
                    {
                      label: t('lead.assignee'),
                      value: users.find((u) => u.id === v.ownerId)?.realName || editing?.owner?.realName,
                      required: true,
                      emptyText: t('sales.unassigned'),
                    },
                    { label: t('lead.createdAt'), value: editing?.createdAt?.slice(0, 10), required: false },
                  ];
                  // 逐字段校验状态：pass 通过 / empty 无数据（未明确）/ unfiled 已填但未建档 / info 非必填
                  const rowsWithStatus = rows.map((r) => {
                    if (!r.required) return { ...r, status: 'info' as const };
                    const hasValue = !!(r.value || r.emptyText);
                    if (!hasValue) return { ...r, status: 'empty' as const };
                    if (r.filed === false) return { ...r, status: 'unfiled' as const };
                    return { ...r, status: 'pass' as const };
                  });
                  return (
                    <>
                      <div className="lead-wizard-summary__title">{t('lead.confirmInfo')}</div>
                      {rowsWithStatus.map((row) => (
                        <div key={row.label} className="lead-wizard-summary__row">
                          <span className="lead-wizard-summary__label">{row.label}</span>
                          <span className="lead-wizard-summary__value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {row.filed === true && <Tag color="success" style={{ marginInlineEnd: 0 }}>{t('lead.filedTag')}</Tag>}
                            {row.filed === false && (
                              <Tooltip title={t('lead.unfiledTip')}>
                                <Tag
                                  color="orange"
                                  style={{ marginInlineEnd: 0, cursor: 'pointer' }}
                                  onClick={row.onFile}
                                >
                                  {t('lead.pendingTag')}
                                </Tag>
                              </Tooltip>
                            )}
                            {row.status === 'empty' ? (
                              <Tag color="red" style={{ marginInlineEnd: 0 }}>{t('lead.unspecified')}</Tag>
                            ) : (
                              <span>{row.value || row.emptyText || '—'}</span>
                            )}
                            {row.status === 'pass' && (
                              <CheckCircleOutlined style={{ color: '#52c41a' }} title={t('lead.checkPass')} />
                            )}
                            {row.status === 'empty' && (
                              <CloseCircleOutlined style={{ color: '#ff4d4f' }} title={t('lead.unspecified')} />
                            )}
                            {row.status === 'unfiled' && (
                              <ExclamationCircleOutlined style={{ color: '#faad14' }} title={t('lead.unfiledTip')} />
                            )}
                          </span>
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </AppModal>
      </Form>


      {/* 确认建档：新建产品弹窗（带入待确认产品名到产品名称），允许关闭（取消则回到汇总页 / 线索编辑页） */}
      <ProductEditModal
        ref={productEditRef}
        crafts={crafts}
        audiences={audiences}
        onClose={() => {
          const reject = pendingRejectRef.current;
          pendingRejectRef.current = null;
          pendingResolveRef.current = null;
          reject?.(new Error('cancelled'));
        }}
        onSuccess={handleProductFiled}
      />

      {/* 转商机·待建档清单汇总页（客户/产品均缺失时，逐项打开真实弹窗强制建档） */}
      <ConvertCreateSummaryModal
        open={summaryOpen}
        items={summaryItems}
        onOpenCustomer={openCustomerForm}
        onOpenProduct={openProductForm}
        onCancel={() => {
          setSummaryOpen(false);
          summaryRejectRef.current?.(new Error('cancelled'));
          summaryRejectRef.current = null;
          summaryResolveRef.current = null;
        }}
        onConfirm={(ids) => {
          setSummaryOpen(false);
          const resolve = summaryResolveRef.current;
          summaryResolveRef.current = null;
          summaryRejectRef.current = null;
          resolve?.(ids);
        }}
      />
    </>
  );
});

export default LeadFormModal;
