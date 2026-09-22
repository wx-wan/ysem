import { Menu } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermission } from '../auth/usePermission';
import {
  APP_MENU,
  filterMenuByPermission,
  findAncestorKeys,
  findMenuItemByKey,
  findSelectedKey,
  type AppMenuItem,
} from '../router/menu';

const toAntdItems = (items: AppMenuItem[]): MenuProps['items'] =>
  items.map((item) => ({
    key: item.key,
    label: item.label,
    children: item.children && item.children.length > 0 ? toAntdItems(item.children) : undefined,
  }));

/**
 * 侧边栏菜单：按当前用户权限过滤（usePermission）+ 路由高亮。
 * 点击使用 react-router navigate（保持 SPA，不做整页跳转）。
 */
export default function AppMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPerm } = usePermission();

  const items = useMemo(() => filterMenuByPermission(APP_MENU, { hasPerm }), [hasPerm]);
  const selectedKey = useMemo(() => findSelectedKey(items, location.pathname), [items, location.pathname]);
  const [openKeys, setOpenKeys] = useState<string[]>(() => findAncestorKeys(items, selectedKey ?? ''));

  // 路由变化时确保选中项的祖先处于展开状态（用户手动折叠的其他组不受影响）
  useEffect(() => {
    if (!selectedKey) return;
    const ancestors = findAncestorKeys(items, selectedKey);
    if (ancestors.length === 0) return;
    setOpenKeys((prev) => Array.from(new Set([...prev, ...ancestors])));
  }, [items, selectedKey]);

  const antdItems = useMemo(() => toAntdItems(items), [items]);

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    const target = findMenuItemByKey(items, key);
    if (target?.path) navigate(target.path);
  };

  return (
    <Menu
      theme="dark"
      mode="inline"
      items={antdItems}
      selectedKeys={selectedKey ? [selectedKey] : []}
      openKeys={openKeys}
      onOpenChange={setOpenKeys}
      onClick={handleClick}
    />
  );
}
