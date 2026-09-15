import React, { useEffect } from 'react';
import { Card, Form, Button, message, Avatar, Upload, Typography, Spin } from 'antd';
import { UserOutlined, SaveOutlined, CameraOutlined } from '@ant-design/icons';
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

  const [avatarUploading, setAvatarUploading] = React.useState(false);

  // Always-editable form, Save always in the header - matches OrganizationTab's
  // editing experience rather than gating every field behind an Edit click first.
  // A user editing their own profile has no permission check to gate on (unlike
  // Organization's canEditOrg), so there's nothing here that a separate "view
  // mode" was ever protecting.
  useEffect(() => {
    if (!onSetAction) return;
    onSetAction(
      <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={updating}>
        {t('save_changes')}
      </Button>
    );
  }, [onSetAction, updating]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else {
        message.error(t('profile_update_failed'));
      }
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : t('profile_update_failed'));
    }
  };

  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.email || '';

  return (
    <Card size="small" variant="borderless" className="w-full !rounded-lg !bg-[var(--color-fill-quaternary)]">
      {/* Avatar header — same pattern as OrganizationTab logo section */}
      <div className="mb-6 flex items-center gap-4 border-b border-[var(--ant-color-border-secondary)] pb-5">
        <div className="relative shrink-0">
          {/* Always visible, not gated behind Edit Profile — a user can always change
              their own avatar; OrganizationTab's logo upload (the pattern this mirrors)
              only gates on edit *permission*, never on whether the form happens to be
              in edit mode. Gating this on isEditingProfile was the actual bug: the
              upload trigger simply didn't exist until you'd already clicked Edit.
              The whole avatar sits inside Upload (not just the camera badge) so
              clicking the photo itself opens the file picker, matching the org
              logo's click target. */}
          <Upload
            showUploadList={false}
            accept="image/jpeg,image/png,image/gif,image/webp"
            beforeUpload={(file) => {
              setAvatarUploading(true);
              uploadAvatar(file)
                .then((url) => {
                  if (url) message.success(t('profile_avatar_updated'));
                  else message.error(t('profile_avatar_upload_failed'));
                })
                .finally(() => setAvatarUploading(false));
              return false;
            }}
          >
            <div className="group relative cursor-pointer">
              <Avatar
                size={64}
                src={profile?.avatar_url || undefined}
                icon={!displayName ? <UserOutlined /> : undefined}
                className="border-2 border-[var(--ant-color-border)] transition-opacity group-hover:opacity-75"
              >
                {displayName?.trim()?.charAt(0)?.toUpperCase()}
              </Avatar>
              {avatarUploading ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                  <Spin size="small" />
                </div>
              ) : null}
              <div className="absolute bottom-0 right-0 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-[var(--ant-color-bg-container)] bg-[var(--ant-color-primary)]">
                <CameraOutlined className="text-[10px] text-white" />
              </div>
            </div>
          </Upload>
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

      {/* Profile form - always editable, matches OrganizationTab (disabled only while saving) */}
      <ProfileForm form={form} onFinish={handleSubmit} disabled={updating} />
    </Card>
  );
};
