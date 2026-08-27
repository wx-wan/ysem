import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input, DatePicker, App, theme, Form } from 'antd';
import { CloseOutlined, SaveOutlined, MailOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Customer, customerApi } from '../../../api/customers';
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
        email: customer.email,
        phone: customer.phone,
        wechat: customer.wechat,
        country: customer.country,
        region: customer.region,
        notes: customer.notes,
        tags: customer.tags || '',
        firstOrderDate: customer.firstOrderDate ? dayjs(customer.firstOrderDate) : undefined,
      });
    }
  }, [open, customer, antForm]);

  /** 保存：先走 antd 校验，再提交 */
  const handleSave = async () => {
    if (!customer) return;
    try {
      const values = await antForm.validateFields();
      const payload: Record<string, any> = { ...customer, ...values };
      if (payload.firstOrderDate && dayjs.isDayjs(payload.firstOrderDate)) {
        payload.firstOrderDate = payload.firstOrderDate.format('YYYY-MM-DD');
      }
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
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>{customer.customerCode || '-'}</div>
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
              <CountrySelect placeholder="请选择国家/地区" style={{ borderRadius: ds.radius }} getPopupContainer={createPopupContainer(contentRef)} />
            </Form.Item>

            <Form.Item name="email" label="邮箱">
              <Input
                size="large"
                placeholder="请输入邮箱地址"
                prefix={<MailOutlined style={{ color: token.colorTextTertiary }} />}
                style={{ borderRadius: ds.radius }}
              />
            </Form.Item>

            <FormRow>
              <Form.Item key="phone" name="phone" label="电话">
                <Input size="large" placeholder="请输入联系电话" style={{ borderRadius: ds.radius }} />
              </Form.Item>
              <Form.Item key="wechat" name="wechat" label="微信">
                <Input size="large" placeholder="请输入微信号" style={{ borderRadius: ds.radius }} />
              </Form.Item>
            </FormRow>

            <Form.Item name="firstOrderDate" label="首次合作日期">
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
