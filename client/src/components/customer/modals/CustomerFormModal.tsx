import React from 'react';
import { Button, Form, Input, Row, Col, App } from 'antd';
import { CheckOutlined, CloseOutlined, ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { customerApi, Customer } from '../../../api/customers';
import AppModal from '../../AppModal';
import CustomerInfoFields from '../../common/CustomerInfoFields';
import type { ContactMethodHandle } from '../../common/ContactMethodInput';
import { useCommToolOptions } from '../../../stores/useCommToolStore';
import { channelApi, type Channel } from '../../../api/channel';

interface Props {
  open: boolean;
  editingCustomer: Customer | null;
  /** 新增模式下预填的公司名称（用于线索建档等场景带入） */
  initialCompanyName?: string;
  /** 新增模式下预填的联系人（线索建档场景带入） */
  initialContactName?: string;
  /** 新增模式下预填的国家（线索建档场景带入，需为中文名以便 CountrySelect 选中） */
  initialCountry?: string;
  /** 新增模式下预填的线索来源（渠道·平台组合 JSON，线索建档场景带入） */
  initialSourceKey?: string;
  /** 新增模式下预填的联系方式（线索建档场景带入，[{tool, account}]） */
  initialContactMethods?: { tool: string; account: string }[];
  /** 强制模式：隐藏取消/关闭按钮，必须填完保存（用于转商机时强制建档） */
  force?: boolean;
  onClose: () => void;
  /** 保存成功后回调；新建成功时携带新客户对象 */
  onSuccess?: (customer?: Customer) => void;
}

// 与「新建线索 · 客户信息」阶段对齐：基础信息单阶段包含全部客户字段
// （公司名称 · 国家/地区 · 客户类型 · 联系人 · 联系方式 · 来源），
// 校验与线索一致（联系方式由 ContactMethodInput 字段级校验）。
const STEP_FIELDS: string[][] = [
  ['companyName', 'country', 'customerType', 'contactName', 'contactMethods', 'sourceKey'],
];

/**
 * 新增 / 编辑客户弹窗：三步向导（基本信息 → 联系方式 → 商务配置）。
 * 弹窗外壳复用线索向导的设计规范（.lead-wizard-header / steps / footer），
 * 客户字段沿用 CustomerInfoFields 公共组件（按步骤拆分渲染）。
 */
const CustomerFormModal: React.FC<Props> = React.memo(
  ({
    open,
    editingCustomer,
    initialCompanyName,
    initialContactName,
    initialCountry,
    initialSourceKey,
    initialContactMethods,
    force,
    onClose,
    onSuccess,
  }) => {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const [saving, setSaving] = React.useState(false);
    // 三步向导当前步骤（0 基本信息 / 1 联系方式 / 2 商务配置）
    const [step, setStep] = React.useState(0);
    const contactMethodRef = React.useRef<ContactMethodHandle>(null);
    const { options: commToolOptions } = useCommToolOptions();
    const [channels, setChannels] = React.useState<Channel[]>([]);

    // 来源（渠道·平台）下拉选项：与线索来源同源，组合值为 JSON {channelId, shopId}
    const sourceOptions = React.useMemo(() => {
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

    const wizardSteps = React.useMemo(() => [t('customer.stepBasic')], [t]);

    React.useEffect(() => {
      if (open) {
        channelApi
          .tree()
          .then((r) => setChannels(r.data ?? []))
          .catch(() => setChannels([]));
      }
    }, [open]);

    React.useEffect(() => {
      if (open) {
        setStep(0);
        contactMethodRef.current?.reset();
        if (editingCustomer) {
          // 编辑：将已存渠道/平台还原为来源组合值（shopId 缺省回退渠道自身）
          const sourceKey = editingCustomer.channelId
            ? JSON.stringify({ channelId: editingCustomer.channelId, shopId: editingCustomer.shopId || editingCustomer.channelId })
            : undefined;
          form.setFieldsValue({
            ...editingCustomer,
            country: editingCustomer.country ?? undefined,
            sourceKey,
            contactMethods: editingCustomer.contactMethods ?? undefined,
          });
        } else {
          form.resetFields();
          form.setFieldsValue({
            ...(initialCompanyName ? { companyName: initialCompanyName } : {}),
            ...(initialContactName ? { contactName: initialContactName } : {}),
            ...(initialCountry ? { country: initialCountry } : {}),
            ...(initialSourceKey ? { sourceKey: initialSourceKey } : {}),
            ...(initialContactMethods ? { contactMethods: initialContactMethods } : {}),
          });
        }
      }
    }, [open, editingCustomer, initialCompanyName, initialContactName, initialCountry, initialSourceKey, initialContactMethods, form]);

    // ============ 三步向导 ============
    const goNext = async () => {
      try {
        // 联系方式为自定义组件，与表单字段校验并行触发（与线索向导一致）
        const contactOk = step === 1 ? contactMethodRef.current?.validate() ?? true : true;
        // 仅校验当前步骤字段，通过后进入下一步
        await form.validateFields(STEP_FIELDS[step]);
        if (!contactOk) return;
        setStep((s) => Math.min(s + 1, wizardSteps.length - 1));
      } catch {
        /* 校验失败停留在当前步，错误提示由 Form.Item 展示 */
      }
    };

    const goPrev = () => setStep((s) => Math.max(s - 1, 0));

    const handleSave = async () => {
      // 联系方式：字段级校验（工具 / 账号分开判定），不通过时展示飘红并阻断提交
      if (!(contactMethodRef.current?.validate() ?? true)) return;
      try {
        // 校验当前挂载字段；取值用 getFieldsValue(true)（preserve 保留前序步骤值）
        await form.validateFields();
        const raw = form.getFieldsValue(true) as Record<string, unknown>;
        // 过滤空联系方式行（工具/账号均非空才有效）；全部为空时省略该字段：
        // 更新场景保留 DB 原值，新建场景由后端置 null（避免空行覆盖已有联系方式）
        const validContacts = Array.isArray(raw.contactMethods)
          ? (raw.contactMethods as { tool?: string; account?: string }[]).filter((m) => m && m.tool?.trim() && m.account?.trim())
          : [];
        const values: Record<string, unknown> = { ...raw };
        if (validContacts.length) values.contactMethods = validContacts;
        else delete values.contactMethods;
        setSaving(true);
        if (editingCustomer) {
          await customerApi.update(editingCustomer.id, values);
          message.success(t('common.updateSuccess'));
          onClose();
          onSuccess?.();
        } else {
          const res = await customerApi.create(values);
          message.success(t('common.createSuccess'));
          onClose();
          onSuccess?.(res.data.data);
        }
      } catch (e: unknown) {
        const err = e as { errorFields?: unknown; response?: { data?: { message?: string } }; message?: string };
        if (err.errorFields) return;
        const msg = err?.response?.data?.message || err?.message || t('common.saveFailed');
        message.error(msg);
      } finally {
        setSaving(false);
      }
    };

    return (
      <AppModal
        open={open}
        onClose={onClose}
        closable={false}
        headerBorder={false}
        headerPadding={0}
        width={760}
        bodyPadding={24}
        maskClosable={!force}
        style={{ borderRadius: 20 }}
        title={
          <div className="lead-wizard-header">
            {!force && (
              <button type="button" className="lead-wizard-header__close" onClick={onClose}>
                <CloseOutlined />
              </button>
            )}
            <div className="lead-wizard-header__title">{editingCustomer ? t('customer.editTitle') : t('customer.createTitle')}</div>
            <div className="lead-wizard-header__subtitle">{t('customer.wizardSubtitle')}</div>
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
        footer={
          <div className="lead-wizard-footer">
            <div className="lead-wizard-footer__side">
              {step > 0 ? (
                <Button type="link" size="large" icon={<ArrowLeftOutlined />} onClick={goPrev}>{t('lead.prevStep')}</Button>
              ) : (
                !force && <Button type="link" size="large" onClick={onClose}>{t('common.cancel')}</Button>
              )}
            </div>
            <div className="lead-wizard-footer__dots">
              {wizardSteps.map((_, i) => (
                <span key={i} className={`lead-wizard-footer__dot${i === step ? ' is-active' : ''}`} />
              ))}
            </div>
            <div className="lead-wizard-footer__side lead-wizard-footer__side--right">
              {step < wizardSteps.length - 1 ? (
                <Button size="large" type="primary" onClick={goNext}>
                  {t('lead.nextStep')} <ArrowRightOutlined />
                </Button>
              ) : (
                <Button size="large" type="primary" icon={<CheckOutlined />} loading={saving} onClick={handleSave}>
                  {t('common.save')}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <Form form={form} layout="vertical" autoComplete="off" size="large" className="customer-form-v2">
          {/* 基础信息（与「新建线索 · 客户信息」阶段对齐：公司名称 + 国家/地区/客户类型/联系人/联系方式/来源） */}
          {step === 0 && (
            <>
              <Row gutter={[16, 0]}>
                <Col span={24}>
                  <Form.Item
                    name="companyName"
                    label={t('customer.companyName')}
                    rules={[{ required: true, message: t('customer.companyNameRequired') }]}
                  >
                    <Input placeholder={t('customer.companyNamePlaceholder')} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="industry" label={t('customer.industry')}>
                    <Input placeholder={t('customer.industryPlaceholder')} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="website" label={t('customer.website')}>
                    <Input placeholder={t('customer.websitePlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
              {/* 国家/地区 · 客户类型 · 联系人 · 联系方式 · 来源：复用客户公共字段组件（与线索客户信息页一致） */}
              <CustomerInfoFields
                sourceOptions={sourceOptions}
                commToolOptions={commToolOptions}
                contactMethodRef={contactMethodRef}
              />
            </>
          )}
        </Form>
      </AppModal>
    );
  },
);

export default CustomerFormModal;
