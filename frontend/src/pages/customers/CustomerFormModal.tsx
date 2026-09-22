import { Alert, App, Button, Form, Image, Input, Modal, Radio, Select, Space, Switch, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createCustomer, updateCustomer } from '../../api/customers';
import { getErrorMessage } from '../../api/request';
import { isUploadableImage, uploadImage } from '../../api/upload';
import { useMasterData } from '../../hooks/useMasterData';
import type {
  CustomerBase,
  CustomerCreateRequest,
  CustomerDetail,
  CustomerLevel,
  CustomerUpdateRequest,
  LeadSource,
} from '../../types/customer';
import { CUSTOMER_LEVEL_OPTIONS, LEAD_SOURCE_OPTIONS } from './constants';

const { Text } = Typography;

export type CustomerFormMode = 'create' | 'edit';

interface CustomerFormValues {
  companyName: string;
  contactName?: string;
  englishName?: string;
  position?: string;
  email?: string;
  phone?: string;
  wechat?: string;
  country?: string;
  region?: string;
  coverImage?: string;
  /** Edit only（Create 不开放 —— D-CUSTOMER-LEVEL） */
  customerLevel?: CustomerLevel;
  customerType?: string;
  source?: LeadSource;
  tags?: string[];
  notes?: string;
  isKeyAccount: boolean;
  /** Edit only（人工字段 —— D-FIRST-ORDER；非派生、不自动同步） */
  firstOrderAt?: string;
  /** 归属选择：create = self|public；edit = keep|public（**不支持选择其他用户**） */
  ownerScope: 'self' | 'keep' | 'public';
}

export interface CustomerFormModalProps {
  mode: CustomerFormMode;
  open: boolean;
  /** Edit 模式的初始数据（来自 GET /api/customers/:id） */
  initial?: CustomerDetail | null;
  onCancel: () => void;
  onSaved: (customer: CustomerBase) => void;
}

/**
 * Customer Create / Edit 表单（Round F-8 · 依据 F-7B + F-8 Decision Freeze）
 *
 * 冻结边界（不得漂移）：
 *   · **Create 不开放**：customerLevel（后端固定 NORMAL）· firstOrderAt（create 不持久化）
 *     · englishName / position / wechat / region（create 接受但不持久化 —— F8-07 口径）
 *   · **Edit 开放**：上述字段 + 基础字段（以后端 update 载荷为准）
 *   · **ownerId 仅两态**：create = undefined（当前用户）/ null（公海）；edit = 保持 / null（公海）。
 *     **不提供任何"选择其他用户"控件**（F-01 owner candidate 缺失 ⇒ owner 指派 BLOCKED）；
 *     不调用任何通用选人接口，不加载用户列表。
 *   · **客户意向**（Customer.intentLevel）在表单中**不可见、不可编辑、不提交**（D-INTENT v2 / F-8C）：
 *     它是后端按关联 Opportunity.intentLevel 读取时派生的只读值，与 isKeyAccount 完全解耦。
 *   · **客户名片**（后端字段 coverImage）：仅存图片 URL（string | null）；上传走 POST /api/upload，
 *     表单值绝不绑定 Upload 的 FileList（D-FE-CARD-2/3/7）。
 *   · 校验只实现 contract 明确要求者（companyName 必填）；不新增 email/phone 格式校验、
 *     不把 customerType 变成 FK 语义、不对 tags 做去重/大小写归一。
 */
