import React from 'react';
import { Modal, Tree, App } from 'antd';

interface PermissionNode {
  id: string;
  name: string;
  code: string;
  children?: PermissionNode[];
}

interface Props {
  open: boolean;
  roleId: string;
  onClose: () => void;
  onSuccess: () => void;
  api: {
    getPermissions: () => Promise<any>;
    getRole: (id: string) => Promise<any>;
    assign: (roleId: string, permissionIds: string[]) => Promise<any>;
  };
  t: (key: string, options?: any) => string;
}

const RolePermModal: React.FC<Props> = React.memo(({ open, roleId, onClose, onSuccess, api, t }) => {
  const { message } = App.useApp();
  const [permissions, setPermissions] = React.useState<PermissionNode[]>([]);
  const [checkedKeys, setCheckedKeys] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open && roleId) {
      const fetchData = async () => {
        const [permRes, roleRes] = await Promise.all([
          api.getPermissions(),
          api.getRole(roleId),
        ]);
        setPermissions(permRes.data.data || []);
        const rolePermIds = (roleRes.data.data?.permissions || []).map(
          (p: { permissionId: string }) => p.permissionId
        );
        setCheckedKeys(rolePermIds);
      };
      fetchData();
    }
  }, [open, roleId, api]);

  const handleAssign = async () => {
    try {
      setLoading(true);
      await api.assign(roleId, checkedKeys);
      message.success(t('role.assignSuccess'));
      onClose();
      onSuccess();
    } catch {
      message.error('分配权限失败');
    } finally {
      setLoading(false);
    }
  };

  const buildTree = (perms: PermissionNode[]): any[] => {
    return perms.map((p) => ({
      ...p,
      key: p.id,
      title: `${p.name} (${p.code})`,
      children: p.children?.length ? buildTree(p.children) : undefined,
    }));
  };

  return (
    <Modal
      title={t('role.assignPerm')}
      open={open}
      onCancel={onClose}
      onOk={handleAssign}
      confirmLoading={loading}
      width={520}
      zIndex={2000}
    >
      <Tree
        checkable
        defaultExpandAll
        checkedKeys={checkedKeys}
        onCheck={(keys) => setCheckedKeys(keys as string[])}
        treeData={buildTree(permissions)}
        style={{ marginTop: 16 }}
      />
    </Modal>
  );
});

export default RolePermModal;
