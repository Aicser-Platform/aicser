import React, { useEffect } from 'react';
import { Card, Form, Button, Space, message, Row, Col, Avatar, Upload } from 'antd';
import { UserOutlined, EditOutlined, SaveOutlined, CameraOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { useTranslations } from 'next-intl';
import { useProfileStore } from '@/stores/useProfileStore';
import { ProfileForm } from './forms/ProfileForm';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';

export const ProfileTab: React.FC = () => {
  const t = useTranslations('settings');
  const [form] = Form.useForm();
  const { user } = useAuth();
  const {
    profile,
    loading,
    updating,
    fetchProfile,
    updateProfile,
    uploadAvatar,
  } = useProfileStore();

  const [isEditingProfile, setIsEditingProfile] = React.useState(false);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (profile) {
      form.setFieldsValue({
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        email: profile.email || user?.email || '',
        username: profile.username || '',
        phone_number: profile.phone_number || '',
        company: profile.company || '',
        location: profile.location || '',
        timezone: profile.timezone || '',
        bio: profile.bio || '',
        job_role: profile.job_role || '',
        industry: profile.industry || '',
        company_size: profile.company_size || '',
        data_experience: profile.data_experience || '',
        primary_use_case: profile.primary_use_case || '',
        data_frequency: profile.data_frequency || '',
      });
    } else if (user) {
      form.setFieldsValue({
        email: user.email || '',
      });
    }
  }, [profile, user, form]);

  const handleSubmit = async (values: any) => {
    try {
      const success = await updateProfile(values);
      if (success) {
        message.success(t('profile_update_success'));
        setIsEditingProfile(false);
      } else {
        message.error(t('profile_update_failed'));
      }
    } catch (error: any) {
      message.error(error?.message || t('profile_update_failed'));
    }
  };

  const handleCancel = () => {
    setIsEditingProfile(false);
    if (profile) {
      form.setFieldsValue({
        first_name: profile.first_name || '',
        last_name: profile.last_name || '',
        email: profile.email || '',
        username: profile.username || '',
        phone_number: profile.phone_number || '',
        company: profile.company || '',
        location: profile.location || '',
        timezone: profile.timezone || '',
        bio: profile.bio || '',
        job_role: profile.job_role || '',
        industry: profile.industry || '',
        company_size: profile.company_size || '',
        data_experience: profile.data_experience || '',
        primary_use_case: profile.primary_use_case || '',
        data_frequency: profile.data_frequency || '',
      });
    }
  };

  const cardStyle = { background: 'var(--color-fill-quaternary)', borderRadius: 8 };

  return (
    <>
      <Card
        size="small"
        bordered={false}
        style={cardStyle}
        title={t('profile_personal_information')}
        extra={
          <Space>
            {isEditingProfile ? (
              <>
                <Button onClick={handleCancel}>{t('cancel')}</Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={() => form.submit()}
                  loading={updating}
                >
                  {t('save_changes')}
                </Button>
              </>
            ) : (
              <Button type="primary" icon={<EditOutlined />} onClick={() => setIsEditingProfile(true)}>
                {t('profile_edit')}
              </Button>
            )}
          </Space>
        }
      >
        <Row gutter={24}>
          <Col xs={24} md={6} style={{ textAlign: 'center', marginBottom: 24 }}>
            <Avatar
              size={120}
              src={profile?.avatar_url || undefined}
              icon={!profile?.avatar_url ? <UserOutlined /> : undefined}
              style={{ marginBottom: 16 }}
            />
            {isEditingProfile && (
              <Upload
                showUploadList={false}
                accept="image/jpeg,image/png,image/gif,image/webp"
                beforeUpload={(file) => {
                  uploadAvatar(file).then((url) => {
                    if (url) message.success(t('profile_avatar_updated'));
                  });
                  return false;
                }}
              >
                <Button type="link" icon={<CameraOutlined />} loading={updating}>
                  {t('profile_change_avatar')}
                </Button>
              </Upload>
            )}
          </Col>
          <Col xs={24} md={18}>
            <ProfileForm form={form} onFinish={handleSubmit} disabled={!isEditingProfile} />
          </Col>
        </Row>
      </Card>
    </>
  );
};

