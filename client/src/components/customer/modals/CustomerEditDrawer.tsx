import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input, DatePicker, App, theme, Form } from 'antd';
import { CloseOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { Customer, customerApi } from '../../../api/customers';
import CountrySelect from '../../CountrySelect';
import ProductImageList from '../../common/ProductImageList';
import ContactMethodInput from '../../common/ContactMethodInput';
import { useCommToolOptions } from '../../../stores/useCommToolStore';
import { Z_INDEX, createPopupContainer } from '../../../zIndex';
import { useDs } from '../shared/ds';

const { TextArea } = Input;

/**
 * 客户编辑抽屉的提交 payload —— **白名单**，仅含本抽屉真实可编辑字段。
 *
 * ⚠️ 禁止回退为 `{ ...customer, ...values }`：
 *   1) 会把 response-only / 关系字段一并提交（salesOrders · opportunities · _count ·
 *      lastOrderDate · pipelineAmount · totalAmount · owner · activities · customerNo ·
 *      createdAt · updatedAt …）→ 脏 payload；
 *   2) spread 出的旧 `firstOrderAt` 会覆盖日期控件的新值（server 优先取 body.firstOrderAt），
 *      导致「首次合作日期」的修改 / 清空**静默失效**。
 */
interface CustomerEditablePayload {
  companyName: string;
  contactName: string;
  position: string;
  country: string;
  images: string;
  /** 沟通方式（与线索一致：[{tool, account}]）；删除旧的邮箱/电话/微信独立字段，统一用该组件录入 */
  contactMethods?: { tool: string; account: string }[] | null;
  /** 旧字段保留项（仅用于回填、不再编辑，避免 PUT 全量替换导致历史数据丢失） */
  email: string;
  phone: string;
  wechat: string;
  /** 首次合作日期 'YYYY-MM-DD'；清空 → null（服务端 dateField 接受 null） */
  firstOrderAt: string | null;
  notes: string;
}

interface CustomerEditDrawerProps {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSaved?: (customer: Customer) => void;
}

/** 表单行：两列布局 */
function FormRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {React.Children.map(children as React.ReactElement[], (child) => (
        <div key={child?.key} style={{ flex: 1 }}>{child}</div>
      ))}
    </div>
  );
}