export default function CustomerFormModal({ mode, open, initial, onCancel, onSaved }: CustomerFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<CustomerFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { customerTypes, loadCustomerTypes } = useMasterData();
  const ownerScope = Form.useWatch('ownerScope', form) ?? (mode === 'create' ? 'self' : 'keep');
  // 客户名片：表单值恒为 string | undefined（上传成功写入 URL）；Upload 的 FileList 不进表单
  const coverImage = Form.useWatch('coverImage', form) as string | undefined;
  const [uploading, setUploading] = useState(false);

  // 字典（客户类型）仅在打开时确保加载（TTL 缓存内不会重复请求）
  useEffect(() => {
    if (!open) return;
    void loadCustomerTypes().catch(() => {
      /* 字典失败不阻塞表单：Select 保持空态，历史值仍以标签形式保留 */
    });
  }, [open, loadCustomerTypes]);

  // 打开时填充（Edit）或重置（Create）
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === 'edit' && initial) {
      form.setFieldsValue({
        companyName: initial.companyName,
        contactName: initial.contactName ?? undefined,
        englishName: initial.englishName ?? undefined,
        position: initial.position ?? undefined,
        email: initial.email ?? undefined,
        phone: initial.phone ?? undefined,
        wechat: initial.wechat ?? undefined,
        country: initial.country ?? undefined,
        region: initial.region ?? undefined,
        coverImage: initial.coverImage ?? undefined,
        customerLevel: initial.customerLevel,
        customerType: initial.customerType ?? undefined,
        source: initial.source ?? undefined,
        tags: initial.tags,
        notes: initial.notes ?? undefined,
        isKeyAccount: initial.isKeyAccount,
        // D-INTENT v2：Customer.intentLevel 不回填表单（只读派生值，表单不承载该字段）
        // ISO → 'YYYY-MM-DD'（原生 date input 的取值格式；人工字段，不做任何推导）
        firstOrderAt: initial.firstOrderAt ? String(initial.firstOrderAt).slice(0, 10) : undefined,
        ownerScope: 'keep',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ isKeyAccount: false, ownerScope: 'self' });
    }
  }, [open, mode, initial, form]);

  // ===== 客户名片：上传 / 清除（D-FE-CARD-2/3/4/5/7）=====
  // beforeUpload 只做校验：不合法 → LIST_IGNORE（不加入列表、不发起请求）
  const beforeUploadImage: UploadProps['beforeUpload'] = (file) => {
    if (!isUploadableImage(file)) {
      message.error(file.type.startsWith('image/') ? '图片大小不能超过 10MB' : '仅支持图片文件（image/*）');
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  // customRequest：经 api/upload.ts 调用 POST /api/upload，成功后把 data.url 写入表单值（string）
  const uploadCoverImage: UploadProps['customRequest'] = async ({ file, onSuccess, onError }) => {
    if (!(file instanceof File)) {
      message.error('文件类型不受支持');
      onError?.(new Error('unsupported file'));
      return;
    }
    setUploading(true);
    try {
      const { url } = await uploadImage(file);
      form.setFieldValue('coverImage', url);
      onSuccess?.({ url });
      message.success('客户名片上传成功');
    } catch (err) {
      const text = getErrorMessage(err);
      message.error(text);
      onError?.(err as Error);
    } finally {
      setUploading(false);
    }
  };

  /** 清除客户名片：表单值置空 ⇒ 提交时 `coverImage: values.coverImage ?? null` = null */
  const clearCoverImage = () => {
    form.setFieldValue('coverImage', undefined);
  };

  // 客户类型选项：字典 + 当前值兜底（容忍历史未知值，不清空 —— D-CUSTOMER-TYPE）
  const customerTypeOptions = useMemo(() => {
    const options = customerTypes.map((item) => ({ label: item.name, value: item.name }));
    const current = initial?.customerType;
    if (mode === 'edit' && current && !options.some((option) => option.value === current)) {
      options.unshift({ label: `${current}（当前值，不在字典中）`, value: current });
    }
    return options;
  }, [customerTypes, initial, mode]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    let values: CustomerFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 表单校验失败（仅 companyName 必填）
    }

    setSubmitting(true);
    try {
      if (mode === 'create') {
        const payload: CustomerCreateRequest = {
          companyName: values.companyName.trim(),
          contactName: values.contactName ?? null,
          email: values.email ?? null,
          phone: values.phone ?? null,
          country: values.country ?? null,
          customerType: values.customerType ?? null,
          source: values.source ?? null,
          tags: values.tags ?? [],
          notes: values.notes ?? null,
          coverImage: values.coverImage ?? null,
          isKeyAccount: values.isKeyAccount,
          // D-INTENT v2：Customer.intentLevel 为后端派生只读值 ⇒ create 请求体不含 intentLevel
          // 归属：self → 省略（后端归当前用户）；public → null（公海）
          ...(values.ownerScope === 'public' ? { ownerId: null } : {}),
        };
        const saved = await createCustomer(payload);
        message.success('创建成功');
        form.resetFields();
        onSaved(saved);
      } else {
        if (!initial) throw new Error('缺少待编辑的客户数据');
        const payload: CustomerUpdateRequest = {
          companyName: values.companyName.trim(),
          contactName: values.contactName ?? null,
          englishName: values.englishName ?? null,
          position: values.position ?? null,
          email: values.email ?? null,
          phone: values.phone ?? null,
          wechat: values.wechat ?? null,
          country: values.country ?? null,
          region: values.region ?? null,
          coverImage: values.coverImage ?? null,
          customerLevel: values.customerLevel ?? initial.customerLevel,
          customerType: values.customerType ?? null,
          source: values.source ?? null,
          tags: values.tags ?? [],
          notes: values.notes ?? null,
          isKeyAccount: values.isKeyAccount,
          // D-INTENT v2：Customer.intentLevel 为后端派生只读值 ⇒ update 请求体不含 intentLevel
          // 人工字段：空串 → null（清空）；不做任何订单推导
          firstOrderAt: values.firstOrderAt ? String(values.firstOrderAt).slice(0, 10) : null,
          // 归属：keep → 省略（保持原值）；public → null（移入公海）
          ...(values.ownerScope === 'public' ? { ownerId: null } : {}),
        };
        const saved = await updateCustomer(initial.id, payload);
        message.success('更新成功');
        onSaved(saved);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, mode, initial, message, onSaved]);

  const isCreate = mode === 'create';

  return (
    <Modal
      open={open}
      title={isCreate ? '新建客户' : '编辑客户'}
      width={760}
      okText={isCreate ? '创建' : '保存'}
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => void handleSubmit()}
      onCancel={() => {
        setError(null);
        onCancel();
      }}
    >
      {error ? <Alert type="error" showIcon title={isCreate ? '创建客户失败' : '保存客户失败'} description={error} style={{ marginBottom: 12 }} /> : null}

      <Form<CustomerFormValues> form={form} layout="vertical" initialValues={{ isKeyAccount: false, ownerScope: isCreate ? 'self' : 'keep' }}>
        <Form.Item name="companyName" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
          <Input maxLength={200} placeholder="公司名称" />
        </Form.Item>

        <Form.Item name="contactName" label="联系人">
          <Input maxLength={100} />
        </Form.Item>

        {!isCreate ? (
          <>
            <Form.Item name="englishName" label="英文名称">
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="position" label="职位">
              <Input maxLength={100} />
            </Form.Item>
          </>
        ) : null}

        <Form.Item name="email" label="邮箱">
          <Input maxLength={200} />
        </Form.Item>

        <Form.Item name="phone" label="电话">
          <Input maxLength={50} />
        </Form.Item>

        {!isCreate ? (
          <Form.Item name="wechat" label="微信">
            <Input maxLength={100} />
          </Form.Item>
        ) : null}

        <Form.Item name="country" label="国家/地区">
          <Input maxLength={100} />
        </Form.Item>

        {!isCreate ? (
          <>
            <Form.Item name="region" label="地区">
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item
              name="customerLevel"
              label="客户等级"
              extra="新建客户由后端固定为「普通客户」，创建后可在编辑中调整。"
            >
              <Select allowClear options={CUSTOMER_LEVEL_OPTIONS} placeholder="客户等级" />
            </Form.Item>
          </>
        ) : null}

        <Form.Item name="customerType" label="客户类型" extra="自由文本；历史值可能不在当前字典中，会原样保留。">
          <Select allowClear showSearch options={customerTypeOptions} placeholder="客户类型" optionFilterProp="label" />
        </Form.Item>

        <Form.Item name="source" label="客户来源" extra="与线索来源是两个独立字段，不会自动继承。">
          <Select allowClear options={LEAD_SOURCE_OPTIONS} placeholder="客户来源" />
        </Form.Item>

        <Form.Item name="tags" label="标签" extra="自由文本，无字典；可输入多个（回车分隔）。">
          <Select mode="tags" notFoundContent={null} placeholder="输入标签后回车" />
        </Form.Item>

        {/* 值域：coverImage 恒为 string | undefined（隐藏字段承载）；Upload 的 FileList 绝不绑定到表单值 */}
        <Form.Item name="coverImage" hidden>
          <Input />
        </Form.Item>

        <Form.Item label="客户名片" extra="支持图片（image/*），不超过 10MB；上传成功后自动写入图片地址。">
          <Space size={12} align="start">
            {coverImage ? <Image src={coverImage} width={120} alt="客户名片" /> : <Text type="secondary">无客户名片</Text>}
            <Space size={8}>
              <Upload
                accept="image/*"
                maxCount={1}
                showUploadList={false}
                beforeUpload={beforeUploadImage}
                customRequest={uploadCoverImage}
              >
                <Button loading={uploading}>{coverImage ? '重新上传' : '上传客户名片'}</Button>
              </Upload>
              {coverImage ? <Button onClick={clearCoverImage}>清除</Button> : null}
            </Space>
          </Space>
        </Form.Item>

        {!isCreate ? (
          <Form.Item
            name="firstOrderAt"
            label="首次下单日期"
            extra="人工维护字段：系统不会根据订单自动计算或同步。"
          >
            <Input type="date" />
          </Form.Item>
        ) : null}

        <Form.Item name="isKeyAccount" label="重点客户" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Form.Item name="ownerScope" label="归属">
          <Radio.Group
            options={
              isCreate
                ? [
                    { label: '归属当前用户', value: 'self' },
                    { label: '放入公海（无归属）', value: 'public' },
                  ]
                : [
                    { label: `保持当前负责人${initial?.owner?.realName ? `（${initial.owner.realName}）` : initial?.ownerId ? '' : '（当前为公海）'}`, value: 'keep' },
                    { label: '移入公海', value: 'public' },
                  ]
            }
          />
        </Form.Item>
        <Text type="secondary">
          当前不支持选择其他负责人：负责人候选接口尚未落地（F-01 BLOCKED），因此本表单只能选择
          「归属当前用户 / 保持原负责人 / 公海」。
          {ownerScope === 'public' ? ' 保存后该客户将进入公海。' : ''}
        </Text>

        <Form.Item name="notes" label="备注" style={{ marginTop: 16 }}>
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
