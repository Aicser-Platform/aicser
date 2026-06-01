import React, { useEffect } from 'react';
import { Card, Form, Button, Space, message, Avatar, Upload, Typography } from 'antd';
import { UserOutlined, EditOutlined, SaveOutlined, CameraOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useProfileStore } from '@/stores/useProfileStore';
import { ProfileForm } from './forms/ProfileForm';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import type { TabComponentProps } from '../page';

export const ProfileTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
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

  // Register action button in page header (Vercel-style: right of title)
  useEffect(() => {
    if (!onSetAction) return;
    if (isEditingProfile) {
      onSetAction(
        <Space>
          <Button onClick={() => { setIsEditingProfile(false); if (profile) { form.setFieldsValue({ first_name: profile.first_name || '', last_name: profile.last_name || '', email: profile.email || '', username: profile.username || '', phone_number: profile.phone_number || '', company: profile.company || '', location: profile.location || '', timezone: profile.timezone || '', bio: profile.bio || '', job_role: profile.job_role || '', industry: profile.industry || '', company_size: profile.company_size || '', data_experience: profile.data_experience || '', primary_use_case: profile.primary_use_case || '', data_frequency: profile.data_frequency || '' }); } }}>
            {t('cancel')}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={updating}>
            {t('save_changes')}
          </Button>
        </Space>
      );
    } else {
      onSetAction(
        <Button type="primary" icon={<EditOutlined />} onClick={() => setIsEditingProfile(true)}>
          {t('profile_edit')}
        </Button>
      );
    }
  }, [isEditingProfile, onSetAction, updating]); // eslint-disable-line react-hooks/exhaustive-deps

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


  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  return (
    <Card
      size="small"
      bordered={false}
      style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}
    >
      {/* Avatar header — same pattern as OrganizationTab logo section */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        marginBottom: 24,
        paddingBottom: 20,
        borderBottom: '1px solid var(--ant-color-border-secondary)',
      }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar
            size={64}
            src={profile?.avatar_url || undefined}
            icon={!profile?.avatar_url ? <UserOutlined /> : undefined}
            style={{ border: '2px solid var(--ant-color-border)' }}
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
              <div style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--ant-color-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid var(--ant-color-bg-container)',
                cursor: 'pointer',
              }}>
                <CameraOutlined style={{ fontSize: 10, color: '#fff' }} />
              </div>
            </Upload>
          )}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ant-color-text)', lineHeight: 1.3 }}>
            {displayName || t('profile_edit')}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {profile?.email || user?.email || ''}
          </Typography.Text>
        </div>
      </div>

      {/* Profile form */}
      <ProfileForm form={form} onFinish={handleSubmit} disabled={!isEditingProfile} />
    </Card>
  );
};

