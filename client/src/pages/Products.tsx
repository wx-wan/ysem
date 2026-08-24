import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button, Space, Input, Modal, Form, Select, Radio, Segmented,
  Tag, Popconfirm, App, Card, Row, Col, Typography, Divider, Pagination, Spin, Tooltip,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  ReloadOutlined, CheckCircleFilled, ArrowLeftOutlined, UploadOutlined,
  CloseOutlined, ClockCircleOutlined, ShoppingOutlined,
  FileTextOutlined, InfoCircleOutlined, TeamOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory, ProductActivity,
  MixedItem, taxonomyApi, quoteApi, sampleApi, productGroupApi,
} from '../api/products';
import { certificateApi, Certificate } from '../api/certificates';
import { userApi } from '../api/users';
import { salesApi, SalesItem, STAGE_META } from '../api/sales';
import ProductImageList from '../components/common/ProductImageList';
import { getProgressPhase, STATUS_TAG_COLOR } from '../components/common/ProductProgress';
import { buildTablePagination } from '../components/common/tablePagination';
import { StepBar } from '../components/common/StepBar';
import { useCardGutter } from '../components/common/tokens';
import ViewModeSwitch from '../components/common/ViewModeSwitch';
import ProductList from '../components/product/list/ProductList';
import ProductCard from '../components/product/cards/ProductCard';
import ProductGroupCard from '../components/product/cards/ProductGroupCard';
import ProductGroupManageModal from '../components/product/ProductGroupManageModal';
import { useAuthStore } from '../stores/useAuthStore';
import ProductDetailModal from '../components/product/modals/ProductDetailModal';
import BatchCreateProductModal from '../components/product/modals/BatchCreateProductModal';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import {
  listCacheKey, getListCache, setListCache,
  setDetailCache, installCacheLifecycle, invalidateAll,
} from '../utils/productCache';

const { Text } = Typography;

// 类名拼接工具
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// 供货模式按角色可选范围：admin 全选 / purchaser 含深度定制+轻定制+现货 / 其他（业务等）默认深度定制、不可修改
const SUPPLY_MODES_BY_ROLE: Record<string, string[]> = {
  admin: ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'STOCK'],
  purchaser: ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'STOCK'],
};
const DEFAULT_SUPPLY_MODE = 'DEEP_CUSTOM';

