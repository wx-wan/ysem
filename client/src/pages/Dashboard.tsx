import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic } from 'antd';
import { UserOutlined, TeamOutlined, ApartmentOutlined, SafetyOutlined } from '@ant-design/icons';
import request from '../api/request';

export default function DashboardPage() {
  const [stats, setStats] = useState({ users: 0, roles: 0, depts: 0, perms: 0 });

  useEffect(() => {
    Promise.all([
      request.get('/users?pageSize=1'),
      request.get('/roles'),
      request.get('/departments'),
      request.get('/permissions'),
    ]).then(([usersRes, rolesRes, deptsRes, permsRes]) => {
      setStats({
        users: usersRes.data.data?.total || 0,
        roles: rolesRes.data.data?.length || 0,
        depts: deptsRes.data.data?.length || 0,
        perms: permsRes.data.data?.length || 0,
      });
    }).catch(() => {});
  }, []);

  return (
    <>
      <div className="page-header"><h2>仪表盘</h2></div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic title="用户总数" value={stats.users} prefix={<UserOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic title="角色数量" value={stats.roles} prefix={<TeamOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic title="部门数量" value={stats.depts} prefix={<ApartmentOutlined />} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card hoverable>
            <Statistic title="权限数量" value={stats.perms} prefix={<SafetyOutlined />} valueStyle={{ color: '#eb2f96' }} />
          </Card>
        </Col>
      </Row>
    </>
  );
}
