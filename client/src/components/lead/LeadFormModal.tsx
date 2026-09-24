import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Alert,
  AutoComplete,
  Button,
  DatePicker,
  Form,
  Input,
  Row,
  Col,
  Select,
  Space,
  Tag,
  Modal,
} from 'antd';
import dayjs from 'dayjs';
import { CheckOutlined, SwapOutlined, RollbackOutlined, CloseOutlined, UserAddOutlined, ArrowLeftOutlined, ArrowRightOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import AppModal from '../AppModal';
import CountrySelect, { findCountry } from '../CountrySelect';
import CustomerTypeSelect from '../CustomerTypeSelect';
import CustomerFormModal from '../customer/modals/CustomerFormModal';
import { ProductEditModal, type ProductEditModalHandle } from '../product/modals/ProductEditModal';
import ConvertCreateSummaryModal from './ConvertCreateSummaryModal';
import TransferOwnerModal from '../common/TransferOwnerModal';
import { type Channel } from '../../api/channel';
import { type Customer } from '../../api/customers';
import { leadApi, type Lead, type LeadPayload } from '../../api/lead';
import { salesApi, type SalesItem } from '../../api/sales';
import { type Product, type ProductAudience, type ProductCraft, type ProductOption } from '../../api/products';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUserStore } from '../../stores/useUserStore';
import { useReleaseToPool } from '../../hooks/useReleaseToPool';
import ChipSelect from '../common/ChipSelect';
import { convertLeadToOpportunity } from '../../utils/convertLead';
import type { CustomerOption } from './useLeadOptions';
import ProductImageList from '../common/ProductImageList';
import ContactMethodInput, { type ContactMethodHandle } from '../common/ContactMethodInput';
import MoneyInput, { formatMoneyValue, currentRateOf, type MoneyValue } from '../common/MoneyInput';
import { useCommToolOptions } from '../../stores/useCommToolStore';
import { useUnitOptions } from '../../stores/useUnitStore';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { parseImages, serializeImages, type ProductImageItem } from '../../utils/productImages';

export interface LeadFormModalHandle {
  openCreate: () => void;
  openEdit: (record: Lead) => void;
}

// 三步向导各步骤包含的表单字段（「下一步」仅校验当前步骤字段）
const STEP_FIELDS: string[][] = [
  ['customerKey', 'targetMarket', 'customerType', 'sourceKey', 'contactName', 'contactMethods'],
  ['productKey', 'quantity', 'targetPrice', 'productDesc', 'images', 'expectedDelivery'],
  ['ownerId'],
];

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
  /** 保存 / 关联成功后刷新列表 */
  onSaved: () => void;
}

/**
 * 线索新建 / 编辑 / 详情弹窗：三步向导（客户信息 → 需求详情 → 分配跟进）。
 * Form 包裹整个弹窗，字段沿用原有逻辑，按步骤分组校验后统一提交。
 */
