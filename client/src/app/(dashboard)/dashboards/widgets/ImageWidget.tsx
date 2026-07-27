'use client';

import React, { useState } from 'react';
import { Button, Empty, Input, Upload, message, Segmented } from 'antd';
import { LinkOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import './ImageWidget.css';

const MAX_UPLOAD_BYTES = 2.5 * 1024 * 1024; // ~2.5MB — stored on the widget config

export type ImageObjectFit = 'contain' | 'cover' | 'fill' | 'none';

export interface ImageWidgetProps {
  config?: {
    imageUrl?: string;
    src?: string;
    altText?: string;
    objectFit?: ImageObjectFit;
    borderRadius?: number;
  };
  onUpdate?: (updates: Record<string, unknown>) => void;
  readOnly?: boolean;
  isSelected?: boolean;
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function isDataImageUrl(url: string): boolean {
  return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url);
}

export function ImageWidget({ config = {}, onUpdate, readOnly = false }: ImageWidgetProps) {
  const t = useTranslations('dashboards');
  const tw = useTranslations('dash_widget');
  const src = (config.imageUrl || config.src || '').trim();
  const [urlDraft, setUrlDraft] = useState('');
  const [mode, setMode] = useState<'url' | 'upload'>('url');

  const applyUrl = (next: string) => {
    const cleaned = next.trim();
    if (!cleaned) {
      onUpdate?.({ imageUrl: '' });
      return;
    }
    if (!isHttpUrl(cleaned) && !isDataImageUrl(cleaned)) {
      message.error(tw('image_invalid_url'));
      return;
    }
    onUpdate?.({ imageUrl: cleaned });
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error(tw('image_invalid_file'));
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      message.error(tw('image_too_large'));
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) onUpdate?.({ imageUrl: result });
    };
    reader.onerror = () => {
      message.error(tw('image_upload_failed'));
    };
    reader.readAsDataURL(file);
    return false;
  };

  if (!src) {
    if (readOnly) {
      return (
        <div className="image-widget image-widget--empty">
          <Empty description={tw('image_empty_readonly')} imageStyle={{ height: 40 }} />
        </div>
      );
    }

    return (
      <div className="image-widget image-widget--setup no-drag" onClick={(e) => e.stopPropagation()}>
        <div className="image-widget-setup-icon" aria-hidden>
          <PictureOutlined />
        </div>
        <div className="image-widget-setup-title">{t('image_url')}</div>
        <Segmented
          size="small"
          value={mode}
          onChange={(v) => setMode(v as 'url' | 'upload')}
          options={[
            { label: tw('image_mode_url'), value: 'url', icon: <LinkOutlined /> },
            { label: tw('image_mode_upload'), value: 'upload', icon: <UploadOutlined /> },
          ]}
        />
        {mode === 'url' ? (
          <div className="image-widget-setup-row">
            <Input
              size="small"
              value={urlDraft}
              placeholder={t('image_url_placeholder')}
              onChange={(e) => setUrlDraft(e.target.value)}
              onPressEnter={() => applyUrl(urlDraft)}
              allowClear
            />
            <Button size="small" type="primary" onClick={() => applyUrl(urlDraft)}>
              {tw('image_apply')}
            </Button>
          </div>
        ) : (
          <Upload.Dragger
            accept="image/*"
            showUploadList={false}
            beforeUpload={handleFile}
            className="image-widget-dragger"
          >
            <p className="image-widget-dragger-text">{tw('image_drop_hint')}</p>
            <p className="image-widget-dragger-hint">{tw('image_drop_limit')}</p>
          </Upload.Dragger>
        )}
      </div>
    );
  }

  return (
    <div className="image-widget image-widget--media">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={config.altText || ''}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: config.objectFit === 'fill' ? '100%' : undefined,
          height: config.objectFit === 'fill' || config.objectFit === 'cover' ? '100%' : undefined,
          objectFit: config.objectFit || 'contain',
          borderRadius: config.borderRadius || 0,
        }}
      />
      {!readOnly && (
        <div className="image-widget-replace no-drag" onClick={(e) => e.stopPropagation()}>
          <Button
            size="small"
            onClick={() => {
              onUpdate?.({ imageUrl: '' });
              setUrlDraft('');
            }}
          >
            {tw('image_replace')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default ImageWidget;
