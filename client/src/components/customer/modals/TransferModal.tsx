import React from 'react';
import { Modal, Select, App } from 'antd';
import { customerApi, Customer } from '../../../api/customers';
import { Z_INDEX } from '../../../zIndex';

interface Props {
  open: boolean;
  customer: Customer | null;
  userList: Array<{ id: string; realName: string }>;
  onClose: () => void;
  onSuccess: () => void;
}

const TransferModal: React.FC<Props> = React.memo(({ open, customer, userList, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [userId, setUserId] = React.useState<string | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);

  const handleTransfer = async () => {
    if (!customer || !userId) return;
    try {
      setLoading(true);
      await customerApi.transfer(customer.id, userId);
      message.success('转移成功');
      onClose();
      onSuccess();
    } catch {
      message.error('转移失败');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    setUserId(undefined);
  }, [open]);

  return (
    <Modal
      title="转移客户"
      open={open}
      onOk={handleTransfer}
      onCancel={onClose}
      confirmLoading={loading}
      okButtonProps={{ disabled: !userId }}
      zIndex={Z_INDEX.overlay}
    >
      <p style={{ marginTop: 12 }}>
        将客户 <strong>{customer?.companyName}</strong> 转移给：
      </p>
      <Select
        style={{ width: '100%' }}
        placeholder="选择负责人"
        value={userId}
        onChange={setUserId}
        options={userList.filter(u => u.id !== customer?.ownerId).map(u => ({
          label: u.realName,
          value: u.id,
        }))}
      />
    </Modal>
  );
});

export default TransferModal;