export default function Products() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const cardGutter = useCardGutter();
  const [list, setList] = useState<MixedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(8);
  const [loading, setLoading] = useState(false);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();
  const [filterCraftId, setFilterCraftId] = useState<string | undefined>();
  const [filterAudienceId, setFilterAudienceId] = useState<string | undefined>();
  const [filterVisibility, setFilterVisibility] = useState<string | undefined>();
  const [filterUnit, setFilterUnit] = useState<string | undefined>();
  // 列表内类型筛选：全部 / 产品 / 组合（同列表混排）
  const [filterType, setFilterType] = useState<'ALL' | 'PRODUCT' | 'GROUP'>('ALL');

  // 用户列表（用于「不公开」产品指定可见人）
  const [users, setUsers] = useState<{ id: string; username: string; realName?: string }[]>([]);
  const userMap = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u])),
    [users],
  );

  // 分类下拉数据
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | undefined>();

  // 弹窗/表单
  const [open, setOpen] = useState(false);
  // 新建流程中已添加（待成组）的单品；非空即表示正在组合多个单品
  const [pendingProducts, setPendingProducts] = useState<{ id: string; name: string; sku: string }[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [salesList, setSalesList] = useState<SalesItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [form] = Form.useForm();
  // 供货方式（单品/组合）：切换按钮，新建产品弹窗内直接选择
  const productTypeWatch = Form.useWatch('productType', form) as 'PRODUCT' | 'GROUP' | undefined;
  const visValue = Form.useWatch('visibility', form) as 'PUBLIC' | 'PRIVATE' | undefined;
  const visibleUserIds = Form.useWatch('visibleUserIds', form) as string[] | undefined;
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [certificates, setCertificates] = useState<Certificate[]>([]);

  // 当前用户角色 → 供货模式可选范围（admin 全选 / purchaser 轻定制+现货 / 其他默认深度定制）
  const { user: currentUser } = useAuthStore();
  const roleCode = currentUser?.role?.code ?? '';
  const canDelete = roleCode === 'admin' || roleCode === 'ADMIN';
  const allowedSupplyModes = SUPPLY_MODES_BY_ROLE[roleCode] ?? [DEFAULT_SUPPLY_MODE];
  const supplyModesReadOnly = allowedSupplyModes.length <= 1; // 仅一个可用项（业务等）→ 不可修改

  // 弹窗层级栈：detail → edit → step。用于判断「整组弹窗都关完」时才回源刷新列表。
  const modalStack = useRef<('detail' | 'edit' | 'step')[]>([]);
  const pushLayer = (layer: 'detail' | 'edit' | 'step') => {
    if (!modalStack.current.includes(layer)) modalStack.current.push(layer);
  };
  // 关闭某一层：先出栈，若栈变空（最底层详情关闭 / 从最上层一路关到底）则刷新列表
  const popLayer = (layer: 'detail' | 'edit' | 'step') => {
    modalStack.current = modalStack.current.filter((l) => l !== layer);
    if (modalStack.current.length === 0) fetchList();
  };
  const closeEdit = () => { popLayer('edit'); cleanupPending(); setOpen(false); };
  const closeDetail = () => { popLayer('detail'); setDetailOpen(false); };

  // 基于此产品创建报价（真实报价单接口，基于单品）
  const handleCreateQuote = async (record: Product) => {
    try {
      const res = await quoteApi.create({ targetType: 'PRODUCT', targetId: record.id, title: `${record.name} 报价单` });
      if (res.data?.data) {
        message.success('报价单已创建');
        closeDetail();
        navigate(`/sales?productId=${record.id}`);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '创建报价单失败');
    }
  };
  // 基于此产品申请打样（真实打样申请接口，基于单品）
  const handleApplySample = async (record: Product) => {
    try {
      const res = await sampleApi.apply({ targetType: 'PRODUCT', targetId: record.id });
      if (res.data?.data) {
        message.success('打样申请已提交');
        closeDetail();
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '提交打样申请失败');
    }
  };

  // 打开产品详情：重置 Tab、拉取完整产品（含操作记录）并加载销售记录
  const openDetail = (r: Product) => {
    setViewing(r);
    pushLayer('detail');
    setDetailOpen(true);
    loadUsers();
    // 拉取完整产品详情，确保 activities（操作记录）等字段齐全
    productApi.getById(r.id)
      .then((res) => {
        const full = (res.data as any)?.data ?? res.data;
        if (full) setViewing(full);
      })
      .catch(() => {});
    setSalesLoading(true);
    salesApi.listByProduct(r.id)
      .then((res) => {
        if (res.data?.data?.list) setSalesList(res.data.data.list);
        else setSalesList([]);
      })
      .catch(() => setSalesList([]))
      .finally(() => setSalesLoading(false));
  };

  const fetchList = useCallback(async () => {
    const query = {
      page, pageSize, keyword: keyword || undefined,
      craftIds: filterCraftId,
      audienceId: filterAudienceId,
      visibility: filterVisibility,
      unit: filterUnit,
      type: filterType,
    };
    const key = listCacheKey(query);
    const cached = getListCache(key);
    if (cached) {
      setList(cached.list);
      setTotal(cached.total);
      setLoading(false);
      // 缓存命中后仍在后台静默回源，保证数据新鲜
      Promise.resolve().then(async () => {
        try {
          const res = await productApi.getMixed(query);
          if (res.data.code === 200 || res.data.code === 0) {
            setListCache(key, { list: res.data.data.list, total: res.data.data.total });
            setList(res.data.data.list);
            setTotal(res.data.data.total);
          }
        } catch { /* 静默 */ }
      });
      return;
    }

    setLoading(true);
    try {
      const res = await productApi.getMixed(query);
      if (res.data.code === 200 || res.data.code === 0) {
        setListCache(key, { list: res.data.data.list, total: res.data.data.total });
        setList(res.data.data.list);
        setTotal(res.data.data.total);
      }
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [page, pageSize, keyword, filterCraftId, filterAudienceId, filterVisibility, filterType]);

  const fetchTaxonomy = async () => {
    try {
      const [cRes, aRes] = await Promise.all([
        taxonomyApi.getCrafts(),
        taxonomyApi.getAudiences(),
      ]);
      if (cRes.data.code === 200 || cRes.data.code === 0) setCrafts(cRes.data.data);
      if (aRes.data.code === 200 || aRes.data.code === 0) setAudiences(aRes.data.data);
    } catch {}
  };

  const fetchCertificates = async () => {
    try {
      const res = await certificateApi.list();
      if (res.data.code === 200 || res.data.code === 0) setCertificates(res.data.data);
    } catch {}
  };

  useEffect(() => { fetchTaxonomy(); }, []);
  useEffect(() => { fetchCertificates(); }, []);
  useEffect(() => { installCacheLifecycle(); }, []);
  useEffect(() => { fetchList(); }, [page, filterCraftId, filterAudienceId, filterVisibility, filterType]);

  // 受众变化时联动品类
  const handleAudienceChange = (audienceId?: string) => {
    setSelectedAudienceId(audienceId);
    if (audienceId) {
      const aud = audiences.find((a) => a.id === audienceId);
      setCategories(aud?.categories || []);
      // 回填/联动时：仅当当前品类不属于新受众的品类列表时才清空（aud 未加载时保留现值）
      try {
        const cur = form.getFieldValue('categoryId');
        if (cur && aud && !aud.categories?.some((c) => c.id === cur)) form.setFieldValue('categoryId', undefined);
      } catch { /* 主表单未挂载时忽略 */ }
    } else {
      setCategories([]);
      try { form.setFieldValue('categoryId', undefined); } catch { /* 主表单未挂载时忽略 */ }
    }
  };

  // 第一步卡片式选择的状态
  const [batchOpen, setBatchOpen] = useState(false);
  // 组合管理弹窗
  const [groupManageId, setGroupManageId] = useState<string | null>(null);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [stepOpen, setStepOpen] = useState(false);
  const [stepCrafts, setStepCrafts] = useState<ProductCraft[]>([]);
  const [stepAudience, setStepAudience] = useState<ProductAudience | undefined>();
  const [stepCategory, setStepCategory] = useState<ProductCategory | undefined>();
  // 从编辑弹窗「返回选择」时，暂存未提交的表单值与编辑态，重选后恢复
  const draftRef = useRef<{ values: Record<string, unknown>; editing: Product | null } | null>(null);
  const [stepErr, setStepErr] = useState<{ craftId?: string; audienceId?: string; categoryId?: string }>({});

  // SKU 自动预览：按「工艺-受众-序号」实时请求后端生成，无需人工录入
  const [skuPreview, setSkuPreview] = useState<string>('');
  const watchedCraftIds = Form.useWatch('craftIds', form);
  const watchedAudienceId = Form.useWatch('audienceId', form);
  const watchedCategoryId = Form.useWatch('categoryId', form);
  useEffect(() => {
    const craftsKey = (watchedCraftIds ?? []).map(String).sort().join(',');
    const audId = watchedAudienceId as string | undefined;
    if (!craftsKey || !audId) { setSkuPreview(''); return; }
    // 编辑模式且工艺/受众未变化：保留原 SKU，不重新请求（避免序号 +1）
    if (editing) {
      const origCraftsKey = (editing.crafts ?? []).map((c) => c.id).sort().join(',');
      if (craftsKey === origCraftsKey && audId === editing.audienceId) {
        setSkuPreview(editing.sku || '');
        return;
      }
    }
    const t = setTimeout(async () => {
      try {
        const res = await productApi.skuPreview({ craftIds: craftsKey, audienceId: audId, excludeId: editing?.id });
        const d = res.data?.data;
        setSkuPreview(d?.sku || '');
      } catch { /* 预览失败静默，保存时由后端生成 */ }
    }, 300);
    return () => clearTimeout(t);
  }, [watchedCraftIds, watchedAudienceId, editing]);

  const resetStep = () => {
    setStepCrafts([]);
    setStepAudience(undefined);
    setStepCategory(undefined);
    setStepErr({});
    setCategories([]);
    setSelectedAudienceId(undefined);
  };

  // 已选工艺排序：左移 / 右移（顺序即提交时 craftIds 顺序）
  const moveCraft = (index: number, dir: -1 | 1) => {
    setStepCrafts((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  // 移除单个已选工艺
  const removeCraft = (id: string) => {
    setStepCrafts((prev) => prev.filter((s) => s.id !== id));
    setStepErr((e) => ({ ...e, craftId: undefined }));
  };

  // 打开「新建」：直接进入 选分类 → 新建产品页（不再选择 单品/组合，组合由连续添加单品体现）
  const openCreate = () => {
    setPendingProducts([]);
    setEditing(null);
    resetStep();
    pushLayer('step');
    setStepOpen(true);
  };

  const handleStepNext = async () => {
    const v = {
      // craftIds 按系统排序（taxonomy 列表已按 sort 升序返回）
      craftIds: crafts.filter((c) => stepCrafts.some((s) => s.id === c.id)).map((c) => c.id),
      audienceId: stepAudience?.id,
      categoryId: stepCategory?.id,
    };
    const err: typeof stepErr = {};
    if (!v.craftIds.length) err.craftId = '请选择工艺';
    if (!v.audienceId) err.audienceId = '请选择受众';
    // 仅当受众下存在品类时才要求选择品类
    if (selectedAudienceId && categories.length > 0 && !v.categoryId) err.categoryId = '请选择品类';
    setStepErr(err);
    if (Object.keys(err).length) return; // 校验失败：停留在第一步

    setStepOpen(false);
    popLayer('step');
    const draft = draftRef.current;
    if (draft?.editing) {
      // 从编辑弹窗「返回重选」后回到编辑：保留未提交值与编辑态，仅用重选的工艺/品类覆盖
      pushLayer('edit');
      setOpen(true);
      form.resetFields();
      const resumeSupply = Array.isArray(draft.values.supplyModes) && (draft.values.supplyModes as string[]).length
        ? (draft.values.supplyModes as string[])[0]
        : allowedSupplyModes[0];
      form.setFieldsValue({
        ...draft.values,
        ...v,
        supplyModes: resumeSupply,
      });
    } else {
      // 新建流程：正常初始化
      setEditing(null);
      pushLayer('edit');
      setOpen(true);
      // 主表单 Modal 已 forceRender，form 常驻连接，可直接初始化
      form.resetFields();
      form.setFieldsValue({
        ...v,
        // 新建默认：管理员/采购取首个可用模式，业务默认深度定制
        supplyModes: allowedSupplyModes[0],
      });
    }
    draftRef.current = null;
    if (v.audienceId) handleAudienceChange(v.audienceId);
  };

  // 懒加载「指定可见人」候选用户：仅在编辑弹窗打开时按需拉取。
  // 用轻量接口 /users/select（对所有登录用户开放，无需 system:user 权限），
  // 业务员等角色也能正常获取候选列表，不会触发「权限不足」提示。
  const loadUsers = useCallback(async () => {
    try {
      const r = await userApi.listForSelect();
      if (r.data.code === 200 || r.data.code === 0) {
        // 排除创建人（当前登录用户）：私密指定人不能是创建者本人
        setUsers(r.data.data
          .filter((u) => u.id !== currentUser?.id)
          .map((u) => ({
            id: u.id,
            username: u.username,
            realName: u.realName ?? undefined,
          })));
      }
    } catch {
      /* 失败保持 users 为空，「指定可见人」不可用即可 */
    }
  }, [currentUser?.id]);

  const openEdit = (record: Product) => {
    setEditing(record);
    setPendingProducts([]);
    pushLayer('edit');
    setOpen(true);
    loadUsers();
    // 主表单 Modal 已 forceRender，先重置再回填，避免残留上一次的值
    form.resetFields();
    // 供货模式按角色过滤（如采购不可含深度定制；业务固定深度定制）
    const modes = (record.supplyModes ? record.supplyModes.split(',') : [])
      .filter((m) => allowedSupplyModes.includes(m));
    form.setFieldsValue({
      ...record,
      craftIds: record.crafts?.map((c) => c.id) || [],
      supplyModes: modes.length ? modes[0] : allowedSupplyModes[0],
      // 供货方式（单品/组合）：按单位映射（套=组合，个=单品）
      productType: record.unit === '套' ? 'GROUP' : 'PRODUCT',
      certificationIds: record.certificationIds ? record.certificationIds.split(',') : [],
      visibility: record.visibility || 'PUBLIC',
      visibleUserIds: record.visibleUsers?.map((v) => v.userId) ?? [],
    });
    if (record.audienceId) handleAudienceChange(record.audienceId);
  };

  // 从主表单返回第一步重新选择 工艺/受众/品类
  const backToStep = () => {
    const v = form.getFieldsValue(['craftIds', 'audienceId', 'categoryId']);
    setStepCrafts(crafts.filter((c) => (v.craftIds || []).includes(c.id)));
    const aud = audiences.find((a) => a.id === v.audienceId);
    setStepAudience(aud);
    const cats = aud?.categories || [];
    setCategories(cats);
    setSelectedAudienceId(v.audienceId);
    setStepCategory(cats.find((c) => c.id === v.categoryId));
    setStepErr({});
    // 暂存当前编辑弹窗里未提交的值与编辑态，重选后恢复
    draftRef.current = { values: form.getFieldsValue(true), editing };
    popLayer('edit');
    setOpen(false);
    pushLayer('step');
    setStepOpen(true);
  };

  // 将表单中未填产生的 null 转为 undefined，避免后端 Zod 对 z.string().optional() 报 "Expected string, received null"
  const cleanNullValues = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    Object.entries(obj).forEach(([key, value]) => {
      out[key] = value === null ? undefined : value;
    });
    return out;
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 工艺/受众/品类已移至第一步选择，未渲染 Form.Item，需从 store 显式取出并入提交数据
      const extra = form.getFieldsValue(['craftIds', 'audienceId', 'categoryId']);
      const data = {
        ...cleanNullValues(extra),
        ...cleanNullValues(values),
        // 界面用「供货方式（单品/组合）」表述，提交时映射为后端 unit（单品→个，组合→套）
        unit: values.productType === 'GROUP' ? '套' : '个',
        // 供货模式由后续逻辑决定，前端不再选择：
        // 编辑时保留该产品原有模式（若当前角色允许），新建时取当前角色默认模式
        supplyModes: editing?.supplyModes && allowedSupplyModes.includes(editing.supplyModes)
          ? editing.supplyModes
          : allowedSupplyModes[0],
        certificationIds: Array.isArray(values.certificationIds) ? values.certificationIds.join(',') : '',
        // 公开产品不指定可见人：显式置空，确保后端清空已存在的可见人关联
        visibleUserIds: values.visibility === 'PUBLIC' ? [] : (values.visibleUserIds ?? []),
      };
      // 移除界面专用字段，避免提交冗余/未知属性
      delete (data as Record<string, unknown>).productType;
      if (editing) {
        const res = await productApi.update(editing.id, data);
        const updated = res.data?.data ?? (res.data as unknown as Product);
        message.success('更新成功');
        // 同步更新详情弹窗（若仍打开）与详情缓存，避免保存后详情显示旧数据
        if (detailOpen) {
          const next = { ...viewing, ...updated };
          setViewing(next);
          setDetailCache(next);
        }
      } else {
        await productApi.create(data);
        message.success('创建成功');
      }
      setOpen(false);
      setPendingProducts([]);
      invalidateAll(); // 写后失效，下次进入重新拉取最新数据
      fetchList();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown[]; response?: { data?: { message?: string } }; message?: string };
      if (e && Array.isArray(e.errorFields)) {
        message.error('请检查表单必填项');
      } else {
        const msg = e?.response?.data?.message || e?.message || '保存失败';
        message.error(msg);
      }
    }
  };

  // 组合模式：将当前表单保存为一条产品并返回其 id（不关闭弹窗）
  const saveCurrentAsProduct = async (): Promise<string | null> => {
    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      message.error('请检查表单必填项');
      return null;
    }
    const extra = {
      craftIds: (values.craftIds as string[]) || [],
      audienceId: values.audienceId,
      categoryId: values.categoryId,
    };
    const data = {
      ...cleanNullValues(extra as Record<string, unknown>),
      ...cleanNullValues(values as Record<string, unknown>),
      unit: values.productType === 'GROUP' ? '套' : '个',
    } as Record<string, unknown>;
    delete data.productType;
    if ((data as any).visibility === 'PUBLIC') (data as any).visibleUserIds = [];
    const res = await productApi.create(data as any);
    return res.data?.data?.id ?? null;
  };

  // 组合模式：保存当前单品并继续添加下一个
  const handleAddProduct = async () => {
    const id = await saveCurrentAsProduct();
    if (!id) return;
    const values = form.getFieldsValue();
    setPendingProducts((prev) => [...prev, { id, name: (values.name as string) || '未命名', sku: (values.sku as string) || '' }]);
    // 保留分类选择，清空其余以便连续添加
    const keep = { craftIds: values.craftIds, audienceId: values.audienceId, categoryId: values.categoryId };
    form.resetFields();
    form.setFieldsValue(keep);
    message.success('已添加单品，可继续添加');
  };

  // 组合模式：把已添加（含当前）单品生成产品组
  const handleGenerateGroup = async () => {
    const groupName = (form.getFieldValue('groupName') || '').trim();
    if (!groupName) { message.warning('请输入组合名称'); return; }
    const id = await saveCurrentAsProduct();
    if (!id) return;
    setPendingProducts((prev) => [...prev, { id, name: form.getFieldValue('name') || '未命名', sku: form.getFieldValue('sku') || '' }]);
    const ids = [...pendingProducts.map((p) => p.id), id];
    try {
      await productGroupApi.create({ name: groupName, description: (form.getFieldValue('groupDesc') || '') || undefined, productIds: ids });
      message.success('产品组已创建');
      setPendingProducts([]);
      setOpen(false);
      invalidateAll();
      fetchList();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '创建产品组失败');
    }
  };

  // 新建流程取消/关闭时，若已有待成组单品则清理，避免脏数据
  const cleanupPending = () => {
    if (!editing && pendingProducts.length) {
      pendingProducts.forEach((p) => productApi.delete(p.id).catch(() => null));
    }
    setPendingProducts([]);
  };

  const handleDelete = async (id: string) => {
    try {
      await productApi.delete(id);
      message.success('删除成功');
      invalidateAll(); // 删除后失效，下次重新拉取
      fetchList();
    } catch { message.error('删除失败'); }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await productGroupApi.remove(id);
      message.success('已删除产品组');
      fetchList();
    } catch { message.error('删除失败'); }
  };

  return (
    <div className="pm-container">
      {/* 筛选栏 */}
      <Card className="pm-toolbar" styles={{ body: { padding: '12px 16px' } }}>
        <Row gutter={12} align="middle" wrap>
          <Col flex="auto">
            <Space wrap>
                <Input
                placeholder="搜索产品名称 / SKU"
                prefix={<SearchOutlined />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onPressEnter={fetchList}
                allowClear
                style={{ width: 260 }}
              />
              <Select
                placeholder="工艺"
                value={filterCraftId}
                onChange={(v) => { setFilterCraftId(v); setPage(1); }}
                allowClear
                style={{ width: 120 }}
                options={crafts.map((c) => ({ label: c.name, value: c.id }))}
              />
              <Select
                placeholder="受众"
                value={filterAudienceId}
                onChange={(v) => { setFilterAudienceId(v); setPage(1); }}
                allowClear
                style={{ width: 110 }}
                options={audiences.map((a) => ({ label: a.name, value: a.id }))}
              />
              <Select
                placeholder={t('product.visibility')}
                value={filterVisibility}
                onChange={(v) => { setFilterVisibility(v); setPage(1); }}
                allowClear
                style={{ width: 120 }}
                options={[
                  { label: t('product.visibilityPublic'), value: 'PUBLIC' },
                  { label: t('product.visibilityPrivate'), value: 'PRIVATE' },
                ]}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchList}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setKeyword(''); setFilterCraftId(undefined); setFilterAudienceId(undefined); setFilterVisibility(undefined); setFilterType('ALL'); setPage(1); }}>重置</Button>
              <CapsuleSwitch
                value={filterType}
                options={[
                  { key: 'ALL', label: '全部' },
                  { key: 'PRODUCT', label: '单品' },
                  { key: 'GROUP', label: '组合' },
                ]}
                onChange={(v) => { setFilterType(v); setPage(1); }}
              />
            </Space>
          </Col>
          <Col>
            <Space>
              <ViewModeSwitch value={viewMode} onChange={setViewMode} />
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建</Button>
              <Button icon={<UploadOutlined />} onClick={() => setBatchOpen(true)}>批量新建</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 产品 / 组合 混合数据区（同列表混排） */}
      <Card className="pm-grid-card" styles={{ body: { padding: 20 } }}>
        {loading ? (
          <div style={{ padding: '64px 0', textAlign: 'center' }}>
            <Spin size="large" />
          </div>
        ) : list.length === 0 ? (
          <div className="pm-grid-empty">暂无数据，点击右上角「新建产品」或「新建组合」开始添加</div>
        ) : viewMode === 'card' ? (
          <>
            <Row gutter={[16, 16]}>
              {list.map((item) => (
                <Col key={`${item.type}-${item.data.id}`} xs={24} sm={12} md={12} lg={6} xl={6}>
                  {item.type === 'PRODUCT' ? (
                    <ProductCard
                      product={item.data}
                      onOpenDetail={openDetail}
                      onDelete={handleDelete}
                      canDelete={canDelete}
                    />
                  ) : (
                    <ProductGroupCard
                      group={item.data}
                      canDelete={canDelete}
                      onOpenManage={(g) => { setGroupManageId(g.id); setGroupManageOpen(true); }}
                      onDelete={handleDeleteGroup}
                    />
                  )}
                </Col>
              ))}
            </Row>
            <div className="pm-grid-pager">
              <Pagination
                {...buildTablePagination({
                  total,
                  page,
                  pageSize: 8,
                  onChange: (p) => setPage(p),
                })}
              />
            </div>
          </>
        ) : (
          <ProductList
            data={list.filter((i) => i.type === 'PRODUCT').map((i) => (i as { type: 'PRODUCT'; data: Product }).data)}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            onView={(r) => openDetail(r)}
            onEdit={openEdit}
            onDelete={handleDelete}
            canDelete={canDelete}
          />
        )}
      </Card>

      {/* 新建 / 编辑弹窗 */}
      <Modal
        title={
          <div className="pm-modal-title">
            <span className="pm-modal-title-main">{editing ? '编辑产品' : '新建产品'}</span>
            <span className="pm-sku-head">
              {(() => {
                const { phase, label } = getProgressPhase(editing?.progress ?? null);
                return <Tag color={STATUS_TAG_COLOR[phase]} className="pm-sku-status">{label}</Tag>;
              })()}
              <span className={cx('pm-sku-preview', !skuPreview && 'is-empty')}>
                {skuPreview ? skuPreview : 'SKU 待生成'}
              </span>
            </span>
            {(() => {
              const cNames = (watchedCraftIds ?? [])
                .map((id: string) => crafts.find((c) => c.id === id)?.name)
                .filter(Boolean);
              const aName = audiences.find((a) => a.id === watchedAudienceId)?.name;
              const catName = categories.find((c) => c.id === watchedCategoryId)?.name
                || audiences.find((a) => a.id === watchedAudienceId)?.categories?.find((c) => c.id === watchedCategoryId)?.name;
              const str = [...cNames, aName, catName].filter(Boolean).join(' / ');
              return str ? <span className="pm-taxonomy-str">{str}</span> : null;
            })()}
            <div className="pm-modal-actions">
              <div className="pm-vis-switch" role="group" aria-label={t('product.visibility')}>
                <button
                  type="button"
                  className={cx('pm-vis-opt', visValue === 'PUBLIC' && 'is-active')}
                  onClick={() => form.setFieldsValue({ visibility: 'PUBLIC' })}
                >
                  {t('product.visibilityPublic')}
                </button>
                <button
                  type="button"
                  className={cx('pm-vis-opt', visValue === 'PRIVATE' && 'is-active')}
                  onClick={() => form.setFieldsValue({ visibility: 'PRIVATE' })}
                >
                  {t('product.visibilityPrivate')}
                </button>
              </div>
              {visValue === 'PRIVATE' ? (
                <Select
                  mode="multiple"
                  size="small"
                  maxTagCount="responsive"
                  allowClear
                  placeholder={t('product.visibleUsersPlaceholder')}
                  optionFilterProp="label"
                  className="pm-vis-users"
                  value={visibleUserIds ?? []}
                  onChange={(next) =>
                    form.setFieldsValue({ visibleUserIds: Array.isArray(next) ? next : [] })
                  }
                  options={users.map((u) => ({
                    label: u.realName || u.username,
                    value: u.id,
                  }))}
                />
              ) : null}
            </div>
            <button
              type="button"
              className="pm-modal-close"
              aria-label="关闭"
              onClick={closeEdit}
            >
              <CloseOutlined />
            </button>
          </div>
        }
        closeIcon={null}
        open={open}
        onCancel={closeEdit}
        width={1000}
        zIndex={1100}
        footer={
          editing ? (
            [
              <Button key="back" onClick={backToStep} icon={<ArrowLeftOutlined />}>重选分类</Button>,
              <Button key="cancel" onClick={closeEdit}>取消</Button>,
              <Button key="save" type="primary" onClick={handleSubmit}>保存</Button>,
            ]
          ) : pendingProducts.length > 0 || productTypeWatch === 'GROUP' ? (
            // 组合模式：可继续添加，或生成产品组
            <Space>
              <Button onClick={backToStep} icon={<ArrowLeftOutlined />}>重选分类</Button>
              <Button onClick={closeEdit}>取消</Button>
              <Button onClick={handleAddProduct}>添加单品</Button>
              <Button type="primary" onClick={handleGenerateGroup}>生成组合</Button>
            </Space>
          ) : (
            // 新建单个产品：可直接保存，或「添加单品」开始组合
            <Space>
              <Button onClick={backToStep} icon={<ArrowLeftOutlined />}>重选分类</Button>
              <Button onClick={closeEdit}>取消</Button>
              <Button onClick={handleAddProduct}>添加单品</Button>
              <Button type="primary" onClick={handleSubmit}>保存</Button>
            </Space>
          )
        }
        // forceRender 让 form 常驻连接，打开时可直接 setFieldsValue，避免 useForm not connected 警告
        forceRender
        styles={{
          body: { paddingTop: 12 },
          header: { paddingRight: 0 },
        }}
      >
        <Form form={form} layout="vertical" className="pm-form">
          <Row gutter={cardGutter}>
            {/* 左：产品图片栏 */}
            <Col xs={24} xl={{ flex: '3 1 0%' }} className="pm-col-stretch">
              <div className="pm-col-inner">
                <Card
                  title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      产品图片
                      <Tooltip title="支持批量选择图片，第一张将作为主图；点击图片可预览（支持左右切换），也可通过星标重新设为主图。">
                        <InfoCircleOutlined style={{ color: 'var(--c-text-tertiary)', cursor: 'help' }} />
                      </Tooltip>
                    </span>
                  }
                  variant="outlined"
                  className="pm-card"
                >
                  <Form.Item name="images" noStyle>
                    <ProductImageList uploadUrl="/upload" />
                  </Form.Item>
                </Card>

                {/* 认证资质 */}
                <Card title="认证资质" variant="outlined" className="pm-card pm-card-stretch">
                  <Form.Item name="certificationIds" label="认证资质">
                    <Select mode="multiple" placeholder="选择现有证书" allowClear
                      optionFilterProp="label"
                      options={certificates.map((c) => ({
                        label: c.code ? `${c.name}（${c.code}）` : c.name,
                        value: c.id,
                      }))} />
                  </Form.Item>
                </Card>
              </div>
            </Col>

            {/* 右：基础信息栏（单列整行） */}
            <Col xs={24} xl={{ flex: '2 1 0%' }} className="pm-col-stretch">
              {!editing && (pendingProducts.length > 0 || productTypeWatch === 'GROUP') && (
                <Card title="组合信息" variant="outlined" className="pm-card" style={{ marginBottom: 16 }}>
                  <Form.Item name="groupName" label="组合名称" rules={[{ required: true, message: '请输入组合名称' }]} style={{ marginBottom: 12 }}>
                    <Input placeholder="如 2024春季毛绒新品组" />
                  </Form.Item>
                  <Form.Item name="groupDesc" label="组合备注" style={{ marginBottom: 0 }}>
                    <Input placeholder="组合整体说明" />
                  </Form.Item>
                  <Divider style={{ margin: '12px 0' }} />
                  <div className="pm-pending-title">已添加单品（{pendingProducts.length}）</div>
                  {pendingProducts.length ? (
                    <div className="pm-pending-list">
                      {pendingProducts.map((p) => (
                        <span key={p.id} className="pm-pending-tag">
                          {p.sku && <span className="pm-prod-sku">{p.sku}</span>}
                          {p.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="pm-pending-empty">尚未添加单品，填写上方信息后点「添加单品」</span>
                  )}
                </Card>
              )}
              <Card title="基础信息" variant="outlined" className="pm-card">
                {/* 工艺/受众/品类已移至第一步选择，此处保留隐藏 Form.Item 以维持字段注册 */}
                <Form.Item name="craftIds" hidden><Input /></Form.Item>
                <Form.Item name="audienceId" hidden><Input /></Form.Item>
                <Form.Item name="categoryId" hidden><Input /></Form.Item>

                {/* 公开/不公开切换与「指定可见人」已上移至弹窗右上角操作区（pm-modal-actions） */}
                <Form.Item name="visibility" hidden initialValue="PUBLIC"><Input /></Form.Item>
                <Form.Item
                  name="visibleUserIds"
                  hidden
                >
                  <Select mode="multiple" />
                </Form.Item>

                <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
                  <Input placeholder="输入产品名称" />
                </Form.Item>

                {/* 尺寸：长宽高一行，置于商品描述上方 */}
                <div className="pm-size-row">
                  <div className="pm-size-row-title">尺寸 (cm)</div>
                  <Row gutter={10}>
                    <Col span={8}>
                      <Form.Item name="sizeL" label="长" style={{ marginBottom: 0 }}>
                        <Input placeholder="0" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="sizeW" label="宽" style={{ marginBottom: 0 }}>
                        <Input placeholder="0" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="sizeH" label="高" style={{ marginBottom: 0 }}>
                        <Input placeholder="0" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>

                {/* 克重 + 供货方式（单品/组合）一行，置于尺寸栏下方 */}
                <Row gutter={10} className="pm-size-row">
                  <Col span={12}>
                    <Form.Item name="weight" label="克重 (g)" style={{ marginBottom: 0 }}>
                      <Input placeholder="0" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="productType" label="供货方式" initialValue="PRODUCT" style={{ marginBottom: 0 }}>
                      <Segmented
                        block
                        options={[
                          { label: '单品', value: 'PRODUCT' },
                          { label: '组合', value: 'GROUP' },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider className="pm-card-divider" />

                <Form.Item name="remark" label="商品描述">
                  <Input.TextArea rows={3} placeholder="详细介绍商品特色、材质、核心功能卖点..." />
                </Form.Item>
              </Card>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 第一步：选择工艺 / 受众 / 品类 */}
      <Modal
        title={draftRef.current?.editing ? '重选分类' : '新建产品 · 选择分类'}
        open={stepOpen}
        onCancel={() => { popLayer('step'); setStepOpen(false); }}
        onOk={handleStepNext}
        okText="下一步"
        cancelText="取消"
        width={680}
        destroyOnHidden
        forceRender={false}
        zIndex={1200}
      >
        <div className="pm-step-flow">
          <StepBar
            embedded
            current={!stepCrafts.length ? 0 : !stepAudience ? 1 : stepCategory?.id ? 3 : 2}
            items={[
              { title: '选择工艺', statusText: !stepCrafts.length ? '进行中' : '已完成' },
              { title: '选择受众', statusText: stepCrafts.length && !stepAudience ? '进行中' : stepAudience ? '已完成' : '待处理' },
              { title: '选择品类', statusText: stepAudience ? (stepCategory?.id ? '已完成' : '进行中') : '待处理' },
            ]}
          />
          <div className="pm-step-flow__body">
            <Form component={false} layout="vertical">
            {/* 工艺 */}
          {/* 工艺 */}
          <Form.Item
            label="工艺"
            required
            validateStatus={stepErr.craftId ? 'error' : ''}
            help={stepErr.craftId}
          >
            <Row gutter={[10, 10]}>
              {crafts.map((c) => {
                const checked = stepCrafts.some((s) => s.id === c.id);
                return (
                  <Col span={8} key={c.id}>
                    <button
                      type="button"
                      className={cx('pm-pick', checked && 'is-selected')}
                      title={checked && stepCrafts.length === 1 ? '至少保留一个工艺' : undefined}
                      onClick={() => {
                        // 最后一个选中的工艺不可取消
                        if (checked && stepCrafts.length === 1) return;
                        setStepCrafts((prev) =>
                          checked ? prev.filter((s) => s.id !== c.id) : [...prev, c],
                        );
                        setStepErr((e) => ({ ...e, craftId: undefined }));
                      }}
                    >
                      <CheckCircleFilled className="pm-pick-check" />
                      <span className="pm-pick-name">{c.name}</span>
                    </button>
                  </Col>
                );
              })}
            </Row>
          </Form.Item>

          {/* 受众：选完工艺后出现 */}
          {stepCrafts.length > 0 && (
            <Form.Item
              label="受众"
              required
              validateStatus={stepErr.audienceId ? 'error' : ''}
              help={stepErr.audienceId}
            >
              <Row gutter={[10, 10]}>
                {audiences.map((a) => (
                  <Col span={8} key={a.id}>
                    <button
                      type="button"
                      className={cx('pm-pick', stepAudience?.id === a.id && 'is-selected')}
                      onClick={() => {
                        setStepAudience(a);
                        setStepCategory(undefined);
                        setStepErr((e) => ({ ...e, audienceId: undefined, categoryId: undefined }));
                        // step-1 弹窗内仅同步本地 state，主表单 form 尚未挂载
                        setCategories(a?.categories || []);
                        setSelectedAudienceId(a.id);
                      }}
                    >
                      <CheckCircleFilled className="pm-pick-check" />
                      <span className="pm-pick-name">{a.name}</span>
                      {a.categories?.length ? (
                        <span className="pm-pick-sub">{a.categories.length} 个品类</span>
                      ) : null}
                    </button>
                  </Col>
                ))}
              </Row>
            </Form.Item>
          )}

          {/* 品类：选完受众后出现 */}
          {selectedAudienceId && (
            <>
              <Form.Item
                label="品类"
                required
                validateStatus={stepErr.categoryId ? 'error' : ''}
                help={stepErr.categoryId}
              >
              <Row gutter={[10, 10]}>
                {categories.length ? categories.map((c) => (
                  <Col span={8} key={c.id}>
                    <button
                      type="button"
                      className={cx('pm-pick', stepCategory?.id === c.id && 'is-selected')}
                      onClick={() => {
                        setStepCategory(c);
                        setStepErr((e) => ({ ...e, categoryId: undefined }));
                      }}
                    >
                      <CheckCircleFilled className="pm-pick-check" />
                      <span className="pm-pick-name">{c.name}</span>
                    </button>
                  </Col>
                )) : (
                  <Col span={24}>
                    <div className="pm-pick-empty">该受众暂无品类，可直接进入下一步</div>
                  </Col>
                )}
              </Row>
            </Form.Item>
            </>
          )}
            </Form>
          </div>
        </div>
      </Modal>

      {/* 详情弹窗（使用项目自有 AppModal 组件，UI 参考客户详情） */}
      <ProductDetailModal
        product={viewing}
        open={detailOpen}
        onClose={closeDetail}
        onEdit={openEdit}
        onCreateQuote={handleCreateQuote}
        onApplySample={handleApplySample}
        onDelete={() => {
          if (viewing) {
            closeDetail();
            handleDelete(viewing.id);
          }
        }}
        canDelete={canDelete}
        salesList={salesList}
        salesLoading={salesLoading}
        activities={viewing?.activities || []}
        userMap={userMap}
      />

      {/* 批量新建产品 */}
      <BatchCreateProductModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        onSuccess={() => { setBatchOpen(false); fetchList(); }}
      />

      {/* 组合集中管理（成员 / 打样 / 报价 / 编辑 / 删除） */}
      <ProductGroupManageModal
        groupId={groupManageId}
        open={groupManageOpen}
        onClose={() => setGroupManageOpen(false)}
        onChanged={() => fetchList()}
      />
    </div>
  );
}