const LeadFormModal = forwardRef<LeadFormModalHandle, Props>((props, ref) => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const releaseToPool = useReleaseToPool();
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
  // 三步向导当前步骤（0 客户信息 / 1 需求详情 / 2 分配跟进）
  const [step, setStep] = useState(0);
  const [linkedPipeline, setLinkedPipeline] = useState<SalesItem | null>(null);
  const navigate = useNavigate();
  const [transferOpen, setTransferOpen] = useState(false);
  // 确认建档：新建客户弹窗（带入待确认客户名到公司名称）
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [initialCustName, setInitialCustName] = useState('');
  const productEditRef = useRef<ProductEditModalHandle>(null);
  // 联系方式「新增」按钮放在 Form.Item label 旁时，用 ref 触发组件内部 add()
  const contactMethodRef = useRef<ContactMethodHandle>(null);
  // 转商机强制建档时，保存待解锁的 Promise（弹窗保存后 resolve 出新记录 id）
  const pendingResolveRef = useRef<((v: { id: string }) => void) | null>(null);
  // 新建客户弹窗是否处于强制建档模式（隐藏取消按钮）
  const [custForceMode, setCustForceMode] = useState(false);
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
  const watchOwnerId = Form.useWatch('ownerId', form);
  const watchUnit = Form.useWatch('unit', form);

  // 线索来源选项：来源渠道 + 来源平台由前端拼接为一个 JSON（{ channelId, shopId }）作为选项值；
  // 无子平台的渠道兜底 shopId = 渠道自身 ID（与原「平台下拉兜底渠道本身」逻辑一致）
  const sourceOptions = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    channels.forEach((c) => {
      const children = c.children || [];
      if (!children.length) {
        list.push({ label: c.name, value: JSON.stringify({ channelId: c.id, shopId: c.id }) });
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

  const customerNameOptions = useMemo(
    () =>
      customerOptions.map((c) => ({
        value: c.label,
        label: [c.label, c.contactName].filter(Boolean).join(' · '),
      })),
    [customerOptions],
  );

  const productNameOptions = useMemo(
    () => productOptions.map((p) => ({ label: p.name, value: p.name })),
    [productOptions],
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

  // ============ 三步向导 ============
  const wizardSteps = [t('lead.stepCustomer'), t('lead.stepRequirement'), t('lead.stepConfirm')];

  const goNext = async () => {
    // 联系方式是自定义组件，字段级校验单独触发（沟通工具 / 账号分开判定）
    if (step === 0 && !validateContactMethods()) return;
    try {
      // 仅校验当前步骤字段，通过后进入下一步
      await form.validateFields(STEP_FIELDS[step]);
      setStep((s) => Math.min(s + 1, wizardSteps.length - 1));
    } catch {
      /* 校验失败停留在当前步，错误提示由 Form.Item 展示 */
    }
  };

  const goPrev = () => setStep((s) => Math.max(s - 1, 0));

  // ============ 打开 / 提交 ============
  const openCreate = () => {
    setEditing(null);
    setLinkedPipeline(null);
    setStep(0);
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
  };

  const openEdit = async (record: Lead) => {
    setEditing(record);
    setLinkedPipeline(null);
    setStep(0);
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
        // 线索来源：后端 channel/shop 关系（ID）拼接回 JSON
        sourceKey: item.channel?.id
          ? JSON.stringify({ channelId: item.channel.id, shopId: item.shop?.id || item.channel.id })
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
        // 目标价位：金额组件值（币种 + 金额 + 汇率快照）；汇率缺失时用当前汇率补齐
        targetPrice: {
          currency: item.currency ?? 'CNY',
          amount: item.targetPrice != null && item.targetPrice !== '' ? Number(item.targetPrice) || null : null,
          exchangeRate:
            item.targetPriceRate != null
              ? Number(item.targetPriceRate) || currentRateOf(item.currency ?? 'CNY', rates)
              : currentRateOf(item.currency ?? 'CNY', rates),
        } as MoneyValue,
        expectedDelivery: item.expectedDelivery ? dayjs(item.expectedDelivery) : undefined,
        customerType: item.customerType || undefined,
        // 参考图片：回填 Attachment(ownerType=LEAD) 记录
        images: item.attachments && item.attachments.length
          ? serializeImages(item.attachments.map((a) => ({ url: a.url, name: a.name || '' })))
          : '',
      });
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

  const submit = async () => {
    // 联系方式：字段级校验（工具 / 账号分开判定），不通过时回到第 1 步展示飘红
    if (!validateContactMethods()) {
      setStep(0);
      return;
    }
    // 校验当前挂载的字段；取值必须用 getFieldsValue(true)：
    // validateFields() 只返回当前已挂载（本步骤）字段，之前步骤的字段因条件渲染已卸载，
    // 但 preserve 仍保留在 store 中，需全量取回，否则提交时前序步骤值为 null。
    await form.validateFields();
    const values = form.getFieldsValue(true) as Record<string, any>;
    // 客户：可手输新客户名，或下拉选择已有客户；手输新名仅存文本，确认后才会建档
    let customerId: string | null = null;
    let companyName: string | undefined;
    const customerName = values.customerKey?.trim();
    if (customerName) {
      const matched = customerOptions.find((c) => c.label === customerName);
      if (matched) {
        customerId = matched.value;
      } else {
        companyName = customerName;
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
    const payload: LeadPayload = {
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
      // 负责人在弹窗标题栏（Form.Item 注册字段），随 validateFields 一并取回
      ownerId: values.ownerId || null,
      // 详情扩展字段
      targetMarket: values.targetMarket || null,
      productType: values.productType || null,
      productDesc: values.productDesc || null,
      // 目标价位：金额组件固定输出 { currency, amount, exchangeRate }，其中汇率随金额一起落库，
      // 后续展示 / 币种切换都以该快照汇率计算，不再取实时汇率
      targetPrice: values.targetPrice?.amount != null ? String(values.targetPrice.amount) : null,
      currency: values.targetPrice?.currency ?? null,
      targetPriceRate: values.targetPrice?.exchangeRate ?? null,
      expectedDelivery: values.expectedDelivery
        ? dayjs.isDayjs(values.expectedDelivery)
          ? values.expectedDelivery.toISOString()
          : new Date(values.expectedDelivery).toISOString()
        : null,
      customerType: values.customerType || null,
      // 参考图片：对象数组（url + name），后端转为 Attachment(ownerType=LEAD) 记录
      images: parseImages(values.images).map((i) => ({ url: i.url, name: i.name })),
    };
    try {
      if (editing?.id) {
        await leadApi.update(editing.id, payload);
        message.success(t('common.updateSuccess'));
      } else {
        await leadApi.create(payload);
        message.success(t('common.createSuccess'));
      }
      setDrawerOpen(false);
      onSaved();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // 未建档客户：弹出「新建客户」弹窗（与客户页一致），保存后 resolve 新 id
  const openCustomerForm = (initial?: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
  }) =>
    new Promise<{ id: string }>((resolve) => {
      pendingResolveRef.current = resolve;
      setCustForceMode(true);
      const { companyName } = initial || {};
      setInitialCustName(companyName ?? '');
      setCustModalOpen(true);
    });

  // 未建档产品：弹出「新建产品」弹窗（与产品页一致），保存后 resolve 新 id
  // 线索参考图（即产品图）一并带入新建产品弹窗，仅写入产品表
  const openProductForm = (initial?: { name?: string; description?: string; images?: ProductImageItem[] }) =>
    new Promise<{ id: string }>((resolve) => {
      pendingResolveRef.current = resolve;
      const { name, description, images } = initial || {};
      productEditRef.current?.open(undefined, { name, description, images }, true);
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

  // 释放线索（私海 → 公海）：弹窗二次确认后执行（与客户释放同一套确认逻辑）
  const handleReleaseLead = () => {
    if (!editing) return;
    releaseToPool({
      name: editing.leadName || editing.companyName || '',
      action: () => leadApi.release(editing.id),
      onSuccess: () => onSaved?.(),
    });
  };

  // 转交线索（联动客户/产品负责人）：提交逻辑由公共转交组件驱动
  const handleTransferLead = async (newOwnerId: string) => {
    if (!editing) return;
    await leadApi.transfer(editing.id, newOwnerId);
    setTransferOpen(false);
    onSaved?.();
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

  // ============ 确认建档 ============
  // 走「新建客户 / 新建产品」弹窗，带入待确认的名称，由用户在弹窗中补全并确认后创建
  // 客户 / 产品「未建档」标签点击：优先用已保存记录的名称，回退到当前表单输入值
  const confirmCreateCustomer = () => {
    if (readonly) return;
    const name = editing?.companyName || watchCustomerKey;
    if (!name) return;
    setInitialCustName(name);
    setCustModalOpen(true);
  };

  const confirmCreateProduct = () => {
    if (readonly) return;
    const name = editing?.items?.[0]?.productName || watchProductKey;
    if (!name) return;
    productEditRef.current?.open(null, { name });
  };

  // 新建客户弹窗保存成功后：转商机流程则解锁 Promise；否则关联到当前线索
  const handleCustomerFiled = async (customer?: Customer) => {
    if (!customer?.id) return;
    if (pendingResolveRef.current) {
      const resolve = pendingResolveRef.current;
      pendingResolveRef.current = null;
      setCustForceMode(false);
      setCustModalOpen(false);
      resolve({ id: customer.id });
      refreshEditing();
      return;
    }
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

  // 新建模式（无真实线索 id）下，转交/释放/确认等仅对已有线索的操作不可用
  const isCreate = !editing?.id;
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
                    onClick={i < step ? () => setStep(i) : undefined}
                    style={i < step ? { cursor: 'pointer' } : undefined}
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
                {step === 1 ? (
                  <>
                    <Button size="large" className="lead-ghost-btn" onClick={submit}>{t('lead.keepAsLead')}</Button>
                    <Button size="large" type="primary" onClick={goNext}>
                      {t('lead.nextStep')} <ArrowRightOutlined />
                    </Button>
                  </>
                ) : step < wizardSteps.length - 1 ? (
                  <Button size="large" type="primary" onClick={goNext}>
                    {t('lead.nextStep')} <ArrowRightOutlined />
                  </Button>
                ) : (
                  <>
                    {/* 公海线索：仅可认领，确认（转商机）不可用 */}
                    {isPoolLead && (
                      <Button size="large" type="primary" icon={<UserAddOutlined />} onClick={handleClaimLead}>
                        {t('lead.claim')}
                      </Button>
                    )}
                    {/* 已建档线索：最终步提供「确认」（转商机），样式与保存一致（primary） */}
                    {editing?.id && !readonly && !isPoolLead && editing.status === 'NEW' && (
                      <Button size="large" type="primary" onClick={handleConfirmLead}>
                        {t('lead.confirmLead')}
                      </Button>
                    )}
                    {/* 新建线索：最终步以「确认」提交（样式与保存一致），不再单独显示「保存」按钮 */}
                    {!editing?.id && (
                      <Button size="large" type="primary" icon={<CheckOutlined />} onClick={submit}>{t('lead.confirmRequirement')}</Button>
                    )}
                  </>
                )}
              </div>
            </div>
          }
        >
          {/* 负责人：步骤三以卡片选择，此处保留隐藏字段以便提交时携带 ownerId */}
          <Form.Item name="ownerId" hidden>
            <Input />
          </Form.Item>
          {/* 单位：随数量需求后缀展示，隐藏字段以便提交时携带（币种已并入目标价位金额组件） */}
          <Form.Item name="unit" hidden>
            <Input />
          </Form.Item>

          {/* 步骤一：客户信息 */}
          {step === 0 && (
            <Row gutter={[16, 0]}>
              <Col span={24}>
                <Form.Item
                  name="customerKey"
                  label={
                    (editing?.companyName && !editing.customerId) ||
                    (watchCustomerKey && !customerOptions.some((c) => c.label === watchCustomerKey)) ? (
                      <Space size={4}>
                        <span>{t('lead.customerCompany')}</span>
                        <Tag
                          color="orange"
                          style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                          onClick={confirmCreateCustomer}
                          title={t('lead.customerPendingTip', { name: editing?.companyName || watchCustomerKey })}
                        >
                          {t('lead.pendingTag')}
                        </Tag>
                      </Space>
                    ) : (
                      t('lead.customerCompany')
                    )
                  }
                  rules={[{ required: true, message: t('lead.customerRequired') }]}
                >
                  <AutoComplete
                    allowClear
                    placeholder={t('lead.customerPlaceholder')}
                    options={customerNameOptions}
                    filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(String(input ?? '').toLowerCase())}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="targetMarket" label={t('lead.targetMarket')} rules={[{ required: true, message: t('lead.targetMarketRequired') }]}>
                  <CountrySelect placeholder={t('lead.targetMarketPlaceholder')} size="large" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="customerType" label={t('lead.customerType')} rules={[{ required: true, message: t('lead.customerTypeRequired') }]}>
                  <CustomerTypeSelect placeholder={t('lead.customerTypePlaceholder')} size="large" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="contactName" label={t('lead.contactName')} rules={[{ required: true, message: t('lead.contactRequired') }]}>
                  <Input placeholder={t('lead.contactPlaceholder')} size="large" />
                </Form.Item>
                <Form.Item
                  name="contactMethods"
                  label={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span>{t('lead.contactMethods')}</span>
                      <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => contactMethodRef.current?.add()}
                        style={{ padding: 0, height: 'auto' }}
                      >
                        {t('lead.addContactMethod')}
                      </Button>
                    </span>
                  }
                  required
                  // 校验交由 ContactMethodInput 内部按字段处理（工具 / 账号分开判定，有值即清除飘红），
                  // 此处不再挂 rules，避免与组件内提示重复飘红
                >
                  <ContactMethodInput ref={contactMethodRef} options={commToolOptions} size="large" compact showAddButton={false} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="sourceKey" label={t('lead.leadSource')} rules={[{ required: true, message: t('lead.leadSourceRequired') }]}>
                  <ChipSelect options={sourceOptions} columns={2} size="large" />
                </Form.Item>
              </Col>
            </Row>
          )}

          {/* 步骤二：需求详情 */}
          {step === 1 && (
            <Row gutter={[16, 0]}>
              <Col span={24}>
                <Form.Item
                  name="productKey"
                  label={
                    (editing?.items?.[0]?.productName && !editing?.items?.[0]?.productId) ||
                    (watchProductKey && !productNameOptions.some((p) => p.label === watchProductKey)) ? (
                      <Space size={4}>
                        <span>{t('lead.product')}</span>
                        <Tag
                          color="orange"
                          style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                          onClick={confirmCreateProduct}
                          title={t('lead.productPendingTip', { name: editing?.items?.[0]?.productName || watchProductKey })}
                        >
                          {t('lead.pendingTag')}
                        </Tag>
                      </Space>
                    ) : (
                      t('lead.product')
                    )
                  }
                  rules={[{ required: true, message: t('lead.productRequired') }]}
                >
                  <AutoComplete
                    allowClear
                    placeholder={t('lead.productPlaceholder')}
                    options={productNameOptions}
                    filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(String(input ?? '').toLowerCase())}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="quantity"
                  label={t('lead.quantityRequirement')}
                  rules={[{ required: true, message: t('lead.quantityRequired') }]}
                  className="lead-quantity-item"
                >
                  <Input
                    style={{ width: '100%' }}
                    inputMode="numeric"
                    maxLength={12}
                    placeholder={t('lead.quantityRequirementPlaceholder')}
                    // 仅允许输入非负整数（数量需求）
                    onChange={(e) => form.setFieldsValue({ quantity: e.target.value.replace(/[^\d]/g, '') })}
                    addonAfter={
                      <Select
                        size="small"
                        value={watchUnit}
                        onChange={(v: string) => form.setFieldsValue({ unit: v })}
                        options={unitOptions}
                        style={{ width: 72 }}
                      />
                    }
                  />
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
                  <Input.TextArea rows={3} autoComplete="off" placeholder={t('lead.productDescPlaceholder')} />
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
                  <ProductImageList disabled={readonly} allowFiles />
                </Form.Item>
              </Col>
            </Row>
          )}

          {/* 步骤三：分配跟进 */}
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

              {/* 分配给：负责人头像卡片（点击回写 ownerId 隐藏字段） */}
              <div className="lead-wizard-block">
                <div className="lead-wizard-block__title">{t('lead.assignTo')}</div>
                {!isPoolLead && (
                  <div className="lead-wizard-owner-grid">
                    {users.map((u, idx) => {
                      const active = watchOwnerId === u.id;
                      return (
                        <button
                          type="button"
                          key={u.id}
                          className={`lead-wizard-owner-card${active ? ' is-active' : ''}`}
                          disabled={readonly}
                          onClick={() => form.setFieldsValue({ ownerId: u.id })}
                        >
                          <span
                            className="lead-wizard-owner-card__avatar"
                            style={{ background: OWNER_COLORS[idx % OWNER_COLORS.length] }}
                          >
                            {(u.realName || u.username || '?')[0]}
                          </span>
                          <span className="lead-wizard-owner-card__meta">
                            <span className="lead-wizard-owner-card__name">{u.realName || u.username}</span>
                            <span className="lead-wizard-owner-card__desc">{u.username}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* 转交 / 释放（仅已有线索展示，新建时隐藏） */}
                {!isCreate && (
                  <Space size={8} style={{ marginTop: 10 }}>
                    <Button size="small" icon={<SwapOutlined />} disabled={readonly} onClick={() => setTransferOpen(true)}>
                      {t('lead.transfer')}
                    </Button>
                    {editing?.ownerId && (
                      <Button size="small" icon={<RollbackOutlined />} disabled={readonly} onClick={handleReleaseLead}>
                        {t('lead.release')}
                      </Button>
                    )}
                  </Space>
                )}
              </div>

              {/* 需求清单摘要：直接读取表单 store，确保前序步骤卸载但 preserve 保留的值仍正确回填 */}
              <div className="lead-wizard-summary">
                <div className="lead-wizard-summary__title">{t('lead.confirmInfo')}</div>
                {(() => {
                  const v = form.getFieldsValue(true) as Record<string, any>;
                  return [
                    { label: t('lead.customerCompany'), value: v.customerKey },
                    { label: t('lead.targetMarket'), value: v.targetMarket },
                    { label: t('lead.product'), value: v.productKey },
                    { label: t('lead.quantityRequirement'), value: v.quantity != null ? `${v.quantity}${v.unit || ''}` : undefined },
                    { label: t('lead.targetPrice'), value: formatMoneyValue(v.targetPrice, currencies) },
                    { label: t('lead.leadSource'), value: sourceOptions.find((o) => o.value === v.sourceKey)?.label },
                    {
                      label: t('lead.assignee'),
                      value: users.find((u) => u.id === v.ownerId)?.realName || editing?.owner?.realName || t('sales.unassigned'),
                    },
                  ].map((row) => (
                    <div key={row.label} className="lead-wizard-summary__row">
                      <span className="lead-wizard-summary__label">{row.label}</span>
                      <span className="lead-wizard-summary__value">{row.value || '—'}</span>
                    </div>
                  ));
                })()}
              </div>
            </>
          )}
        </AppModal>
      </Form>

      {/* 确认建档：新建客户弹窗（带入待确认客户名到公司名称） */}
      <CustomerFormModal
        open={custModalOpen}
        editingCustomer={null}
        initialCompanyName={initialCustName}
        initialCountry={editing?.country ? findCountry(editing.country)?.zh : undefined}
        force={custForceMode}
        onClose={() => setCustModalOpen(false)}
        onSuccess={handleCustomerFiled}
      />

      {/* 确认建档：新建产品弹窗（带入待确认产品名到产品名称） */}
      <ProductEditModal
        ref={productEditRef}
        crafts={crafts}
        audiences={audiences}
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

      {/* 转交线索：选择新负责人（与客户共用同一组件 / 逻辑） */}
      <TransferOwnerModal
        open={transferOpen}
        targetName={editing?.leadName || editing?.companyName}
        currentOwnerId={editing?.ownerId ?? undefined}
        title={t('lead.transfer')}
        placeholder={t('lead.selectTransferTarget')}
        successMessage={t('lead.transferSuccess')}
        onTransfer={handleTransferLead}
        onClose={() => setTransferOpen(false)}
      />
    </>
  );
});

export default LeadFormModal;
