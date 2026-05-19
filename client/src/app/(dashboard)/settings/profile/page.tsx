// @ts-nocheck
'use client';

import React, { useState, useEffect } from 'react';
import { 
    Card, 
    Row, 
    Col, 
    Typography, 
    Form, 
    Input, 
    Button, 
    Avatar, 
    Upload, 
    message, 
    Divider, 
    Switch, 
    Tag,
    Space,
    Skeleton,
    Empty,
    Select,
    Tooltip,
    Progress
} from 'antd';
import { 
    UserOutlined, 
    MailOutlined, 
    PhoneOutlined,
    GlobalOutlined,
    CameraOutlined,
    SaveOutlined,
    EditOutlined,
    CheckCircleOutlined,
    InfoCircleOutlined
} from '@ant-design/icons';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useSubscriptionStore as useSubscription } from '@/stores/useSubscriptionStore';
import { useTranslations } from 'next-intl';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function ProfileSettingsPage() {
    const t = useTranslations('settings');
    const { user } = useAuth();
    const { planType: subscriptionPlanType, usage, loading: subLoading } = useSubscription();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [avatarUrl, setAvatarUrl] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [accountInfo, setAccountInfo] = useState<{
        planType?: string;
        memberSince?: string;
        lastLogin?: string;
    }>({});
    const [uploadingAvatar, setUploadingAvatar] = useState(false);

    // Fetch user profile on mount and set initial values from AuthContext
    useEffect(() => {
        const fetchProfile = async () => {
            setFetching(true);
            try {
                // First, set initial values from AuthContext user object
                if (user) {
                    form.setFieldsValue({
                        username: user.username || '',
                        firstName: user.first_name || user.firstName || '',
                        lastName: user.last_name || user.lastName || '',
                        email: user.email || '',
                        phone: user.phone || '',
                        bio: user.bio || '',
                        website: user.website || '',
                        location: user.location || '',
                        timezone: user.timezone || 'UTC'
                    });
                }
                
                // Then fetch from API to get complete profile data
                // CRITICAL: Use /api/users/profile to match backend routing
                const res = await fetch('/api/users/profile', {
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (res.ok) {
                    const profile = await res.json();
                    form.setFieldsValue({
                        username: profile.username || user?.username || '',
                        firstName: profile.first_name || profile.firstName || user?.first_name || user?.firstName || '',
                        lastName: profile.last_name || profile.lastName || user?.last_name || user?.lastName || '',
                        email: profile.email || user?.email || '',
                        phone: profile.phone || user?.phone || '',
                        bio: profile.bio || user?.bio || '',
                        website: profile.website || user?.website || '',
                        location: profile.location || user?.location || '',
                        timezone: profile.timezone || user?.timezone || 'UTC'
                    });
                    
                    // Set avatar URL
                    if (profile.avatar_url) {
                        setAvatarUrl(profile.avatar_url);
                    }
                    
                    // Set account info
                    setAccountInfo({
                        memberSince: profile.created_at || user?.created_at || undefined,
                        lastLogin: profile.last_login_at || user?.last_login_at || undefined,
                    });
                } else {
                    console.warn('Failed to fetch profile from API, using AuthContext data');
                }
            // Plan type now comes from SubscriptionContext — no need to fetch here
            } catch (error) {
                console.error('Failed to fetch profile:', error);
                // If API fails, at least we have user data from AuthContext
            } finally {
                setFetching(false);
            }
        };
        
        fetchProfile();
    }, [user, form]); // removed currentOrganization dependency

    const onFinish = async (values: any) => {
        setLoading(true);
        try {
            const payload: any = {
                username: values.username,
                first_name: values.firstName,
                last_name: values.lastName,
                email: values.email,
                phone: values.phone,
                bio: values.bio,
                website: values.website,
                location: values.location,
                timezone: values.timezone,
                avatar_url: avatarUrl || values.avatar_url || null
            };

            // CRITICAL: Use /api/users/profile to match backend routing
            const res = await fetch('/api/users/profile', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                let errorMessage = `Failed to update profile: ${res.status}`;
                try {
                    const errorData = await res.json();
                    errorMessage = errorData.detail || errorData.message || errorMessage;
                } catch {
                    try {
                        const errorText = await res.text();
                        errorMessage = errorText || errorMessage;
                    } catch {
                        // Use default error message
                    }
                }
                throw new Error(errorMessage);
            }

            const updatedProfile = await res.json();
            
            // CRITICAL: Refetch profile to get all updated fields from backend
            try {
                const refreshRes = await fetch('/api/users/profile', {
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (refreshRes.ok) {
                    const refreshedProfile = await refreshRes.json();
                    // Update form with refreshed data
                    form.setFieldsValue({
                        username: refreshedProfile.username || updatedProfile.username || values.username,
                        firstName: refreshedProfile.first_name || refreshedProfile.firstName || updatedProfile.first_name || values.firstName,
                        lastName: refreshedProfile.last_name || refreshedProfile.lastName || updatedProfile.last_name || values.lastName,
                        email: refreshedProfile.email || updatedProfile.email || values.email,
                        phone: refreshedProfile.phone || updatedProfile.phone || values.phone,
                        bio: refreshedProfile.bio || updatedProfile.bio || values.bio,
                        website: refreshedProfile.website || updatedProfile.website || values.website,
                        location: refreshedProfile.location || updatedProfile.location || values.location,
                        timezone: refreshedProfile.timezone || updatedProfile.timezone || values.timezone,
                        avatar_url: refreshedProfile.avatar_url || updatedProfile.avatar_url || avatarUrl || values.avatar_url
                    });
                    // Update avatar URL state
                    if (refreshedProfile.avatar_url) {
                        setAvatarUrl(refreshedProfile.avatar_url);
                    }
                    // Update account info
                    setAccountInfo(prev => ({
                        ...prev,
                        memberSince: refreshedProfile.created_at || prev.memberSince,
                        lastLogin: refreshedProfile.last_login_at || prev.lastLogin
                    }));
                }
            } catch (refreshError) {
                console.warn('Failed to refresh profile after update:', refreshError);
                // Fallback to using response data
                form.setFieldsValue({
                    username: updatedProfile.username || values.username,
                    firstName: updatedProfile.first_name || values.firstName,
                    lastName: updatedProfile.last_name || values.lastName,
                    email: updatedProfile.email || values.email,
                    phone: updatedProfile.phone || values.phone,
                    bio: updatedProfile.bio || values.bio,
                    website: updatedProfile.website || values.website,
                    location: updatedProfile.location || values.location,
                    timezone: updatedProfile.timezone || values.timezone
                });
            }

            message.success(t('profile_updated'));
            setIsEditing(false);
        } catch (error: any) {
            message.error(error?.message || t('profile_update_failed'));
            console.error('Profile update error:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAvatarUpload = async (file: File) => {
        setUploadingAvatar(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            
            // CRITICAL: Use /api/users/upload-avatar to match backend routing
            const res = await fetch('/api/users/upload-avatar', {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });
            
            if (!res.ok) {
                const error = await res.json().catch(() => ({ detail: null }));
                throw new Error(error.detail || t('profile_avatar_upload_failed'));
            }
            
            const result = await res.json();
            const newAvatarUrl = result.url || result.avatar_url;
            setAvatarUrl(newAvatarUrl);
            form.setFieldsValue({ avatar_url: newAvatarUrl });
            message.success(t('profile_avatar_upload_ok'));
            
            // Update user context if available
            if (user) {
                user.avatar_url = newAvatarUrl;
            }
        } catch (error: any) {
            console.error('Avatar upload error:', error);
            message.error(error?.message || t('profile_avatar_upload_failed'));
        } finally {
            setUploadingAvatar(false);
        }
    };

    const handleAvatarUrlSubmit = async (url: string) => {
        setUploadingAvatar(true);
        try {
            // CRITICAL: Use /api/users/upload-avatar to match backend routing
            // Send as JSON for URL updates (not multipart/form-data)
            const res = await fetch('/api/users/upload-avatar', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url, avatar_url: url }),
            });
            
            if (!res.ok) {
                const error = await res.json().catch(() => ({ detail: null }));
                throw new Error(error.detail || t('profile_avatar_url_failed'));
            }
            
            const result = await res.json();
            const avatarUrlValue = result.url || result.avatar_url || url;
            setAvatarUrl(avatarUrlValue);
            form.setFieldsValue({ avatar_url: avatarUrlValue });
            message.success(t('profile_avatar_url_ok'));
            
            // Update user context if available
            if (user) {
                user.avatar_url = avatarUrlValue;
            }
        } catch (error: any) {
            console.error('Avatar URL submit error:', error);
            message.error(error?.message || t('profile_avatar_url_failed'));
        } finally {
            setUploadingAvatar(false);
        }
    };

    if (fetching) {
        return (
            <div className="page-wrapper">
                <Skeleton active paragraph={{ rows: 8 }} />
            </div>
        );
    }

    return (
        <div className="page-wrapper" style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '24px', paddingBottom: '24px' }}>
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '24px' }}>
                <Title level={2} className="page-title" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <UserOutlined style={{ color: 'var(--ant-color-primary)', fontSize: '24px' }} />
                    {t('profile_page_title')}
                </Title>
                <Text type="secondary" className="page-description" style={{ marginTop: '4px', marginBottom: '0', fontSize: '16px' }}>
                    {t('profile_page_subtitle')}
                </Text>
            </div>

            <Row gutter={[24, 24]}>
                {/* Left Column - Main Form */}
                <Col xs={24} lg={16}>
                    {/* Personal Information Card */}
                    <Card 
                        title={
                            <Space>
                                <UserOutlined />
                                <span>{t('profile_card_title')}</span>
                            </Space>
                        }
                        extra={
                            !isEditing ? (
                                <Button 
                                    type="text" 
                                    icon={<EditOutlined />}
                                    onClick={() => setIsEditing(true)}
                                >
                                    {t('profile_edit')}
                                </Button>
                            ) : (
                                <Space>
                                    <Button onClick={() => { setIsEditing(false); form.resetFields(); }}>
                                        {t('header_cancel')}
                                    </Button>
                                    <Button 
                                        type="primary" 
                                        icon={<SaveOutlined />}
                                        loading={loading}
                                        onClick={() => form.submit()}
                                    >
                                        {t('profile_save_changes')}
                                    </Button>
                                </Space>
                            )
                        }
                        style={{ marginBottom: '24px' }}
                        className="profile-card"
                    >
                        <Form
                            form={form}
                            layout="vertical"
                            onFinish={onFinish}
                            disabled={!isEditing}
                        >
                            <Row gutter={16}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        name="firstName"
                                        label={t('profile_first_name')}
                                        rules={[{ required: true, message: t('profile_first_name_required') }]}
                                    >
                                        <Input 
                                            prefix={<UserOutlined />} 
                                            placeholder={t('profile_first_name')}
                                            size="large"
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        name="lastName"
                                        label={t('profile_last_name')}
                                        rules={[{ required: true, message: t('profile_last_name_required') }]}
                                    >
                                        <Input 
                                            prefix={<UserOutlined />} 
                                            placeholder={t('profile_last_name')}
                                            size="large"
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={16}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        name="email"
                                        label={t('profile_email')}
                                        rules={[
                                            { required: true, message: t('profile_email_required') },
                                            { type: 'email', message: t('profile_email_invalid') }
                                        ]}
                                    >
                                        <Input 
                                            prefix={<MailOutlined />} 
                                            placeholder={t('profile_email')}
                                            size="large"
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        name="phone"
                                        label={t('profile_phone')}
                                    >
                                        <Input 
                                            prefix={<PhoneOutlined />} 
                                            placeholder={t('profile_phone')}
                                            size="large"
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item
                                name="bio"
                                label={
                                    <Space>
                                        <span>{t('profile_bio')}</span>
                                        <Tooltip title={t('profile_bio_hint')}>
                                            <InfoCircleOutlined style={{ color: 'var(--ant-color-text-tertiary)' }} />
                                        </Tooltip>
                                    </Space>
                                }
                            >
                                <TextArea 
                                    rows={4} 
                                    placeholder={t('profile_bio_placeholder')}
                                    maxLength={500}
                                    showCount
                                    size="large"
                                />
                            </Form.Item>

                            <Row gutter={16}>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        name="website"
                                        label={t('profile_website')}
                                    >
                                        <Input 
                                            prefix={<GlobalOutlined />} 
                                            placeholder={t('profile_website_placeholder')}
                                            size="large"
                                        />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} sm={12}>
                                    <Form.Item
                                        name="location"
                                        label={t('profile_location')}
                                    >
                                        <Input 
                                            placeholder={t('profile_location_placeholder')}
                                            size="large"
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item
                                name="timezone"
                                label={t('timezone')}
                            >
                                <Select 
                                    placeholder={t('select_timezone')}
                                    size="large"
                                    showSearch
                                    filterOption={(input, option) =>
                                        (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                    }
                                    options={[
                                        { value: 'UTC', label: t('tz_utc') },
                                        { value: 'America/New_York', label: t('tz_eastern') },
                                        { value: 'America/Chicago', label: t('tz_central') },
                                        { value: 'America/Denver', label: t('tz_mountain') },
                                        { value: 'America/Los_Angeles', label: t('tz_pacific') },
                                        { value: 'Europe/London', label: t('tz_london') },
                                        { value: 'Europe/Paris', label: t('tz_paris') },
                                        { value: 'Asia/Tokyo', label: t('tz_tokyo') },
                                        { value: 'Asia/Shanghai', label: t('tz_shanghai') },
                                        { value: 'Asia/Dubai', label: t('tz_dubai') },
                                    ]}
                                />
                            </Form.Item>
                        </Form>
                    </Card>

                    {/* Account Preferences Card */}
                    <Card 
                        title={
                            <Space>
                                <InfoCircleOutlined />
                                <span>{t('profile_account_preferences')}</span>
                            </Space>
                        }
                        className="profile-card"
                    >
                        <Row gutter={[24, 24]}>
                            <Col xs={24} sm={12}>
                                <div style={{ marginBottom: '24px' }}>
                                    <Space direction="vertical" style={{ width: '100%' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <Text strong>{t('profile_email_notifications')}</Text>
                                                <br />
                                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                                    {t('profile_email_notifications_desc')}
                                                </Text>
                                            </div>
                                            <Switch defaultChecked />
                                        </div>
                                    </Space>
                                </div>
                                
                                <div>
                                    <Space direction="vertical" style={{ width: '100%' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <Text strong>{t('profile_marketing_comms')}</Text>
                                                <br />
                                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                                    {t('profile_marketing_comms_desc')}
                                                </Text>
                                            </div>
                                            <Switch />
                                        </div>
                                    </Space>
                                </div>
                            </Col>
                            <Col xs={24} sm={12}>
                                <div style={{ marginBottom: '24px' }}>
                                    <Space direction="vertical" style={{ width: '100%' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <Text strong>{t('profile_two_factor')}</Text>
                                                <br />
                                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                                    {t('profile_two_factor_desc')}
                                                </Text>
                                            </div>
                                            <Switch />
                                        </div>
                                    </Space>
                                </div>
                                
                                <div>
                                    <Space direction="vertical" style={{ width: '100%' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <Text strong>{t('profile_public_profile')}</Text>
                                                <br />
                                                <Text type="secondary" style={{ fontSize: '12px' }}>
                                                    {t('profile_public_profile_desc')}
                                                </Text>
                                            </div>
                                            <Switch defaultChecked />
                                        </div>
                                    </Space>
                                </div>
                            </Col>
                        </Row>
                    </Card>
                </Col>

                {/* Right Column - Avatar & Account Info */}
                <Col xs={24} lg={8}>
                    {/* Profile Picture Card */}
                    <Card 
                        title={t('profile_picture')}
                        style={{ marginBottom: '24px', textAlign: 'center' }}
                        className="profile-card"
                    >
                        <Space direction="vertical" size="large" style={{ width: '100%' }}>
                            <Upload
                                beforeUpload={(file) => {
                                    handleAvatarUpload(file);
                                    return false; // Prevent default upload
                                }}
                                showUploadList={false}
                                accept="image/*"
                            >
                                <Avatar 
                                    size={120} 
                                    src={avatarUrl || user?.avatar_url}
                                    icon={<UserOutlined />}
                                    style={{ 
                                        border: '4px solid var(--ant-color-border)',
                                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease'
                                    }}
                                    className="avatar-upload-trigger"
                                />
                            </Upload>
                            <Text type="secondary" style={{ fontSize: '12px', textAlign: 'center' }}>
                                {t('profile_click_avatar_upload')}
                            </Text>
                            
                            <Divider style={{ margin: '16px 0' }}>{t('profile_or')}</Divider>
                            
                            <Space.Compact style={{ width: '100%' }}>
                                <Input
                                    placeholder={t('profile_image_url_placeholder')}
                                    size="large"
                                    disabled={uploadingAvatar}
                                    value={avatarUrl || ''}
                                    onChange={(e) => setAvatarUrl(e.target.value)}
                                    onPressEnter={(e) => {
                                        const url = (e.target as HTMLInputElement).value.trim();
                                        if (url) {
                                            handleAvatarUrlSubmit(url);
                                        }
                                    }}
                                />
                                <Button
                                    type="primary"
                                    size="large"
                                    loading={uploadingAvatar}
                                    onClick={() => {
                                        if (avatarUrl) {
                                            handleAvatarUrlSubmit(avatarUrl.trim());
                                        } else {
                                            message.warning(t('profile_enter_image_url'));
                                        }
                                    }}
                                >
                                    {t('profile_save_url')}
                                </Button>
                            </Space.Compact>
                            
                            <Text type="secondary" style={{ fontSize: '12px', display: 'block', textAlign: 'center' }}>
                                {t('profile_image_recommended')}
                            </Text>
                        </Space>
                    </Card>

                    {/* Account Status Card */}
                    <Card 
                        title={t('profile_account_information')}
                        className="profile-card"
                    >
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                                <Text type="secondary">{t('profile_account_type')}</Text>
                                <Tag 
                                    color={
                                        subscriptionPlanType === 'enterprise' ? 'gold' :
                                        subscriptionPlanType === 'team' ? 'purple' :
                                        subscriptionPlanType === 'pro' ? 'blue' : 'default'
                                    } 
                                    style={{ margin: 0 }}
                                >
                                    {subLoading ? t('profile_loading') : subscriptionPlanType.toUpperCase()}
                                </Tag>
                            </div>
                            
                            <Divider style={{ margin: '8px 0' }} />
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                                <Text type="secondary">{t('profile_member_since')}</Text>
                                <Text>
                                    {accountInfo.memberSince 
                                        ? new Date(accountInfo.memberSince).toLocaleDateString() 
                                        : (user?.created_at ? new Date(user.created_at).toLocaleDateString() : t('profile_na'))}
                                </Text>
                            </div>
                            
                            <Divider style={{ margin: '8px 0' }} />
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0' }}>
                                <Text type="secondary">{t('profile_last_login')}</Text>
                                <Text>
                                    {accountInfo.lastLogin 
                                        ? new Date(accountInfo.lastLogin).toLocaleDateString() 
                                        : t('profile_never')}
                                </Text>
                            </div>

                            <Divider style={{ margin: '8px 0' }} />

                            {/* Plan Usage Summary */}
                            <div style={{ padding: '8px 0' }}>
                                <Text type="secondary" style={{ display: 'block', marginBottom: '12px', fontWeight: 500 }}>{t('profile_plan_usage')}</Text>
                                
                                {/* AI Credits */}
                                <div style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <Text style={{ fontSize: '12px' }}>{t('billing_ai_credits')}</Text>
                                        <Text style={{ fontSize: '12px', fontWeight: 600 }}>
                                            {usage.ai_credits?.unlimited
                                                ? `${usage.ai_credits?.used ?? 0} / ∞`
                                                : `${usage.ai_credits?.used ?? 0} / ${usage.ai_credits?.limit ?? 0}`}
                                        </Text>
                                    </div>
                                    {!usage.ai_credits?.unlimited && (
                                        <Progress
                                            percent={usage.ai_credits?.percentage ?? 0}
                                            size="small"
                                            showInfo={false}
                                            strokeColor={(usage.ai_credits?.percentage ?? 0) > 80 ? '#ff4d4f' : '#1890ff'}
                                        />
                                    )}
                                </div>

                                {/* Data Sources */}
                                <div style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <Text style={{ fontSize: '12px' }}>{t('overview_data_sources')}</Text>
                                        <Text style={{ fontSize: '12px', fontWeight: 600 }}>
                                            {usage.data_sources_count?.unlimited
                                                ? `${usage.data_sources_count?.used ?? 0} / ∞`
                                                : `${usage.data_sources_count?.used ?? 0} / ${usage.data_sources_count?.limit ?? 0}`}
                                        </Text>
                                    </div>
                                    {!usage.data_sources_count?.unlimited && (
                                        <Progress
                                            percent={usage.data_sources_count?.percentage ?? 0}
                                            size="small"
                                            showInfo={false}
                                            strokeColor={(usage.data_sources_count?.percentage ?? 0) > 80 ? '#ff4d4f' : '#52c41a'}
                                        />
                                    )}
                                </div>

                                {/* Projects */}
                                <div style={{ marginBottom: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <Text style={{ fontSize: '12px' }}>{t('projects')}</Text>
                                        <Text style={{ fontSize: '12px', fontWeight: 600 }}>
                                            {usage.projects_count?.unlimited
                                                ? `${usage.projects_count?.used ?? 0} / ∞`
                                                : `${usage.projects_count?.used ?? 0} / ${usage.projects_count?.limit ?? 0}`}
                                        </Text>
                                    </div>
                                    {!usage.projects_count?.unlimited && (
                                        <Progress
                                            percent={usage.projects_count?.percentage ?? 0}
                                            size="small"
                                            showInfo={false}
                                            strokeColor={(usage.projects_count?.percentage ?? 0) > 80 ? '#ff4d4f' : '#722ed1'}
                                        />
                                    )}
                                </div>
                            </div>
                            
                            <Divider style={{ margin: '16px 0' }} />
                            
                            <Button 
                                type="default" 
                                danger 
                                block
                                size="large"
                                style={{ marginTop: '8px' }}
                            >
                                {t('profile_delete_account')}
                            </Button>
                        </Space>
                    </Card>
                </Col>
            </Row>
        </div>
    );
}
