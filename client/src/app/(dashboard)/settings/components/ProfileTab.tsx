import React, { useEffect } from 'react';
import { Card, Form, Button, Space, message, Avatar, Upload, Typography } from 'antd';
import { UserOutlined, EditOutlined, SaveOutlined, CameraOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useProfileStore } from '@/stores/useProfileStore';
import { ProfileForm } from './forms/ProfileForm';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import type { TabComponentProps } from '../page';
import type { ProfileFormValues } from '../types';

export const ProfileTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('settings');
  const [form] = Form.useForm<ProfileFormValues>();
  const { user } = useAuth();
  const { profile, updating, fetchProfile, updateProfile, uploadAvatar } = useProfileStore();

  const [isEditingProfile, setIsEditingProfile] = React.useState(false);

  // Register action button in page header (Vercel-style: right of title)
  useEffect(() => {
    if (!onSetAction) return;
    if (isEditingProfile) {
      onSetAction(
        <Space>
          <Button
            onClick={() => {
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
            }}
          >
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

  const handleSubmit = async (values: ProfileFormValues) => {
    try {
      const success = await updateProfile(values);
      if (success) {
        message.success(t('profile_update_success'));
        setIsEditingProfile(false);
      } else {
        message.error(t('profile_update_failed'));
      }
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : t('profile_update_failed'));
    }
  };

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  return (
    <Card size="small" bordered={false} className="w-full !rounded-lg !bg-[var(--color-fill-quaternary)]">
      {/* Avatar header — same pattern as OrganizationTab logo section */}
      <div className="mb-6 flex items-center gap-4 border-b border-[var(--ant-color-border-secondary)] pb-5">
        <div className="relative shrink-0">
          <Avatar
            size={64}
            src={profile?.avatar_url || undefined}
            icon={!profile?.avatar_url ? <UserOutlined /> : undefined}
            className="border-2 border-[var(--ant-color-border)]"
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
              <div className="absolute bottom-0 right-0 flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-full border-2 border-[var(--ant-color-bg-container)] bg-[var(--ant-color-primary)]">
                <CameraOutlined className="text-[10px] text-white" />
              </div>
            </Upload>
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold leading-[1.3] text-[var(--ant-color-text)]">
            {displayName || t('profile_edit')}
          </div>
          <Typography.Text type="secondary" className="block truncate !text-xs">
            {profile?.email || user?.email || ''}
          </Typography.Text>
        </div>
      </div>

      {/* Profile form */}
      <ProfileForm form={form} onFinish={handleSubmit} disabled={!isEditingProfile} />
    </Card>
  );
};
