import React, { useEffect, useState } from 'react';
import { Input, DatePicker, App, theme } from 'antd';
import { CloseOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Customer, customerApi } from '../../../api/customers';
import TagSelector from '../../TagSelector';
import CountrySelect from '../../CountrySelect';
import { Z_INDEX, createPopupContainer } from '../../../zIndex';
import { useDs } from '../shared/ds';

const { TextArea } = Input;

interface CustomerEditDrawerProps {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSaved?: (customer: Customer) => void;
}

/** 表单字段标签样式 */
function FieldLabel({ children }: { children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <span style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4, display: 'block', lineHeight: 1.5 }}>
      {children}
      <span style={{ color: '#ff4d4f', marginLeft: 2 }}>*</span>
    </span>
  );
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

  // 表单状态
  const [form, setForm] = useState<Partial<Customer>>({});
  const [saving, setSaving] = useState(false);

  // 内容容器 ref，用于让 antd 浮层挂载在抽屉内、避免被层级遮挡
  const contentRef = React.useRef<HTMLDivElement>(null);

  // 打开时初始化表单
  useEffect(() => {
    if (open && customer) {
      setForm({
        companyName: customer.companyName,
        contactName: customer.contactName,
        englishName: customer.englishName,
        position: customer.position,
        email: customer.email,
        phone: customer.phone,
        wechat: customer.wechat,
        country: customer.country,
        region: customer.region,
        notes: customer.notes,
        tags: customer.tags || '',
        firstOrderDate: customer.firstOrderDate,
      });
    }
  }, [open, customer]);

  /** 更新单个字段 */
  const updateField = <K extends keyof Partial<Customer>>(field: K, value: Customer[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  /** 保存 */
  const handleSave = async () => {
    if (!customer) return;
    if (!form.companyName?.trim()) {
      msg.warning('请输入公司名称');
      return;
    }

    setSaving(true);
    try {
      const { data } = await customerApi.update(customer.id, form);
      // update 不返回 pipelines，重新拉取完整数据
      const detail = await customerApi.getById(customer.id);
      const updated = detail.data?.data ?? data.data;
      msg.success('客户信息已更新');
      onSaved?.(updated);
      onClose();
    } catch (e: any) {
      const errMsg = e?.response?.data?.message || e?.message || '保存失败，请重试';
      msg.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  if (!customer) return null;

  return (
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
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>CIS-{customer.id.slice(0, 6)}</div>
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

        {/* 表单内容区（可滚动） */}
        <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* 姓名/联系人 */}
          <div style={{ marginBottom: 16 }}>
            <FieldLabel>姓名</FieldLabel>
            <Input
              size="large"
              placeholder="请输入联系人姓名"
              value={form.contactName ?? ''}
              onChange={(e) => updateField('contactName', e.target.value)}
              style={{ borderRadius: ds.radius }}
            />
          </div>

          {/* 公司 + 职位 */}
          <FormRow>
            <div style={{ marginBottom: 16 }}>
              <FieldLabel>公司</FieldLabel>
              <Input
                size="large"
                placeholder="请输入公司名称"
                value={form.companyName ?? ''}
                onChange={(e) => updateField('companyName', e.target.value)}
                style={{ borderRadius: ds.radius }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <FieldLabel>职位</FieldLabel>
              <Input
                size="large"
                placeholder="请输入职位"
                value={form.position ?? ''}
                onChange={(e) => updateField('position', e.target.value)}
                style={{ borderRadius: ds.radius }}
              />
            </div>
          </FormRow>

          {/* 所在地区 */}
          <div style={{ marginBottom: 16 }}>
            <FieldLabel>所在地区</FieldLabel>
            <CountrySelect
              value={(form.country as string) || undefined}
              onChange={(v) => updateField('country', v as string)}
              placeholder="请选择国家/地区"
              style={{ borderRadius: ds.radius }}
              getPopupContainer={createPopupContainer(contentRef)}
            />
          </div>

          {/* 联系方式 — 邮箱 */}
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4, display: 'block', lineHeight: 1.5 }}>联系方式</span>
            <Input
              size="large"
              placeholder="请输入邮箱地址"
              value={form.email ?? ''}
              onChange={(e) => updateField('email', e.target.value)}
              prefix={<span style={{ color: token.colorTextTertiary, marginRight: 6 }}>✉</span>}
              style={{ borderRadius: ds.radius }}
            />
          </div>

          {/* 电话 + 微信 */}
          <FormRow>
            <div style={{ marginBottom: 16 }}>
              <FieldLabel>电话</FieldLabel>
              <Input
                size="large"
                placeholder="请输入联系电话"
                value={form.phone ?? ''}
                onChange={(e) => updateField('phone', e.target.value)}
                style={{ borderRadius: ds.radius }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <FieldLabel>微信</FieldLabel>
              <Input
                size="large"
                placeholder="请输入微信号"
                value={form.wechat ?? ''}
                onChange={(e) => updateField('wechat', e.target.value)}
                style={{ borderRadius: ds.radius }}
              />
            </div>
          </FormRow>

          {/* 首次合作日期 */}
          <div style={{ marginBottom: 16 }}>
            <FieldLabel>首次合作日期</FieldLabel>
            <DatePicker
              size="large"
              style={{ width: '100%', borderRadius: ds.radius }}
              placeholder="请选择首次合作日期"
              value={form.firstOrderDate ? dayjs(form.firstOrderDate) : null}
              onChange={(date) => updateField('firstOrderDate', date ? date.format('YYYY-MM-DD') : undefined)}
              getPopupContainer={createPopupContainer(contentRef)}
            />
          </div>

          {/* 标签 */}
          <div style={{ marginBottom: 16 }}>
            <FieldLabel>标签</FieldLabel>
            <TagSelector
              value={form.tags}
              onChange={(v) => updateField('tags', v)}
              placeholder="输入标签后回车添加"
              showAddButton
              style={{ minHeight: ds.control, padding: '4px 11px', borderRadius: ds.radius, border: `1px solid ${token.colorBorder}`, background: token.colorBgContainer }}
            />
          </div>

          {/* 备注 */}
          <div style={{ marginBottom: 16 }}>
            <FieldLabel>备注</FieldLabel>
            <TextArea
              rows={3}
              placeholder="请输入备注信息"
              value={form.notes ?? ''}
              onChange={(e) => updateField('notes', e.target.value)}
              style={{ borderRadius: 8, fontSize: 14 }}
            />
          </div>

          {/* 历史备注（只读展示） */}
          {customer.notes && (
            <div style={{ marginTop: 8, padding: 12, background: token.colorFillQuaternary, borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: token.colorTextTertiary, display: 'block', marginBottom: 6 }}>历史备注</span>
              <p style={{ margin: 0, fontSize: 13, color: token.colorTextHeading, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                {customer.notes}
              </p>
            </div>
          )}
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
    </>
  );
};

export default CustomerEditDrawer;
