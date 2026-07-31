import React from 'react';
import { Modal, Upload, Button, Alert, App } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  api: {
    importExcel: (file: File) => Promise<any>;
    downloadTemplate: () => void;
  };
}

const ImportModal: React.FC<Props> = React.memo(({ open, onClose, onSuccess, api }) => {
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
      await api.importExcel(file);
      message.success('导入成功');
      onClose();
      onSuccess();
    } catch {
      message.error('导入失败');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (open) setFile(null);
  }, [open]);

  return (
    <Modal
      title="批量导入"
      open={open}
      onOk={handleImport}
      onCancel={onClose}
      confirmLoading={loading}
      okText="导入"
      zIndex={2000}
    >
      <Alert
        message="请下载模板，按照模板格式填写数据后上传"
        type="info"
        showIcon
        style={{ marginBottom: 16, marginTop: 12 }}
      />
      <div style={{ marginBottom: 12 }}>
        <Button icon={<DownloadOutlined />} type="link" onClick={api.downloadTemplate}>
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

export default ImportModal;