const CustomerEditDrawer: React.FC<CustomerEditDrawerProps> = ({ open, customer, onClose, onSaved }) => {
  const { token } = theme.useToken();
  const ds = useDs();
  const { message: msg } = App.useApp();
  const [antForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  // 沟通工具下拉（取自系统设置 → 沟通工具维护，与线索录入一致）
  const { options: commToolOptions } = useCommToolOptions();

  // 内容容器 ref，用于让 antd 浮层挂载在抽屉内、避免被层级遮挡
  const contentRef = React.useRef<HTMLDivElement>(null);

  // 打开时填充表单（antd Form 托管所有字段）
  useEffect(() => {
    if (open && customer) {
      antForm.setFieldsValue({
        companyName: customer.companyName,
        contactName: customer.contactName,
        englishName: customer.englishName,
        position: customer.position,
        // 沟通方式：优先用 contactMethods；旧数据无该字段时回退空（组件内默认一条空行）
        contactMethods: customer.contactMethods ?? undefined,
        country: customer.country,
        region: customer.region,
        notes: customer.notes,
        // V1.0 canonical：tags 为 string[]（该字段本抽屉不渲染、payload 白名单亦不提交，仅保持类型一致）
        tags: customer.tags ?? [],
        // V1.0 canonical：firstOrderAt 为 ISO 字符串，DatePicker 需 dayjs 对象
        firstOrderAt: customer.firstOrderAt ? dayjs(customer.firstOrderAt) : undefined,
      });
    }
  }, [open, customer, antForm]);

  /** 保存：先走 antd 校验，再提交 */
  const handleSave = async () => {
    if (!customer) return;
    try {
      const values = await antForm.validateFields();
      // 白名单 payload：仅提交本抽屉真实可编辑字段（不再 spread 整个 customer）
      const payload: CustomerEditablePayload = {
        companyName: values.companyName ?? '',
        contactName: values.contactName ?? '',
        position: values.position ?? '',
        country: values.country ?? '',
        images: values.images ?? '',
        // 沟通方式：过滤掉「工具/账号均为空」的占位行，避免写入空数据；无有效项则置 null
        contactMethods: (() => {
          const cms = Array.isArray(values.contactMethods)
            ? values.contactMethods.filter((m: any) => m && (m.tool || m.account))
            : [];
          return cms.length ? cms : null;
        })(),
        // 旧字段保留回填（不再编辑），避免 PUT 全量替换导致历史 email/phone/wechat 丢失
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        wechat: customer.wechat ?? '',
        // 显式取值：DatePicker 清空 → null（服务端 dateField 接受 null），
        // 不再被 spread 出的旧 firstOrderAt 覆盖
        firstOrderAt: values.firstOrderAt
          ? (values.firstOrderAt as Dayjs).format('YYYY-MM-DD')
          : null,
        notes: values.notes ?? '',
      };
      setSaving(true);
      const { data } = await customerApi.update(customer.id, payload);
      // update 不返回 pipelines，重新拉取完整数据
      const detail = await customerApi.getById(customer.id);
      const updated = detail.data?.data ?? data.data;
      msg.success('客户信息已更新');
      onSaved?.(updated);
      onClose();
    } catch (e: any) {
      if (e?.errorFields) {
        // antd 校验失败，错误已显示在字段下方
        return;
      }
      const errMsg = e?.response?.data?.message || e?.message || '保存失败，请重试';
      msg.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  if (!customer) return null;

  return createPortal(
    <>
      {/* 遮罩层 */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: Z_INDEX.drawerMask,
            transition: 'opacity 0.25s ease',
          }}
        />
      )}

      {/* 抽屉面板 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: open ? 0 : -520,
          bottom: 0,
          width: 500,
          maxWidth: '90vw',
          background: token.colorBgContainer,
          boxShadow: '-8px 0 30px rgba(0,0,0,0.1)',
          zIndex: Z_INDEX.drawer,
          display: 'flex',
          flexDirection: 'column',
          transition: 'right 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
          overflow: 'hidden',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: token.colorTextHeading }}>编辑客户资料</div>
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{customer.customerNo || '-'}</div>
          </div>
          <button
            onClick={onClose}
            type="button"
            style={{
              width: 28, height: 28, borderRadius: ds.radius, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: token.colorFillQuaternary, color: token.colorTextSecondary,
              fontSize: 13, transition: 'all 0.22s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillSecondary; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = token.colorFillQuaternary; }}
          >
            <CloseOutlined />
          </button>
        </div>

        {/* 表单内容区（可滚动，真实 DOM 容器给 popup 挂载） */}
        <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          <Form
            form={antForm}
            component="div"
            layout="vertical"
            style={{ width: '100%' }}
          >
            <Form.Item key="company" name="companyName" label="公司" rules={[{ required: true, message: '请输入公司' }]}>
              <Input size="large" placeholder="请输入公司名称" style={{ borderRadius: ds.radius }} />
            </Form.Item>

            <FormRow>
              <Form.Item key="contact" name="contactName" label="联系人">
                <Input size="large" placeholder="请输入联系人姓名" style={{ borderRadius: ds.radius }} />
              </Form.Item>
              <Form.Item key="position" name="position" label="职位">
                <Input size="large" placeholder="请输入职位" style={{ borderRadius: ds.radius }} />
              </Form.Item>
            </FormRow>

            <Form.Item name="country" label="所在地区">
              <CountrySelect size="large" placeholder="请选择国家/地区" style={{ borderRadius: ds.radius }} getPopupContainer={createPopupContainer(contentRef)} />
            </Form.Item>

            <Form.Item name="images" label="名片" valuePropName="value">
              <ProductImageList uploadUrl="/upload" />
            </Form.Item>

            <Form.Item
              name="contactMethods"
              label="联系方式"
              rules={[{ required: true, message: '请至少填写一条联系方式' }]}
            >
              <ContactMethodInput options={commToolOptions} size="large" />
            </Form.Item>

            <Form.Item name="firstOrderAt" label="首次合作日期">
              <DatePicker
                size="large"
                style={{ width: '100%', borderRadius: ds.radius, fontSize: 16 }}
                placeholder="请选择首次合作日期"
                getPopupContainer={createPopupContainer(contentRef)}
              />
            </Form.Item>

            <Form.Item name="notes" label="备注">
              <TextArea size="large" rows={3} placeholder="请输入备注信息" style={{ borderRadius: 8, fontSize: 16 }} />
            </Form.Item>

            {/* 历史备注（只读展示） */}
            {customer.notes && (
              <div style={{ marginTop: 8, padding: 12, background: token.colorFillQuaternary, borderRadius: 8 }}>
                <span style={{ fontSize: 14, color: token.colorTextTertiary, display: 'block', marginBottom: 6 }}>历史备注</span>
                <p style={{ margin: 0, fontSize: 14, color: token.colorTextHeading, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {customer.notes}
                </p>
              </div>
            )}
          </Form>
        </div>

        {/* 底部操作栏 */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            background: token.colorBgContainer,
          }}
        >
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>修改后将立即更新显示</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: ds.controlSm, padding: '0 18px', border: `1px solid ${token.colorBorder}`, borderRadius: ds.radius,
                background: 'transparent', color: token.colorTextSecondary, fontSize: 13, cursor: 'pointer',
                transition: 'all 0.22s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = token.colorPrimary; e.currentTarget.style.color = token.colorPrimary; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = token.colorBorder; e.currentTarget.style.color = token.colorTextSecondary; }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                height: ds.controlSm, padding: '0 18px', border: 'none', borderRadius: ds.radius,
                background: saving ? token.colorTextDisabled : token.colorPrimary, color: '#fff',
                fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.22s ease',
              }}
            >
              <SaveOutlined /> 保存更改
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default CustomerEditDrawer;
