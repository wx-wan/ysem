import React, { useEffect, useState } from 'react';
import {
  Modal, Table, Input, Button, Select, Space, Tag, App, Popconfirm, Divider, Typography,
} from 'antd';
import { PlusOutlined, DeleteOutlined, CopyOutlined, UploadOutlined } from '@ant-design/icons';
import { taxonomyApi, ProductCraft, ProductAudience } from '../../../api/products';
import { batchProductApi, BatchProductRow } from '../../../api/products';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface RowState {
  key: string;
  name: string;
  craftIds: string[];
  audienceId: string;
  categoryId: string;
  weight: string;
  supplyModes: string;
  description: string;
  remark: string;
}

let uid = 0;
const newRow = (): RowState => ({ key: `r${uid++}`, name: '', craftIds: [], audienceId: '', categoryId: '', weight: '', supplyModes: '', description: '', remark: '' });

export default function BatchCreateProductModal({ open, onClose, onSuccess }: Props) {
  const { message } = App.useApp();
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  const [rows, setRows] = useState<RowState[]>([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ successCount: number; failCount: number; failed: { index: number; name?: string; reason: string }[] } | null>(null);

  // 公共分类（应用到全部行）
  const [commonCraftIds, setCommonCraftIds] = useState<string[]>([]);
  const [commonAudienceId, setCommonAudienceId] = useState<string>('');
  const [commonWeight, setCommonWeight] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    taxonomyApi.getCrafts().then((r) => setCrafts(r.data?.data ?? [])).catch(() => {});
    taxonomyApi.getAudiences().then((r) => setAudiences(r.data?.data ?? [])).catch(() => {});
  }, [open]);

  const categoriesOf = (audienceId: string) =>
    audiences.find((a) => a.id === audienceId)?.categories ?? [];

  const updateRow = (key: string, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (key: string) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  const copyRow = (key: string) =>
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.key === key);
      if (idx < 0) return prev;
      const copy = { ...prev[idx], key: `r${uid++}` };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });

  // 解析 Excel 粘贴的多行文本：第一列为名称，支持 tab/逗号分隔
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return;
    e.preventDefault();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: RowState[] = lines.map((line) => {
      const parts = line.split(/\t|,|，/).map((s) => s.trim());
      return { ...newRow(), name: parts[0] || '', weight: parts[1] || '' };
    });
    if (parsed.length) setRows(parsed);
  };

  const applyCommon = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        craftIds: commonCraftIds.length ? commonCraftIds : r.craftIds,
        audienceId: commonAudienceId || r.audienceId,
        weight: commonWeight || r.weight,
      })),
    );
    message.success('已把公共分类应用到所有行');
  };

  const handleSubmit = async () => {
    const payload: BatchProductRow[] = rows.map((r) => ({
      name: r.name,
      craftIds: r.craftIds,
      audienceId: r.audienceId,
      categoryId: r.categoryId,
      weight: r.weight,
      supplyModes: r.supplyModes || 'DEEP_CUSTOM',
      description: r.description,
      remark: r.remark,
      visibility: 'PUBLIC',
      visibleUserIds: [],
    }));
    const empty = payload.filter((p) => !p.name || !p.craftIds?.length || !p.audienceId);
    if (empty.length) {
      message.error(`有 ${empty.length} 行缺少「名称/工艺/受众」，请补全后再提交`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await batchProductApi.create(payload);
      const d = res.data?.data;
      if (d) {
        setResult({ successCount: d.successCount, failCount: d.failCount, failed: d.failed });
        if (d.failCount === 0) message.success(`成功批量创建 ${d.successCount} 个产品`);
        else message.warning(`成功 ${d.successCount}，失败 ${d.failCount}`);
        onSuccess();
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '批量创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setRows([newRow()]);
    setResult(null);
    setCommonCraftIds([]);
    setCommonAudienceId('');
    setCommonWeight('');
    onClose();
  };

  const columns = [
    { title: '#', width: 48, render: (_: any, _r: any, i: number) => i + 1 },
    {
      title: '产品名称', width: 220, required: true,
      render: (_: any, r: RowState) => (
        <Input
          value={r.name}
          placeholder="必填"
          onChange={(e) => updateRow(r.key, { name: e.target.value })}
          status={!r.name ? 'error' : undefined}
        />
      ),
    },
    {
      title: '工艺', width: 220, required: true,
      render: (_: any, r: RowState) => (
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="必选"
          value={r.craftIds}
          onChange={(v) => updateRow(r.key, { craftIds: v })}
          options={crafts.map((c) => ({ label: c.name, value: c.id }))}
          status={!r.craftIds.length ? 'error' : undefined}
        />
      ),
    },
    {
      title: '受众', width: 160, required: true,
      render: (_: any, r: RowState) => (
        <Select
          style={{ width: '100%' }}
          placeholder="必选"
          value={r.audienceId || undefined}
          onChange={(v) => updateRow(r.key, { audienceId: v, categoryId: '' })}
          options={audiences.map((a) => ({ label: a.name, value: a.id }))}
          status={!r.audienceId ? 'error' : undefined}
        />
      ),
    },
    {
      title: '品类', width: 140,
      render: (_: any, r: RowState) => (
        <Select
          style={{ width: '100%' }}
          placeholder="可选"
          value={r.categoryId || undefined}
          onChange={(v) => updateRow(r.key, { categoryId: v })}
          options={categoriesOf(r.audienceId).map((c) => ({ label: c.name, value: c.id }))}
        />
      ),
    },
    {
      title: '克重(g)', width: 110,
      render: (_: any, r: RowState) => (
        <Input value={r.weight} placeholder="如 120" onChange={(e) => updateRow(r.key, { weight: e.target.value })} />
      ),
    },
    {
      title: '备注', width: 160,
      render: (_: any, r: RowState) => (
        <Input value={r.remark} onChange={(e) => updateRow(r.key, { remark: e.target.value })} />
      ),
    },
    {
      title: '操作', width: 110, fixed: 'right' as const,
      render: (_: any, r: RowState) => (
        <Space size={4}>
          <Button size="small" icon={<CopyOutlined />} onClick={() => copyRow(r.key)} />
          <Popconfirm title="删除该行？" onConfirm={() => removeRow(r.key)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title="批量新建产品"
      open={open}
      onCancel={handleClose}
      width={1180}
      footer={[
        <Button key="close" onClick={handleClose}>关闭</Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={handleSubmit}>
          提交（{rows.length} 条）
        </Button>,
      ]}
    >
      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          <Text type="secondary">公共分类（应用到全部行）：</Text>
          <Select
            mode="multiple" placeholder="工艺" style={{ minWidth: 240 }}
            value={commonCraftIds} onChange={setCommonCraftIds}
            options={crafts.map((c) => ({ label: c.name, value: c.id }))}
          />
          <Select
            placeholder="受众" style={{ minWidth: 160 }}
            value={commonAudienceId || undefined} onChange={setCommonAudienceId}
            options={audiences.map((a) => ({ label: a.name, value: a.id }))}
          />
          <Input placeholder="克重(g)" style={{ width: 110 }} value={commonWeight} onChange={(e) => setCommonWeight(e.target.value)} />
          <Button icon={<CopyOutlined />} onClick={applyCommon}>应用到全部</Button>
        </Space>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      <Space style={{ marginBottom: 8 }}>
        <Button type="dashed" icon={<PlusOutlined />} onClick={addRow}>新增一行</Button>
        <Button icon={<UploadOutlined />} onClick={() => message.info('选中下方输入框可直接粘贴 Excel 多行（第一列=名称，第二列=克重）')}>
          粘贴说明
        </Button>
        <Tag>一产品一 SKU，不做聚合</Tag>
      </Space>

      <Table
        rowKey="key"
        size="small"
        columns={columns as any}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 1180, y: 360 }}
      />
      <div style={{ marginTop: 8 }}>
        <Input.TextArea
          rows={2}
          placeholder="（可选）在此粘贴 Excel 多行：每行一个产品，第一列名称、第二列克重，Tab/逗号分隔"
          onPaste={handlePaste}
        />
      </div>

      {result && (
        <div style={{ marginTop: 12, padding: 12, background: '#f6f8fa', borderRadius: 8 }}>
          <Text strong>提交结果：</Text> 成功 <Tag color="green">{result.successCount}</Tag> 失败 <Tag color="red">{result.failCount}</Tag>
          {result.failed.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {result.failed.map((f, i) => (
                <li key={i}><Text type="danger">第 {f.index + 1} 行{f.name ? `（${f.name}）` : ''}：{f.reason}</Text></li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
