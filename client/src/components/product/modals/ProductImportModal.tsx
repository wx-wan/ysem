import React from 'react';
import { Modal, Upload, Button, Alert, App } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import { importProductApi, BatchCreateResult } from '../../../api/products';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ProductImportModal: React.FC<Props> = React.memo(({ open, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [file, setFile] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleImport = async () => {
    if (!file) {
      message.warning('请选择文件');
      return;
    }
    try {
      setLoading(true);
      const res = await importProductApi.importExcel(file);
      const d = res.data?.data as BatchCreateResult | undefined;
      if (d) {
        if (d.failCount === 0) message.success(`导入成功，共 ${d.successCount} 条`);
        else message.warning(`成功 ${d.successCount} 条，失败 ${d.failCount} 条`);
      } else {
        message.success('导入成功');
      }
      onClose();
      onSuccess();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '导入失败');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (open) setFile(null);
  }, [open]);

  const handleDownloadTemplate = () => {
    importProductApi.downloadTemplate();
  };

  return (
    <Modal
      title="Excel 导入产品"
      open={open}
      onOk={handleImport}
      onCancel={onClose}
      confirmLoading={loading}
      okText="导入"
      zIndex={2000}
    >
      <Alert
        message="请下载模板，按模板格式填写产品数据后上传。工艺/受众/品类/认证资质/可见人员填写名称（多个用「、」分隔），系统自动按名称匹配。"
        type="info"
        showIcon
        style={{ marginBottom: 16, marginTop: 12 }}
      />
      <div style={{ marginBottom: 12 }}>
        <Button icon={<DownloadOutlined />} type="link" onClick={handleDownloadTemplate}>
          下载导入模板
        </Button>
      </div>
      <Upload
        accept=".xlsx,.xls"
        maxCount={1}
        beforeUpload={(f) => {
          setFile(f);
          return false;
        }}
        onRemove={() => setFile(null)}
        fileList={file ? [{
          uid: '-1',
          name: file.name,
          status: 'done' as const,
        }] : []}
      >
        <Button icon={<UploadOutlined />}>选择 Excel 文件</Button>
      </Upload>
    </Modal>
  );
});

export default ProductImportModal;
